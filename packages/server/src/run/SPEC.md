---
id: submodule-server-run
type: submodule-design
status: draft
title: run — the project's run recipe, port leases and runs as command tabs
parent: module-server
depends-on: [module-contracts, submodule-server-terminal, submodule-server-workspaces, submodule-server-persistence]
references: [submodule-web-shell-location-bar, submodule-web-panels, module-thinkrail-workflow]
tags: [run, workspaces, terminal]
---

## Responsibility

"Run this project" as one click per workspace. A project's **recipe** — how it is prepared and which
targets run it — is learned once by the agent (or edited by the user) and stored on this machine; a
**run** executes one target in one workspace as a terminal command tab with that workspace's own ports,
and this module knows whether it is starting, running, listening, exited with which code, or stopped.
The agent uses the same recipe and the same runs to verify its work.

## Boundary

- **Owns:** `run.json` under the data dir (recipes with revision and per-project settings, per-workspace
  port leases, per-target last-run metadata — never output); recipe validation; port leasing; the
  per-(workspace, target) execution state and its retained diagnostics tail; the script a command tab
  runs and the environment it gets; the `run.recipe` / `run.state` publisher seam.
- **Public surface (barrel):** `getProjectRun`, `setRecipe`, `setPrimaryTarget`, `setRunSettings`,
  `startRun`, `restartRun`, `stopRun`, `runPrepare`, `listRunState`, `readRunOutput`,
  `stopWorkspaceRuns`, `forgetWorkspaceRuns`, `setRunPublisher`, `resetRunState` (test seam), the
  validator `validateRecipe` and the `RunRecipeError` field-error type.
- **Consumers:** `host` serves `run.*`, wires the publisher, installs the agent tool's seam, and calls
  `stopWorkspaceRuns(id, { force: true })` from workspace removal and host stop — before terminals close
  and the worktree is reclaimed. The `run_project` tool (`agent`) reaches every operation through that
  seam; the web reads snapshots and folds pushes.
- **Allowed deps:** `terminal` (command tabs), `workspaces` and `projects` (read-only lookups),
  `persistence`, `log`, `contracts`, `@thinkrail/shared/freePort`.
- **Forbidden:** `host`, `agent`, any PTY of its own, any recorder of its own, persisting output or PIDs.

## The recipe

Commands are **POSIX `sh`** and run through `/bin/sh`, never the user's `$SHELL` — the environment is the
terminal module's filtered copy of the host's login-shell environment (so a mise shim or nvm's default
on `PATH` is there) plus the variables below; aliases and shell functions are out of contract.

```ts
type RunRecipe = {
  version: 1;
  ports: Record<string, number>;   // env var name → natural port, e.g. { PORT: 5173, API_PORT: 3100 }
  prepare: string[];               // idempotent; run before every start, in the worktree root
  targets: RunTarget[];            // ≥ 1
  primary: string;                 // RunTarget.id
  notes?: string;                  // the agent's caveats: shared DB, docker must be up, binds loopback only …
};
type RunTarget = {
  id: string; title?: string;
  command: string;                 // POSIX sh
  kind: "serve" | "task";          // long-running vs one-shot
  ports?: string[];                // declared variables this target binds (serve only)
  url?: string;                    // "http://localhost:${PORT}/" — placeholders only for declared variables
  cwd?: string;                    // worktree-relative, default "."
};
```

Host-stamped on every write, never caller-supplied: `revision` (monotonic; every write carries
`expectedRevision` and a mismatch is `RUN_RECIPE_CONFLICT` with the current document), `learnedAt`, and
`learnedBy` — `{ sessionId, workspaceId }` for a tool write, `"user"` for the Edit dialog.

