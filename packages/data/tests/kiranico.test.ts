import { describe, expect, it } from 'vitest'
import {
  parseKiranicoArmors,
  parseKiranicoDecorations,
  parseKiranicoSkills,
  parseKiranicoWeapons,
} from '../src/kiranico'

const skillsHtml = `
  <table><tbody>
    <tr><td><a href="https://mhrise.kiranico.com/zh/data/skills/366824395">
      <p>攻击</p>
    </a></td><td><small>Lv1 攻击力+3</small><small>Lv7 攻击力+10</small></td></tr>
  </tbody></table>
`

const decorationsHtml = `
  <table><tbody>
    <tr>
      <td><a href="https://mhrise.kiranico.com/zh/data/decorations/123">攻击珠Ⅱ【4】</a></td>
      <td><div><a href="https://mhrise.kiranico.com/zh/data/skills/366824395">攻击</a> Lv2</div></td>
      <td>攻击力+6</td>
    </tr>
  </tbody></table>
`

const armorsHtml = `
  <table><tbody>
    <tr>
      <td><img src="avatar.webp"></td>
      <td><img src="avatar.webp"></td>
      <td><a href="https://mhrise.kiranico.com/zh/data/armors/456">测试头盔</a></td>
      <td><img src="deco2.png"><img src="deco1.png"></td>
      <td><div>126</div><div>0</div></td>
      <td><a href="https://mhrise.kiranico.com/zh/data/skills/366824395">攻击</a> Lv1</td>
    </tr>
  </tbody></table>
`

const weaponsHtml = `
  <table><tbody>
    <tr>
      <td><img src="avatar.webp"></td>
      <td><a href="https://mhrise.kiranico.com/zh/data/weapons/789">测试武器</a></td>
      <td>插槽 <img src="deco4.png"><img src="deco2.png"> 百龙插槽</td>
      <td>350</td>
    </tr>
  </tbody></table>
`

describe('kiranico HTML importers', () => {
  it('imports skill ids and maximum levels', () => {
    expect(parseKiranicoSkills(skillsHtml)).toEqual([{
      maxLevel: 7,
      names: { zh: '攻击' },
      ref: { id: '366824395', kind: 'skill', source: 'kiranico' },
    }])
  })

  it('imports decoration slot and skill data', () => {
    const [record] = parseKiranicoDecorations(decorationsHtml)

    expect(record.decoration.slotLevel).toBe(4)
    expect(record.decoration.skills).toEqual([{ level: 2, skillId: '366824395' }])
    expect(record.names.zh).toBe('攻击珠Ⅱ【4】')
  })

  it('imports armor defense, base slots, and skills', () => {
    const [record] = parseKiranicoArmors(armorsHtml, {
      costBudget: 16,
      slot: 'head',
    })

    expect(record.armor).toMatchObject({
      baseDefense: 126,
      costBudget: 16,
      slot: 'head',
      slots: [2, 1, 0],
    })
    expect(record.armor.baseSkills).toEqual([{ level: 1, skillId: '366824395' }])
  })

  it('imports weapon slots and skills', () => {
    const [record] = parseKiranicoWeapons(weaponsHtml)

    expect(record.weapon).toEqual({
      ref: { id: '789', kind: 'weapon', source: 'kiranico' },
      skills: [],
      slots: [4, 2, 0],
    })
  })
})
