import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const KIRANICO_BASE_URL = 'https://mhrise.kiranico.com'
const SOURCE_PATH = resolve('packages/data/snapshots/source-snapshot.json')
const OUTPUT_PATH = resolve('packages/data/locales/names.json')
const LOCALES = ['zh', 'zh-Hant', 'en', 'ja', 'ko']
const PAGE_GROUPS = [
  ['skill', 'skills', 1],
  ['decoration', 'decorations', 1],
  ['armor', 'armors', 10],
  ['weapon', 'weapons', 14],
]

const snapshot = JSON.parse(await readFile(SOURCE_PATH, 'utf8'))
const names = {}

for (const locale of LOCALES) {
  const localeNames = {}

  for (const [kind, path, pageCount] of PAGE_GROUPS) {
    const pages = await Promise.all(Array.from({ length: pageCount }, (_, view) => fetchText(
      `${KIRANICO_BASE_URL}/${locale}/data/${path}${pageCount > 1 ? `?view=${view}` : ''}`,
    )))
    const allowedIds = new Set(snapshot.catalog[`${path}`].map(record => record.ref.id))
    const records = pages.flatMap(page => extractNames(page, kind))
      .filter(record => allowedIds.has(record.id))
    localeNames[kind] = Object.fromEntries(deduplicate(records).map(record => [record.id, record.name]))
  }

  names[locale] = localeNames
  console.log(`${locale}: ${Object.values(localeNames).reduce((total, values) => total + Object.keys(values).length, 0)} names`)
}

await mkdir(resolve('packages/data/locales'), { recursive: true })
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  locales: names,
}, null, 2)}\n`)

console.log(`Wrote ${OUTPUT_PATH}`)

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Kiranico request failed (${response.status}): ${url}`)
  }
  return response.text()
}

function extractNames(html, kind) {
  const path = kind === 'armor' ? 'armors' : `${kind}s`
  return [...html.matchAll(new RegExp(
    `href=["'][^"']*/data/${path}/(\\d+)["'][^>]*>([\\s\\S]*?)<\\/a>`,
    'gi',
  ))].map(match => ({
    id: String(match[1]),
    name: stripMarkup(match[2]),
  }))
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
  return [...new Map(records.map(record => [record.id, record])).values()]
}
