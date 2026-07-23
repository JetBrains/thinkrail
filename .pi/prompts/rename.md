---
description: "Rename a symbol everywhere (demoes repeated-slot mirroring)"
argument-hint: "[old] [new]"
---
Rename `$1` to `$2` across the codebase: update every definition, reference, and import of `$1`,
plus any docs or comments that mention `$1`. Keep `$2` consistent everywhere and run the type-checker after.
