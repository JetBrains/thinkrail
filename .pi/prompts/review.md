---
description: "Code review of a file or directory"
argument-hint: "[path] [focus]"
---
Review $1 for correctness, clarity, and maintainability, focusing on ${2:-the riskiest parts}.
List concrete findings with `file:line` references, ordered by severity, and propose a fix for each.
