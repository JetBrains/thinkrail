---
id: ext-ultracode
type: submodule-design
status: active
title: ultracode — dynamic workflows over tr.agents subagents
parent: module-ext-sdk
depends-on: [module-ext-sdk]
references: [submodule-server-ext, submodule-web-ext, module-pi-delegation, ext-test-runner]
tags: [extensions, example]
---

## Responsibility

A port of the user's pi extension `pi-ultracode` (dynamic workflows). The model writes a JavaScript
orchestration script and passes it to the `Ultracode` tool. The script fans work out to many subagents
through `agent()` / `parallel()` / `pipeline()` / `phase()` / `log()` and returns one value, which becomes
the tool result. Every subagent is a `tr.agents` child of the calling chat, so it is a ThinkRail-managed
delegation child with pi's own usage and cost. The user watches runs live in a tab, lists and cancels them
in a panel, and sees compact progress in the tool card and the topbar. The SDK README's reference for
`tr.agents`.

## Runtime (host half)

Taken from `pi-ultracode/src/runtime` and kept close to it:

- `loader.ts`: string-level scanner; `meta` is parsed as a pure literal, never evaluated; the body runs
  in an `AsyncFunction` with the globals as parameters. No `import`, no `export` except `meta`.
- `determinism.ts`: `Date` / `Math` proxies that throw on `Date.now()`, argless `new Date()`, `Date()`,
  and `Math.random()`, so a resume replays the same path.
- `validate.ts`: schema checks on typebox's JSON Schema engine; an unenforceable keyword throws before
  any child starts.
- `parallel.ts`: order-keeping `parallel` (a thrown task is `null`; `failFast` cancels the batch) and
  barrier-free `pipeline` (a stage that throws or returns `null` drops that item).
- `rails.ts`: ceilings per run: `maxAgents` (default 1000), items per batch (4096), `agentTimeoutMs`,
  `maxCost`. A ceiling throws out of `agent()` and out of an enclosing batch.
- `journal.ts`: append-only `journal.jsonl`, keyed by the content of each `agent()` call (prompt, schema,
  model, agentType, tools, system, effort, maxTurns). Replay is prefix-only; failures replay unless
  `resumeRetryFailed`; cancelled calls are never journaled.

What changed from `pi-ultracode`:

- **Transport.** The `spawn`, `sdk` and `worker` backends are gone. `agent.ts` builds an `AgentSpec` and
  `index.ts` runs it with `tr.agents.spawn(spec, { parent: toolCtx, signal, maxConcurrent })`. The spawn
  backend is never an option here: it re-executes `process.execPath`, which is the ThinkRail server.
- **Options.** `model` is `provider/id` or a unique part of it, matched against the tool ctx's
  `modelRegistry`. `effort` → `thinkingLevel`. `tools: []` means no tools. `system` and `agentType` (a
  `.pi/agents/<name>.md` body, whose `tools` / `model` frontmatter applies) become the child's
  `systemPrompt`, which replaces pi's base prompt, like the built-in `Agent` tool's roles. `label` is the
  child's `role`. `maxTurns` is new. `cwd` is refused: children share the chat's working directory.
- **Schema retry.** A reply that fails the schema gets one corrective child; its usage adds to the
  same agent row.
- **Concurrency.** One run-wide permit pool (`concurrency`, 1 to 16, default 6) bounds `agent()` before
  the spawn; the same number is the `tr.agents` pool size.
- **Cost.** pi owns it. An agent row's usage is pi's per-run usage from `tr.agents` progress and
  settled events, summed over its attempts. Run totals and the `maxCost` brake sum those rows. Replayed
  agents cost nothing. The extension never prices tokens.
- **Limits** come from tool parameters, not `PI_ULTRACODE_*` environment variables.
- **No commands.** `/ultracode <file>` and `/ultracodes` are replaced by the tool, the panel and the tab.

## Run model (`model.ts`, shared)

`WorkflowRun`: `{ runId, name, description, status: running | completed | failed | aborted,
parentSessionId, startedAt, endedAt?, phases, agents, logs (last 200), limits, args?, result?, error?,
resumedFrom? }`. `PhaseRow`: `{ index, title, detail? }` (detail from `meta.phases`). `AgentRow`:
`{ index, label, phaseIndex, state: queued | running | done | failed | aborted, attempt, queuedAt,
startedAt?, endedAt?, prompt, usage, childId?, model?, activity?, output? (tail), result? (schema
value), error?, replayed? }`. A run that finishes with no successful agent is `failed`. When the script
returns or throws, `run.ts` cancels every `agent()` call still queued or running (for example an
un-awaited one) and waits for it before the run settles, so no child outlives its run; later `agent()`
calls return `null`.

