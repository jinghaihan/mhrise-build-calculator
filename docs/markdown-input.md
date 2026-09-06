# Markdown build input

`parseMarkdownBuildRequirements` reads checked skill lines from build notes and resolves their localized names to Kiranico Wiki IDs. It returns requirement groups; a group with more than one value is expanded into separate build definitions by `expandMarkdownBuildRequirements`.

Supported patterns include:

```md
## 弓
### 属性配装
- [x] 攻击7
- [x] 属性攻击强化5
- [x] 弱点特效【属性】3/1
- [x] 弹种强化3：通常弹·连射箭强化3/散弹·扩散箭强化3/贯穿弹·贯穿箭强化3
```

`属性攻击强化5` is treated as five alternatives for Fire, Water, Thunder, Ice, and Dragon Attack Up 5. `弹种强化3` is treated as three alternatives for Normal, Spread, and Pierce Shot Up 3. A slash between levels, such as `3/1`, is treated as an alternative level for the same skill. Questionable lines marked `[?]` and informational lines marked `[I]` are included by default; pass `includeQuestionable: false` to omit `[?]` lines.

The parser recognizes level-four build headings and a `### 属性配装` section nested below a higher-level weapon heading. A sibling `### 武器` table is attached to the requirement as `weaponOptions`, including its type and element column; inline `+ 武器：...` notes are also captured. The planner still requires a canonical `weaponId` for each search, so callers can resolve or present these localized names at the data boundary.

The repository keeps a representative input at `packages/data/tests/fixtures/monster-hunter-rise.md` and tests it against the synchronized source snapshot.
