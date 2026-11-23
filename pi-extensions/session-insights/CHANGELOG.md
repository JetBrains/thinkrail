# @thinkrail/pi-session-insights

## 0.2.0

### Minor Changes

- [#1464](https://github.com/JetBrains/thinkrail/pull/1464) [`3353327`](https://github.com/JetBrains/thinkrail/commit/3353327f4681fd570c74abf7fc4b25ffd96af512) Thanks [@danyaberezun](https://github.com/danyaberezun)! - An Overview for library consumers: `buildOverviewCards`, `composeOverview` and `parseOverviewParams`
  compose one session's cards (what happened, plan, cost, errors, context, files, subagents, turns,
  findings) from one trace snapshot, served as the new `session.overview` query (payload version 11).
  A session now ends at its last work, so a model or thinking-level change appended when a chat is
  reopened no longer stretches its wall time; shell commands that write into a file count as edits in
  activity and sequences; and export paths in `/insights` reports are masked like the rest of the text.

### Patch Changes

- [#1468](https://github.com/JetBrains/thinkrail/pull/1468) [`77eec12`](https://github.com/JetBrains/thinkrail/commit/77eec12d27cd3e414537ffd3a584cf4a07b403bf) Thanks [@rsolmano](https://github.com/rsolmano)! - Add a pi.dev gallery preview: a short clip of `/insights` reporting findings, usage and cost for a
  folder's sessions.

## 0.1.0

### Minor Changes

- [#1417](https://github.com/JetBrains/thinkrail/pull/1417) [`aa49bfc`](https://github.com/JetBrains/thinkrail/commit/aa49bfc34df740604274c7ae478838979054cf3a) Thanks [@danyaberezun](https://github.com/danyaberezun)! - Add `@thinkrail/pi-session-insights` to npm: an `/insights` command for vanilla pi that reads your local
  pi sessions — no model, no network — and reports rule-based findings (commands that keep failing with a
  confidence interval, skills listed but never loaded, rework, loops, oversized output, context-limit hits,
  cost outliers, subagent spend pi's total misses), a usage and cost summary with pi's recorded totals, and
  the latest sessions. `--all` covers every folder, `--session <id>` summarizes one session (turns, errors
  and their recovery, context peak, why it cost what it did), and `--html` / `--trace` write a
  self-contained HTML page or a Chrome trace under the agent dir. Figures carry their origin (`≈` estimate,
  `≥` lower bound, `?` not recorded or not measured). The package is also the analysis library behind
  ThinkRail's Session insights (`.`, `./core`, and `./extension` with `createSessionInsightsExtension`).