`RunSummary` (`summarize`) is the compact form: counts per state, current phase, cost, budget.

## Host half

- `pi.ts` registers `Ultracode` (sequential) with `script`, `args`, `resumeFromRunId`,
  `resumeRetryFailed`, `concurrency`, `maxAgents`, `maxCost`, `agentTimeoutMs`. `onUpdate` streams a
  live text plus the `RunSummary` every 250 ms while something changed. The result is a text summary
  (header, log tail, result JSON up to 12 000 chars, journal path) with `details` = the final
  `RunSummary`. A script without `meta` or an unknown resume id throws.
- Channels: `runs` = summaries, live runs first; `run:<runId>` = the full run, only while a view watches
  it (`tr.onWatch`).
- Actions: `cancel { runId }` aborts the run's controller and calls `cancel()` on every live
  `tr.agents` handle, then resolves `{ cancelled }`; `forget { runId }` drops a finished run.
- Aborting the tool call (the user stops the chat) cancels the run. Unloading the extension cancels
  every run, waits for it to settle, and still saves it (as `aborted`), so its journal stays for a resume.
- Persistence: the 20 newest finished runs in `tr.store` (`runs`), capped (prompts and outputs 1 500
  chars, values 4 000 chars, logs 50). A stored run still `running` loads as `aborted`. Journals and a copy
  of the script live in `$THINKRAIL_DATA_DIR/ultracode/runs/<runId>/` (default `~/.thinkrail`), never in
  the extension directory; journals of runs no longer kept are deleted. Every save merges the stored list
  with the in-memory one by `runId`, and each flush adopts a list another generation stored, so a run
  that an unloading generation saves after the reload still shows and keeps its journal. An unloading
  generation never prunes journals.

## Views

- `run` (tab, "Workflow run"; `params.runId`, else the newest run): header with status, agents done /
  total, running, failed, tokens, cost / budget, time, concurrency, progress bar, and **Cancel** while
  running. Phases are columns; each agent is a card with a status colour, cost, model or current
  activity, duration, and a bar placing it on the run's time axis. Clicking a card opens its details:
  status, attempt, model, pi usage, child session id, error, structured result or output, prompt. The
  log is below.
- `workflows` (panel): running and finished runs with progress, cost, time, and open / cancel / remove.
- `workflow-card` (toolCard for `Ultracode`): name, current phase, agents done / total, failures, cost,
  time, and open-run. It prefers the live `runs` summary while the call runs.
- `status`: while runs are going, `wf: 3/8 agents · $0.21`; opens the run, or the panel for several.

## Boundary

- Public surface: the four surfaces, actions `cancel` / `forget`, channels `runs` and `run:<runId>`, and
  the `Ultracode` pi tool.
- Host half: `index.ts`, `pi.ts`, `run.ts`, `agent.ts`, `loader.ts`, `determinism.ts`, `validate.ts`,
  `parallel.ts`, `rails.ts`, `journal.ts`, `persist.ts`, `summary.ts`, `types.ts`. Views: the `.tsx` files
  plus `hooks.ts`. `model.ts` is shared (types and pure helpers, no Node imports).
- Allowed dependencies: `@thinkrail/ext`, `@thinkrail/ext/view`, `react`, `typebox`,
  `@earendil-works/pi-coding-agent` (host half: agent-file lookup and types), Node built-ins.
- Forbidden: ThinkRail package internals, creating pi sessions directly, spawning processes, views
  importing host-half files.

## Known limitations

- The script runs with host privileges (`AsyncFunction`, no sandbox); pi's tool approval is the only gate.
- Every child is an in-process session on the host's event loop; a wide fan-out slows the UI stream, and
  a fatal child fault can take the host down.
- Runs start only from the tool, so a run needs a live parent chat; closing the chat aborts its children.
- No git worktree per child, no `cwd` per agent, children do not see `tr.pi` tools (so workflows cannot
  nest), and children are not listed as chats.
- A reload cancels running workflows; resume them with `resumeFromRunId`.
- Browser E2E covers only seeded runs. The live path (status item, streaming card, **Cancel**) is covered
  at host level in `ultracodeExample.test.ts`; E2E has no provider fake to drive a live run.
- Replayed results do not replay side effects: files an agent edited must still be on disk.
