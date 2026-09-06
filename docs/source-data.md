# Source data

The checked-in snapshot is generated from two sources:

- Kiranico provides localized names, Wiki IDs, base armor defense and resistances, armor slots, weapon slots and skills, and decorations.
- `dtlnor rise sunbreak乱七八糟数据合集.xlsx` provides armor-series Cost budgets, Qurious Crafting entries, skill costs, and talisman rules.

Refresh the snapshot with:

```sh
pnpm sources:sync -- --workbook "/path/to/dtlnor rise sunbreak乱七八糟数据合集.xlsx"
```

The command writes `packages/data/snapshots/source-snapshot.json`. It fetches Kiranico pages for all current skills, decorations, armor views, and weapon views, then joins the workbook rules by localized skill and armor-series names.

The workbook sheets used by the importer are:

| Sheet | Imported data |
| --- | --- |
| `装备` | armor-series ID, Qurious Crafting pool, and Cost budget |
| `词条` | defense, resistance, skill, and slot Qurious Crafting entries |
| `技能` | game skill IDs, names, and skill cost tiers |
| `护石` | talisman skill limits, slot combinations, weights, and rates |

Use `parseSourceSnapshot` to load the JSON and `searchSnapshotBuild` to search from a selected weapon and required skill IDs. `generateTalismanRecords` expands legal talismans only for the skills in a target. `armorComponentsForPool` expands the generic skill/defense/resistance/slot entries for a selected Qurious Crafting pool.

Pass `generateArmorVariants: true` to a snapshot search to derive Qurious Crafting variants automatically for the requested armor records. The default generation limit is the confirmed seven operations per armor. `maxOperations` and `maxVariants` are explicit preview/test limits; they are not game rules and are not used by default.

Snapshot searches retain armor variant identities. The solver may merge equivalent partial search states only when the selected equipment identity is not needed by the caller; reuse planning keeps identities so a locally weaker-looking piece can still be shared by multiple builds.

Armor, weapon, and decoration records retain Kiranico numeric IDs. Local talisman candidates use `local:` IDs because talismans are generated states rather than Kiranico equipment records.
