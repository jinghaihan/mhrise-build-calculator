import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { argv } from 'node:process'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const KIRANICO_BASE_URL = 'https://mhrise.kiranico.com'
const DEFAULT_OUTPUT = resolve('packages/data/snapshots')
const ARMOR_VIEWS = 10
const WEAPON_VIEWS = 14

const args = parseArgs(argv.slice(2))
const workbookPath = args.workbook
  ? resolve(args.workbook)
  : undefined
const outputDir = resolve(args.output ?? DEFAULT_OUTPUT)

if (!workbookPath) {
  throw new Error('Usage: node scripts/sync-sources.mjs --workbook <path> [--output <dir>]')
}

const workbook = XLSX.read(await readFile(workbookPath), { cellDates: false })
const workbookData = readOfflineWorkbook(workbook)
const [skillsHtml, decorationsHtml, ...pages] = await Promise.all([
  fetchText(`${KIRANICO_BASE_URL}/zh/data/skills`),
  fetchText(`${KIRANICO_BASE_URL}/zh/data/decorations`),
  ...Array.from({ length: ARMOR_VIEWS }, (_, view) => fetchText(
    `${KIRANICO_BASE_URL}/zh/data/armors?view=${view}`,
  )),
  ...Array.from({ length: WEAPON_VIEWS }, (_, view) => fetchText(
    `${KIRANICO_BASE_URL}/zh/data/weapons?view=${view}`,
  )),
])

const armorPages = pages.slice(0, ARMOR_VIEWS)
const weaponPages = pages.slice(ARMOR_VIEWS)
const skills = await enrichSkillMaximums(parseSkills(skillsHtml))
const skillByName = new Map(skills.map(record => [record.names.zh, record.ref.id]))
const families = workbookData.armorFamilies.map(family => ({
  ...family,
  key: family.name,
}))
const armors = armorPages.flatMap(page => parseArmors(page, families))
const decorations = parseDecorations(decorationsHtml)
const weapons = weaponPages.flatMap(page => parseWeapons(page))

const snapshot = {
  generatedAt: new Date().toISOString(),
  catalog: {
    armors: stripNames(deduplicate(armors)),
    decorations: stripNames(deduplicate(decorations)),
    skills: stripNames(deduplicate(skills)),
    talismans: [],
    weapons: stripNames(deduplicate(weapons)),
  },
  rules: {
    // `name` is only the Chinese workbook label used while matching Kiranico
    // armor rows. It is not runtime rule data and must not leak into snapshots.
    armorFamilies: workbookData.armorFamilies.map(({ name, ...family }) => family),
    augmentationEntries: workbookData.augmentationEntries.map(entry => ({
      ...entry,
      skillId: entry.skillName ? skillByName.get(entry.skillName) : undefined,
    })),
    skillCosts: workbookData.skillCosts.map(entry => ({
      ...entry,
      skillId: skillByName.get(entry.name),
    })),
    talismanRules: workbookData.talismanRules.map(entry => ({
      ...entry,
      skillId: skillByName.get(entry.name),
    })),
  },
}

await mkdir(outputDir, { recursive: true })
await writeFile(
  resolve(outputDir, 'source-snapshot.json'),
  `${JSON.stringify(snapshot, (_, value) => value === undefined ? undefined : value, 2)}\n`,
)

console.log(JSON.stringify({
  output: resolve(outputDir, 'source-snapshot.json'),
  counts: {
    skills: snapshot.catalog.skills.length,
    decorations: snapshot.catalog.decorations.length,
    armors: snapshot.catalog.armors.length,
    weapons: snapshot.catalog.weapons.length,
    armorFamilies: snapshot.rules.armorFamilies.length,
    augmentationEntries: snapshot.rules.augmentationEntries.length,
    skillCosts: snapshot.rules.skillCosts.length,
    talismanRules: snapshot.rules.talismanRules.length,
  },
  unmatchedArmorFamilies: snapshot.catalog.armors.filter(armor => !armor.armorFamilyId).length,
  unmatchedSkills: snapshot.rules.skillCosts.filter(skill => !skill.skillId).length,
}, null, 2))