**Validation** (structured field errors, the same for the tool and the dialog): target ids
`^[a-z0-9][a-z0-9._-]{0,40}$` and unique; `primary` names a target; at least one target; variable names
`^[A-Z_][A-Z0-9_]*$` and never `PATH`, `HOME`, `SHELL`, `USER`, `TMPDIR`, `LD_*`, `DYLD_*`, `THINKRAIL_*`,
`PI_*`; natural ports 1024–65535 and unique across variables; `url` is `http(s)://` and references only
declared variables; `cwd` relative, inside the worktree, no `..`; at most 32 prepare commands, 32
targets, 4 KB per command, 32 KB per document. **Settings** per project — `autoOpen` (default off) and
`agentMayRun` (default on) — are the user's and never written by the tool.

## Port leases

Every start resolves each declared variable to a port for that workspace. Allocation is **serialized
host-wide** (one promise chain) and the slot is **claimed synchronously before the first await**, so two
workspaces whose installers run for minutes cannot both pick the same number. A candidate is skipped when
it is leased by any live run on this host, assigned to a sibling workspace of the same project, already
chosen for another variable of this start, or not free (`isPortFree`). The Default workspace prefers
the natural value; a worktree scans upward from natural + 1. Once made, an assignment is stable per
`(workspaceId, varName)` and persisted; it is **never re-probed while any run of the workspace is live**
(the workspace's own listener is not a collision) and, when idle, moves only if an outsider occupies it.
More than 64 misses is `RUN_NO_FREE_PORT` — never an OS-random port a URL or a CORS allow-list would not
expect. Only serve targets that declare `ports` lease; a second live target binding a variable another
live target holds is refused (`RUN_PORT_IN_USE`). Removing a workspace drops its leases.

The environment a run gets: the declared variables, plus `THINKRAIL_RUN_DEFAULT_WORKTREE` (the project
folder — in the Default workspace it equals the cwd, which is why prepare copies are written as
`[ -f .env ] || cp "$THINKRAIL_RUN_DEFAULT_WORKTREE/.env" .env`), `THINKRAIL_RUN_WORKSPACE`,
`THINKRAIL_RUN_TARGET` and `THINKRAIL_RUN_ID`. The prefix is a sub-namespace the terminal filter would
strip from an *inherited* environment and that can never collide with the host's own `THINKRAIL_PORT`.

## Execution

`startRun(workspaceId, targetId, { prepare = true, origin })`:

1. **Admission is synchronous.** The `(workspace, target)` slot is claimed as `starting` with a fresh
   `runId` before anything is awaited; a live or stopping slot is `RUN_ALREADY_RUNNING`; a removed
   workspace or a win32 host is refused before leasing (`RUN_UNSUPPORTED_PLATFORM`). Every later
   callback — lease, probe, ended, timer — is identity-checked against the `runId` and dropped when stale.
2. **A snapshot** of the command, prepare list, cwd, ports and url is captured at admission. Recipe
   edits affect later starts only; Stop, output and the footer resolve the owned execution even when its
   target was renamed or removed meanwhile.
3. **Prepare is serialized per workspace** — two targets started together run their installers one after
   the other, never two `bun install`s into one `node_modules`.
4. **The script** is composed with single-quote escaping, one dim `$ <command>` echo line per command,
   `set -e`, no `exec`: a prepare failure exits with that command's code; the target runs last, so the
   shell's exit status is the target's (a signal is 128 + n). Non-interactive `sh` has no job control, so
   the shell and every descendant share the process group the terminal module signals.
5. The command tab is `thinkrail-run:<targetId>`, titled by the target; `runPrepare` uses
   `thinkrail-run-prepare`, outside the target namespace, with the same lifecycle.

**State** per slot: `starting → running → listening → exited { code }`, or `stopping → stopped`, plus the
persisted `lastRun` for an idle slot. `listening` comes from a TCP probe of the url's port every second,
or — for a serve target without `url` — from a loopback URL found in the first 64 KB of the recording,
read without attaching. **`stopped` is intent, not an exit code**: Stop, the agent's stop, a tab close,
workspace removal and host stop set the intent first, and whatever end follows is `stopped`; an end
nobody asked for is `exited { code }`, an OOM kill included. `restartRun` is one operation — stop, await
the ended callback, start under the same tab with a fresh recording — so no client can interleave.

**Teardown.** `stopWorkspaceRuns(id, { force })` closes admission for the workspace (pending starts are
cancelled, late callbacks dropped), SIGKILLs every live group and resolves when the terminal reports each
end; the host calls it before `closeWorkspaceTerminals` and before the worktree is reclaimed, so a dev
server's watcher cannot recreate files under `git worktree remove`.

**Diagnostics.** At every end the execution's ANSI-stripped tail (≤ 64 KB) is retained in memory on the
record (current and last-ended execution per slot) for the agent's `output`; `run.json` keeps only
`{ runId, startedAt, endedAt, status, exitCode }`, so after a host restart every command tab is
reconstructed as `exited { code: null }` — ended, outcome unknown — never a fabricated code.

## Decisions

- **The recipe lives on this machine, not in the repository.** Nothing repo-controlled executes, so no
  trust grant is involved; another machine or a lost file means "Set up" again. Accepted: the repo does
  not learn.
- **One run owner, two callers.** The user's button and the agent's `run_project` start the same runs,
  so a verification run the agent starts is visible in the user's terminal tab and segment, shares the
  workspace's ports, and respects the `agentMayRun` setting at call time — the tool is always registered
  (a per-project tool toggle would bust pi's prompt cache) and refuses with `RUN_AGENT_FORBIDDEN`.
- **Declared port variables, not a fixed `THINKRAIL_PORT`.** The terminal filter strips the host's own
  prefix and `THINKRAIL_PORT` already means the host's port; a recipe that names `PORT` or `API_PORT`
  says exactly what the project reads.
- **Leases over probes.** `isPortFree` reserves nothing; a bind can be minutes away behind an
  installer. The lease is the reservation; the probe only confirms the outside world.
- **Intent decides `stopped`.** `bun-pty.kill()` fires a synthetic exit 0 and a group kill ends with a
  signal code; neither may read as success or as a crash when the user asked for it.
- **No `exec`, no `$SHELL`, no `-i`.** `exec <command>` mis-executes compound commands and inline
  assignments; the user's shell may be fish; an interactive shell's job control puts children in their
  own process groups where Stop cannot reach them.
- **Output is read, never attached.** Diagnostics and the URL scan use `readTerminalRecording`; an
  attach would take the PTY over from the user. The tail retained at exit is the only run-owned copy,
  bounded, and never persisted.
- **Rejected:** a run-owned PTY and rendering path (duplicates the recorder, takeover, data channels,
  xterm body); typing into the interactive shell (no exit status); inlining logs into agent prompts
  (the agent pulls `output` for the execution it was asked about); a standalone `pi-run` package
  (nothing to run without the host); per-command result attribution (the terminal shows which command
  failed; the status is the exit code).

## Restrictions

- Admission, intent flags and lease claims happen synchronously, before any `await`; a refactor that
  moves them past one reintroduces double starts and lost stops.
- Never derive `stopped`/`exited` from an exit code alone.
- Never persist output, PIDs, or a running status; a host restart must not resurrect a run.
- `run.json` writes are atomic complete copies like the module's siblings.

## Validation

- `recipe.test.ts` — every validation rule, revision compare-and-set, host-stamped provenance.
- `ports.test.ts` — Default preference, worktree offset, stability while live, re-probe when idle,
  sibling and cross-variable exclusion, `RUN_NO_FREE_PORT`, concurrent starts in two workspaces during a
  slow prepare receive distinct ports.
- `script.test.ts` — quoting (quotes, newlines), `a && b`, `FOO=1 cmd`, `cd`, prepare failure code.
- `runs.test.ts` — the state machine with a fake terminal seam: intent-based `stopped`, restart, a
  cancelled start, removal mid-allocation, recipe save during a run leaving the live snapshot intact,
  URL discovery from output, reconstruction after restart.
- Real-PTY coverage of command tabs lives in `terminal`; the wire and skew cases in `host`.
