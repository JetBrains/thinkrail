---
"@thinkrail/pi-session-insights": minor
---

Add `@thinkrail/pi-session-insights` to npm: an `/insights` command for vanilla pi that reads your local
pi sessions — no model, no network — and reports rule-based findings (commands that keep failing with a
confidence interval, skills listed but never loaded, rework, loops, oversized output, context-limit hits,
cost outliers, subagent spend pi's total misses), a usage and cost summary with pi's recorded totals, and
the latest sessions. `--all` covers every folder, `--session <id>` summarizes one session (turns, errors
and their recovery, context peak, why it cost what it did), and `--html` / `--trace` write a
self-contained HTML page or a Chrome trace under the agent dir. Figures carry their origin (`≈` estimate,
`≥` lower bound, `?` not recorded or not measured). The package is also the analysis library behind
ThinkRail's Session insights (`.`, `./core`, and `./extension` with `createSessionInsightsExtension`).