async function fetchText(url) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Kiranico request failed (${response.status}): ${url}`)
  }

  return response.text()
}

function readOfflineWorkbook(book) {
  const armorRows = sheetRows(book, '装备')
  const armorFamilies = armorRows.slice(2)
    .filter(row => row[0] && Number.isInteger(Number(row[1])))
    .map(row => ({
      costBudget: Number(row[3]),
      id: String(row[1]),
      name: String(row[0]),
      poolId: Number(row[2]),
    }))

  const augmentationEntries = []
  for (const [poolIndex, start] of [0, 11, 22, 33, 44, 55, 66].entries()) {
    const rows = sheetRows(book, '词条')
    for (const [rowIndex, row] of rows.slice(2).entries()) {
      const poolId = numberOrUndefined(row[start])
      const gameId = numberOrUndefined(row[start + 1])
      const label = textOrUndefined(row[start + 2])
      const cost = numberOrUndefined(row[start + 9])

      if (poolId === undefined || gameId === undefined || !label || cost === undefined) {
        continue
      }

      const levels = [row[start + 3], row[start + 4], row[start + 5]]
        .map(value => Number(value ?? 0))

      augmentationEntries.push({
        cost,
        element: augmentationKind(label) === 'resistance'
          ? augmentationElement(gameId)
          : undefined,
        gameId,
        kind: augmentationKind(label),
        label,
        levels,
        poolId,
        role: augmentationRole(rowIndex + 3),
        sourceBlock: poolIndex,
      })
    }
  }

  const skillCosts = []
  for (const start of [0, 4, 8, 12, 16]) {
    for (const row of sheetRows(book, '技能').slice(2)) {
      const id = numberOrUndefined(row[start])
      const cost = numberOrUndefined(row[start + 1])
      const name = textOrUndefined(row[start + 2])
      if (id !== undefined && cost !== undefined && name) {
        skillCosts.push({ cost, gameId: id, name })
      }
    }
  }

  const talismanRules = sheetRows(book, '护石').slice(2).filter(row => numberOrUndefined(row[0]) !== undefined && textOrUndefined(row[1])).map(row => ({
    firstSkillMax: countFilled(row[5]),
    firstSkillMaxRing: countFilled(row[8]),
    gameId: Number(row[0]),
    maxLevel: countSymbols(row[3]),
    name: String(row[1]),
    rank: String(row[2] ?? ''),
    rate: numberOrUndefined(row[13]),
    secondSkillMax: countFilled(row[6]),
    secondSkillMaxRing: countFilled(row[9]),
    slotOptions: parseSlotOptions(row[14]),
    weight: numberOrUndefined(row[11]),
  }))

  return { armorFamilies, augmentationEntries, skillCosts, talismanRules }
}

function augmentationRole(rowNumber) {
  if (rowNumber >= 36 && rowNumber <= 38)
    return 'cost-fill'
  if (rowNumber >= 40 && rowNumber <= 44)
    return 'ignored-special'
  if (rowNumber === 46)
    return 'ignored-special'
  return 'normal'
}

function sheetRows(book, name) {
  const sheet = book.Sheets[name]
  if (!sheet) {
    throw new Error(`Workbook sheet not found: ${name}`)
  }
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true })
}

function parseSkills(html) {
  return rows(html).flatMap((row) => {
    const link = firstLink(row, '/data/skills/')
    if (!link)
      return []
    const levels = [...row.matchAll(/\bLv\s*(\d+)/gi)].map(match => Number(match[1]))
    return [{
      maxLevel: Math.max(...levels, 1),
      names: { zh: link.text },
      ref: { id: link.id, kind: 'skill', source: 'kiranico' },
    }]
  })
}

async function enrichSkillMaximums(records) {
  return Promise.all(records.map(async (record) => {
    const html = await fetchText(`${KIRANICO_BASE_URL}/zh/data/skills/${record.ref.id}`)
    const levelsTable = html.match(/<h1\b[\s\S]*?<\/h1>[\s\S]*?<table\b[\s\S]*?<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? ''
    const levels = [...levelsTable.matchAll(/\bLv\s*(\d+)/gi)].map(match => Number(match[1]))

    return {
      ...record,
      maxLevel: Math.max(record.maxLevel, ...levels),
    }
  }))
}

function parseDecorations(html) {
  return rows(html).flatMap((row) => {
    const link = firstLink(row, '/data/decorations/')
    if (!link)
      return []
    const slotLevel = link.text.match(/[【[]([1-4])[】\]]/)?.[1]
    const skills = skillValues(row)
    if (!slotLevel || skills.length === 0)
      return []
    return [{
      decoration: {
        ref: { id: link.id, kind: 'decoration', source: 'kiranico' },
        skills,
        slotLevel: Number(slotLevel),
      },
      names: { zh: link.text },
      ref: { id: link.id, kind: 'decoration', source: 'kiranico' },
    }]
  })
}

function parseArmors(html, families) {
  return rows(html).flatMap((row) => {
    const link = firstLink(row, '/data/armors/')
    if (!link)
      return []
    const cells = tableCells(row)
    const baseDefense = cells[4]?.match(/<div\b[^>]*>\s*(-?\d+)\s*<\/div>/i)?.[1]
    const baseResistances = armorResistancesFromCells(cells)
    const slot = inferArmorSlot(link.text)
    if (baseDefense === undefined || !slot)
      return []
    const family = families.find(candidate => matchesFamily(link.text, candidate.key))
    return [{
      armor: {
        baseDefense: Number(baseDefense),
        baseSkills: skillValues(row),
        baseResistances,
        costBudget: family?.costBudget ?? 0,
        ref: { id: link.id, kind: 'armor', source: 'kiranico' },
        slot,
        slots: slotLevels(cells[3] ?? ''),
      },
      armorFamilyId: family?.id,
      names: { zh: link.text },
      ref: { id: link.id, kind: 'armor', source: 'kiranico' },
    }]
  })
}

function parseWeapons(html) {
  return rows(html).flatMap((row) => {
    const link = firstLink(row, '/data/weapons/')
    if (!link)
      return []
    const cells = tableCells(row)
    return [{
      names: { zh: link.text },
      ref: { id: link.id, kind: 'weapon', source: 'kiranico' },
      weapon: {
        ref: { id: link.id, kind: 'weapon', source: 'kiranico' },
        skills: skillValues(row),
        slots: slotLevels(cells[2] ?? ''),
      },
    }]
  })
}

function rows(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => match[1])
}

function tableCells(row) {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match => match[1])
}

function firstLink(row, path) {
  const match = row.match(new RegExp(
    `href=["'][^"']*${path.replaceAll('/', '\\/')}(\\d+)["'][^>]*>([\\s\\S]*?)<\\/a>`,
    'i',
  ))
  return match ? { id: String(match[1]), text: stripMarkup(match[2]) } : undefined
}

function skillValues(row) {
  return [...row.matchAll(
    /href=["'][^"']*\/data\/skills\/(\d+)["'][^>]*>([\s\S]*?)<\/a>\s*Lv\s*(\d+)/gi,
  )].map(match => ({ level: Number(match[3]), skillId: String(match[1]) }))
}

function slotLevels(cell) {
  const levels = [...cell.matchAll(/deco([1-4])\.png/gi)].map(match => Number(match[1]))
  return [levels[0] ?? 0, levels[1] ?? 0, levels[2] ?? 0]
}

function inferArmorSlot(name) {
  const specialSets = {
    脉动钢龙: ['强力', '逆鳞', '钩爪', '安稳', '踏实'],
  }

  for (const [family, suffixes] of Object.entries(specialSets)) {
    if (!name.includes(family)) {
      continue
    }
    const suffixIndex = suffixes.findIndex(suffix => name.endsWith(suffix))
    if (suffixIndex >= 0) {
      return ['head', 'chest', 'arms', 'waist', 'legs'][suffixIndex]
    }
  }

  if (['头盔', '头巾', '头', '首', '冠', '额饰'].some(value => name.includes(value)))
    return 'head'
  if (['铠甲', '上衣', '胸甲', '躯', '胸', '衣', '宿衣'].some(value => name.includes(value)))
    return 'chest'
  if (['腕甲', '手甲', '臂', '袖', '大袖'].some(value => name.includes(value)))
    return 'arms'
  if (['腰甲', '腰卷', '腰', '尾', '带', '圆带'].some(value => name.includes(value)))
    return 'waist'
  if (['护腿', '绑腿', '足', '脚', '裳', '腿甲'].some(value => name.includes(value)))
    return 'legs'
  return undefined
}

function familyKey(name) {
  return name
    .replace(/【[^】]*】/gu, '')
    .replace(/[・･ＺZX真继霸]/gu, '')
    .replace(/(?:头盔|头巾|头饰|额饰|铠甲|上衣|胸甲|宿衣|腕甲|手甲|大袖|腰甲|腰卷|护腿|绑腿|腿甲|[头首冠躯胸衣臂袖腰尾带圆足脚裳])$/gu, '')
    .trim()
}

function matchesFamily(name, key) {
  const marker = key.match(/[ＺZX真继霸]/u)?.[0]
  if (marker && !name.includes(marker))
    return false

  const normalized = familyKey(name)
  const family = familyKey(key)
  return normalized === family || normalized.startsWith(family)
}

function augmentationKind(label) {
  if (label === '防禦+' || label === '防禦-')
    return 'defense'
  if (label === '技能+' || label === '技能-')
    return 'skill'
  if (label === '孔位+')
    return 'slot'
  return 'resistance'
}

function augmentationElement(gameId) {
  if (gameId >= 89 && gameId <= 94)
    return 'fire'
  if (gameId >= 99 && gameId <= 104)
    return 'water'
  if (gameId >= 109 && gameId <= 114)
    return 'thunder'
  if (gameId >= 119 && gameId <= 124)
    return 'ice'
  if (gameId >= 129 && gameId <= 134)
    return 'dragon'
  return undefined
}

function armorResistancesFromCells(cells) {
  const resistances = { fire: 0, water: 0, ice: 0, thunder: 0, dragon: 0 }
  const elementNames = ['fire', 'water', 'ice', 'thunder', 'dragon']
  const source = cells.slice(4, 6).join(' ')
  const pattern = /data-key=["']element["']\s+data-value=["'](\d+)["'][\s\S]*?data-key=["']elementAttack["']\s+data-value=["'](-?\d+)["']/gi

  for (const match of source.matchAll(pattern)) {
    const element = elementNames[Number(match[1]) - 1]
    if (element)
      resistances[element] = Number(match[2])
  }

  return resistances
}

function parseSlotOptions(value) {
  return String(value ?? '')
    .match(/\[[0-4],[0-4],[0-4]\]/g)
    ?.map(option => option.slice(1, -1).split(',').map(Number)) ?? []
}

function countSymbols(value) {
  return String(value ?? '').match(/[▱▰]/gu)?.length ?? 0
}

function countFilled(value) {
  return String(value ?? '').match(/▰/gu)?.length ?? 0
}

function numberOrUndefined(value) {
  return value === null || value === undefined || value === '' || Number.isNaN(Number(value))
    ? undefined
    : Number(value)
}

function textOrUndefined(value) {
  return value === null || value === undefined || value === '' ? undefined : String(value)
}

function stripMarkup(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function deduplicate(records) {
  return [...new Map(records.map(record => [record.ref.id, record])).values()]
}

function stripNames(records) {
  return records.map(({ names: _names, ...record }) => record)
}

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--'))
      continue
    result[value.slice(2)] = values[index + 1]?.startsWith('--') ? true : values[++index]
  }
  return result
}
