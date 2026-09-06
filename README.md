# MHRise Build Tools

Build planner and equipment-reuse optimizer for Monster Hunter Rise: Sunbreak.

The planner combines weapons, armor, decorations, talismans, and Qurious Crafting variants. Results are ranked by the fewest unique armor pieces first, then by total defense.

> [!WARNING]
> Data and rules are based on Monster Hunter Rise: Sunbreak version 16.0.0. Back up your build notes before using generated results.

## Data

The repository includes a synchronized source snapshot with Kiranico Wiki IDs and the offline rule workbook used for Qurious Crafting and talisman legality. See [the source data guide](docs/source-data.md) for refreshing it.

Skill and equipment names are localized at the data boundary; algorithms use stable Wiki IDs internally.

## Packages

- `packages/core`: domain rules and build optimization algorithms
- `packages/data`: normalized source data, localization mappings, and source importers
