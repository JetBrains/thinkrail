# Resources UI redesign — mockups and research

Design exploration for the chat **Resources** surface (`apps/web/src/chat/resources`): how background
commands and subagents are listed, inspected and stopped.

**Outcome of the review:** combine the header trigger and row grammar of A, the composer dock of B and
the inspector sheet of F into one direction, **G**. The trigger is the always-present control, the dock
is the ambient live view above the composer, and the inspector (opened from the trigger, a dock row,
the "N still running" chip, or *Inspect* on a tool card) is the detail view over the message list.
One live roster at a time; the same row grammar everywhere; authority rules unchanged.

**Beyond the chat column** (`workbench.html`): the same three facts already exist per chat on the wire
(`SessionState.execution`, `needsInput`, `completionUnread`) but render only on the Projects-rail rows.
The workbench page applies one vocabulary — working = primary + motion, needs-you = amber, finished-unread =
static primary — to chat tabs, rail rows (counts + blocker), the composer tray, the closed-chat menu and a
workspace-scoped inspector. Only the last needs a new wire read.

| File | What |
| --- | --- |
| `index.html` + `styles.css` + `mock.js` + `icons.js` | Interactive mockup page. **G — Combined (trigger · dock · inspector)** is the recommended direction and is shown first as two live frames; the six explored placements A–F follow as alternatives and component sources, plus shared trigger states and the row vocabulary. 4 themes × 5 scenarios, live timers, working Stop / Stop-all / dismiss / inspect interactions, `↑↓` and `Esc`. No build step. |
| `workbench.html` + `workbench.js` | **G across the workbench**: the whole shell (top bar, projects rail, center tab strip, chat with G, side tools) with one status vocabulary — chat-tab adornments, rail-row counts and blocker names, a composer tray that merges `QueueStrip` with the dock, a closed-chat menu that shows closed-but-running chats, and the inspector in workspace scope. Includes the status-vocabulary legend and a surface map (today → with G → wire → tier). |
| `COMPETITIVE-ANALYSIS.md` | Product-by-product survey (Claude Code, Codex, Cursor, Zed, T3 Code, Conductor, Air, Zencoder, Warp, Amp, Antigravity, Gemini CLI, OpenCode, Kiro, VS Code, Devin, …) with cited sources, a pattern catalogue and the design principles the mockups implement. |
| `baseline/` | Screenshots of the popover that ships today, captured with a populated snapshot. |
| `capture-baseline.spec.ts` | The Playwright script that produced `baseline/`: it intercepts `session.resources` on the WebSocket and injects a populated `SessionResources` payload. |

## View the mockups

Serve the repository root (the stylesheet imports the Geist / JetBrains Mono fonts from
`apps/web/node_modules`, so run `bun install` first) and open the page:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
# → http://127.0.0.1:8765/designs/2026-10-05-resources-redesign/index.html
# → http://127.0.0.1:8765/designs/2026-10-05-resources-redesign/workbench.html
```

## Re-capture the baseline

Copy `capture-baseline.spec.ts` into `e2e/` (Playwright's `testDir`), restore its fixture imports to
`./fixtures/...`, and run it serially:

```sh
bun run e2e -- --serial e2e/capture-baseline.spec.ts
# screenshots land in e2e/screenshots/baseline/ (gitignored)
```

The palette, type and spacing values in `styles.css` are copied from
`apps/web/src/themes/bundled/*.theme.json`, `apps/web/src/styles/typography.json` and
`apps/web/src/styles/spacing.json`; the semantic roles mirror `styles/generated/colors.css`. They
are a snapshot for design review, not a second source of truth — the app's generated CSS remains
authoritative.
