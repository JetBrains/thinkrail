---
id: ext-test-runner
type: submodule-design
status: active
title: test-runner — run the workspace's tests from a panel or from the agent
parent: module-ext-sdk
depends-on: [module-ext-sdk]
references: [submodule-server-ext, submodule-web-ext, ext-timeline, ext-railmap, ext-git-pulse, ext-tool-guard]
tags: [extensions, example]
---

## Responsibility

Runs the active workspace's tests, shows what failed with the error, and hands a failure to a new chat.
The agent runs the same tests through a `run_tests` tool and gets a short summary. A ThinkRail UI
extension written only against `@thinkrail/ext` and `@thinkrail/ext/view`; the SDK README's reference for
a long-running child process with cancel, and for a `tr.pi` tool that shares state with a panel.

## Runner

`detect.ts` reads the workspace's `package.json` (pure `detectRunner` on the parsed value):

| `scripts.test` | Runs | Results from |
| --- | --- | --- |
| missing, or npm's `no test specified` placeholder; no `package.json` | `bun test <filter…>` | JUnit |
| starts with `bun test`, no shell operators | `bun run test -- <filter…>` | JUnit |
| starts with `vitest`, no shell operators | `bun run test -- <filter…>` | JUnit |
| anything else | `bun run test -- <filter…>` (`bun run test` without a filter) | console |

JUnit runs add the runner's reporter flags (`--reporter=junit --reporter-outfile=<tmp>` for bun,
`--reporter=default --reporter=junit --outputFile.junit=<tmp>` for vitest) and read the file after exit
(`junit.ts`, `fast-xml-parser`). The console fallback (`console.ts`) reads bun's summary lines (`N pass`,
`N fail`, `N skip`, `N todo`, summed over every package a script runs) and each `(fail) name` line with
the error lines printed above it. An invalid `package.json` is a runner `error`; the panel shows it and
Run is off.

`filter` is split on whitespace into positional arguments: for bun and vitest each is a file path
substring. A part starting with `-` is rejected so a filter can never become a flag, and control characters
are rejected; `bun run` quotes the arguments it appends to the script.

## Process

- `spawn` with no shell, `cwd` = the workspace `path` from `tr.workspaces`, `CI=1`, `NO_COLOR=1`,
  `FORCE_COLOR=0`, `detached: true` so cancel reaches the whole process group (`bun run` → shell →
  runner). Cancel and timeout send `SIGTERM` to the group, then `SIGKILL` after 3 s.
- Every run ends: a spawn that throws or a run that rejects becomes an `error` result, so the
  workspace never stays busy.
- Timeout 10 min → outcome `timeout`. `bun` missing from `PATH` or a missing directory → `error`.
- Output: the last 256 KB are kept while running; the result keeps the last 4 KB. The JUnit file lives in
  the OS temp dir (never the extension dir) and is deleted after the run; a report over 20 MB falls back
  to console parsing.
- **One run per workspace.** A panel `run` during a run returns `{ started: false }`. A `run_tests` call
  during a run joins it and says so in its summary; aborting a joined call does not cancel the run.
  Aborting the agent's own call (the user stops the chat) cancels its run. Unloading the extension
  cancels every run.

## Model (`model.ts`, shared)

- `RunResult`: `{ command, filter?, by: panel | agent, startedAt, durationMs, outcome, exitCode, source:
  junit | console, counts { pass, fail, skip }, failures, failuresTotal, output, message? }`.
- `outcome`: `passed` (exit 0, no failures), `failed` (at least one failing test), `error` (non-zero
  exit with no failing test: a load error, no tests found), `cancelled`, `timeout`.
- `Failure`: `{ name, file?, line?, error }`. `name` joins the describe path and the test name with
  ` > `. `error` is at most 30 lines / 1 500 chars; at most 30 failures are kept (`failuresTotal` counts
  all). Skipped counts `skipped` and `todo` tests.
- Channel `tests:<workspaceId>` = `{ runner, running?, last? }`. `runner` is `{ state: ready, label,
  structured }` or `{ state: error, message }`. `running` is `{ command, filter?, by, startedAt,
  lastLine }`, published at most every 250 ms.

## Host half

- The channel is published only while a view watches it (`tr.onWatch`); the runner is detected again on
  each watch start and each run. Unwatching unpublishes unless a run is going.
- The last result per workspace is kept in `tr.store` (`results`), the 10 most recent workspaces only.
- Actions (`ctx.workspaceId`): `run { filter? }` → `{ started, reason? }` without waiting; `cancel` →
  `{ cancelled }`.
- `tr.pi` registers `run_tests({ filter? })`. The workspace is the calling session's (`tr.sessions`),
  else the open workspace whose path is the session `cwd`. The text result is a summary of at most
  4 000 chars: command, counts, outcome, then up to 10 failures with 6-line excerpts, or the output tail
  for `error` / `timeout`. `details` is the `RunResult`. While it runs, `onUpdate` reports the elapsed
  time every second.

## Views

- `runner` (panel): runner label, filter input (Enter runs), **Run** / **Cancel**, the running line
  (elapsed and the last output line), outcome, count chips, then one card per failure with its file,
  the error excerpt, and **Fix with agent** (`startChat` with the test, command, and error, asking to
  confirm with `run_tests`). `error` and `timeout` show the output tail instead.
- `run-tests` (toolCard for `run_tests`): filter, outcome, counts, the first three failing test names,
  and **Open tests** (`openSurface`). Running shows the partial result's elapsed time.

## Boundary

- Public surface: the `runner` and `run-tests` surfaces, actions `run` / `cancel`, the
  `tests:<workspaceId>` channel, and the `run_tests` pi tool.
- Host half: `index.ts`, `pi.ts`, `process.ts`, `detect.ts`, `junit.ts`, `console.ts`. Views: the `.tsx`
  files plus `hooks.ts`. `model.ts` is shared (types and pure helpers, no Node imports).
- Allowed dependencies: `@thinkrail/ext`, `@thinkrail/ext/view`, `react`, `typebox`, `fast-xml-parser`
  (host half), and Node built-ins (`child_process`, `fs`, `os`, `path`, `crypto`) in the host half.
- Forbidden: any ThinkRail package internals, views importing host-half files, the host half importing
  views, running the tests through a shell the extension builds itself.

## Known limitations

- `bun` must be on the host's `PATH`, also for npm, pnpm, and yarn projects (`bun run` runs any
  `package.json` script).
- Jest and other runners use the console fallback; its counts only follow bun's summary format, so
  for them the panel shows the outcome from the exit code and the output tail.
- A filter is a file filter, not a test-name pattern.
- Process-group kill is POSIX only.
- No live pass count: bun prints only failures while a non-TTY run is going.
