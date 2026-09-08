# MHRise Build Calculator

Build planner and equipment-reuse optimizer for Monster Hunter Rise: Sunbreak.

Start a search by selecting a weapon and the required skills. The planner then combines that weapon's skills and decoration slots with armor, talismans, decorations, and Qurious Crafting variants. Results prioritize equipment reuse, then total defense; weapon slots are available for decorations too.

> [!WARNING]
> Data and rules are based on Monster Hunter Rise: Sunbreak version 16.0.0. Back up your data before using generated results.

## Data

The repository includes a synchronized source snapshot with Kiranico Wiki IDs and the offline rule workbook used for Qurious Crafting and talisman legality.

Skill and equipment names are localized at the data boundary; algorithms use stable Wiki IDs internally. `属性攻击强化5` represents five separate searches, one each for Fire, Water, Thunder, Ice, and Dragon Attack Up 5.

## Credits

- [Kiranico](https://mhrise.kiranico.com/) for localized Monster Hunter Rise data and Wiki IDs
- [dtlnor](https://docs.qq.com/sheet/DRndRRWRrU3hxV0Nh?tab=BB08J2) for the offline legality and cost tables

## Packages

- `packages/core`: domain rules and build optimization algorithms
- `packages/data`: normalized source data, localization mappings, and source importers
