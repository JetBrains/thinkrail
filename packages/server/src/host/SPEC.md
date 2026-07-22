---
id: submodule-server-host
type: submodule-design
status: active
title: host — the browser↔host wire
parent: module-server
depends-on: [module-contracts]
tags: [v1, host]
---

## Responsibility

The wire and composition root: `Bun.serve` HTTP+WS, static SPA serving, the WS method→handler registry,
channel fan-out, and the process-boot wrapper both launchers share.

## Boundary

- **Owns:** `server.ts` (`createServer` → `Bun.serve` with `/health`, `/ws` upgrade, a
  **`GET /files/<workspaceId>/<relpath>`** route streaming a worktree file's raw bytes (via `fs`'s
  `resolveWorktreeFile` — path-contained; bad id/escape/miss → 404; Bun infers the content-type) so the
  markdown viewer's relative `<img>`s resolve, static serving with
  `index.html` fallback, the `server.welcome` push, `terminal.data` topic subscribe + `server.publish`,
  the **`provider.login`** channel publish (the `auth` module's session-less login-frame bridge, wired like
  `pi.extensionUi`) and the `provider.*` login handlers, the **`watch` wiring** (inject the
  `workspace.fsChanged` publish callback into `watch`; call `ensureWatch(workspaceId)` from the
  workspace-read handlers (`fs.*`, `git.status`/`git.diff`, `spec.graph`) — a read is the "a client is
  looking" signal; `stopWatch` in `workspace.remove`'s fast path beside `evictSpecIndex`;
  `stopAllWatches()` in `stop()`), `cancelAllLogins()` in `stop()` before the socket close,
  an optional boot-time `openProject(projectPath)` (best-effort — a launcher convenience), and
  `stop()` → agent-session + terminal cleanup then socket close); `boot.ts` (`bootHost` → resolve the
  login-shell PATH, pick the port per `portMode` (`"exact"` vs `"free"`), start `createServer`, and
  install SIGINT/SIGTERM handlers that **settle before exit**: `settleSessionsForShutdown()` — abort
  streaming sessions and wait bounded, so pi persists their "Operation aborted" tool results and
  transcripts land paired — then `stop()` + exit; an immediate exit would strand mid-tool transcripts on
  the restart repair); `handlers.ts` (the WS method→handler registry);
  `ackSend.ts` (the send-ack policy — see "Get right"); `autoRename.ts` (the **workspace auto-rename
  flow** — the composition of `agent` + `assist` + `workspaces` only the host may make, in **two passes**
  the session-publisher closure in `createServer` tees fire-and-forget, both triggering a
  `renameWorkspace` (which **self-emits `workspace.updated`** through the lifecycle publisher — the tee no
  longer pushes) and both reading the session **transcript** via `getSessionMessages` (never `agent_end.messages` — that
  array is run-local and empty of the prompt on auto-retry continuations) then `extractFirstTurn` (assist
  skips killed error/aborted turns, so a retracted prompt never becomes the name); an injectable
  transcript reader is the unit-test seam:
  - **Naive (instant):** `maybeNaiveNameWorkspace(sessionId, workspaceId)` when the **first prompt lands**
    (`isPromptCommitted(event)`, exported: a **user `message_end`** — `agent_start`/`turn_start` fire
    *before* the prompt's `message_end`, so the transcript wouldn't yet hold the prompt at those; this
    still fires before the model responds, so the name is instant and no tool/question can block it). It
    derives a **display name** from the first prompt with assist's non-agentic `naiveWorkspaceName` (no
    model call) and renames **provisionally** (`renameWorkspace(..., { lock: false })` — name + derived
    branch move but `renamed` stays unset). It fires only on a **pristine** workspace (`!renamed` AND its
    **branch** still `workspace-N` — gated on the branch, not the display name, so the two stay decoupled),
    so it lands once and never overwrites a user/agentic name; a per-workspace `naiveInFlight`
    set dedupes re-fired prompt-commits. This is why a long first turn no longer leaves the workspace as
    `workspace-N` for minutes.
  - **Agentic (refine):** `maybeAutoRenameWorkspace(sessionId, workspaceId)` on every **settled** turn
    (`isSettledTurn(event)`, exported: `agent_end` with `willRetry: false`). It asks assist for a
    human-readable name (cheap model), re-checks the workspace (exists, not `renamed`) after the await,
    then calls `renameWorkspace` in the same tick — upgrading the provisional naive name into the final
    name (and its derived branch) and **locking** it (`renamed: true`). Best-effort by contract: every failure path resolves `null` and
    leaves the flag unset so a later settled turn retries — but a swallowed exception is `console.warn`ed
    (a broken rename path must stay distinguishable from "assist had nothing"). Its own per-workspace
    **in-flight set** (independent of the naive one — the two passes can overlap on a short turn) dedupes
    concurrent turns/sessions.
  - The **workspace-archive teardown** — the other composition of `agent` + `terminal` + `workspaces` only
    the host may make. `workspace.remove` reaps *everything* rooted in the worktree but is **non-blocking**:
    it does the fast part synchronously — `forgetWorkspace` (drop the record → gone from `workspace.list`
    immediately) → `evictSpecIndex` (drop the spec cache) → `closeWorkspaceTerminals` (kill its PTYs) —
    **acks**, then runs the slow reclamation in the **background** (`archiveTeardown`, fire-and-forget):
    `removeWorkspaceSessions` (abort a streaming turn, dispose the live sessions, **and** purge pi's
    on-disk transcripts for the cwd) → `reclaimWorktree` (`git worktree remove`). So the user never waits
    for the git subprocess + session abort. **Ordering holds:** terminals (sync) and sessions (bg, before
    the reclaim) are down before the dir is deleted, since they hold it as cwd. Best-effort by contract —
    a failed background teardown is `console.warn`ed, never thrown into the void (nothing awaits it), like
    the auto-rename tee. **Archive keeps the branch but not the chat:** the git branch stays (code is
    recoverable), yet chat history is purged with the worktree — a deliberate scope choice, not a leak.
- **Workspace lifecycle fan-out:** `createServer` installs the `workspaces` module's publisher
  (`setWorkspacePublisher`), mapping each domain event `kind` → its `WS_CHANNELS.workspace*` channel
  (`created`/`updated` → the full record; `removed` → `{ projectId, id }`) and `server.publish`ing it. This
  is the **single** place workspace membership changes reach the wire — create/rename/archive all flow
  through it, so every client (including the initiator) converges by reacting, never by per-client optimism.
  The two new channels are `ws.subscribe`d in the WS `open` handler alongside `workspace.updated`.
- **Workspace hooks wiring:** `createServer` installs the `workspaces/hooks` submodule's publisher
  (`setHookPublisher`), publishing every `WorkspaceHookEvent` directly as the `workspace.hook` push
  `data` — a single channel carries the whole discriminated union (no kind→channel split, unlike the
  lifecycle trio; the same shape `watch`'s `workspace.fsChanged` uses), also `ws.subscribe`d in `open`.
  `handlers.ts` adds `workspace.hooks.approve` and `workspace.hooks.run` (re-invokes a specific
  workspace's hook on demand — what the approval flow composes with `approve` to actually bootstrap a
  workspace stuck at `hookAwaitingApproval`, and the standalone manual-retry action) — the latter is
  also why `archiveTeardown`'s `reclaimWorktree(ws)` call is `await`ed: that function became `async`
  once it started awaiting the `onDelete` hook. `workspace.hooks.approve`'s wire shape pre-dates
  per-source approval (`{ projectId, hook, command }` — no `source`), so the handler never trusts the
  client's `command` as the material to hash: it re-resolves both tiers fresh off the **project's root
  path** (`workspaces/hooks`'s `resolveHookRun`, mode `"both"`) and calls `approveHook` (with `source`)
  for whichever resolved entry's *current* `display` matches `command` — for an inline entry `display`
  IS the material, but for a `{script}` entry `display` is just its label (`` `script: <path>` ``) while
  the material actually hashed is the script's live file contents, read fresh at approval time.
- **Project-level hooks config surface:** `project.hooks.get`/`project.hooks.save` (no workspace
  needed), both keyed off the **project's root path** (never a workspace worktree — a script's
  `approvalMaterial`/`missing` there reflects the project root's on-disk state, not any one workspace's
  checkout). `get` loads `workspaces/hooks`'s `loadHookConfig` (the committed Shared tier +
  `combineMode`) and `persistence`'s `loadHookOverrides` (the Local tier), computes `sharedCommittable`
  via `projects`'s `isPathIgnored` against `WORKSPACE_HOOKS_CONFIG_FILE`, and for each of the four hooks
  calls `resolveHookRun` (mode `"both"`, so both tiers' entries always resolve regardless of the
  project's actual combine-mode) to fill a per-source `approved` map via `isApproved` — an entry whose
  `approvalMaterial` is `null` (a missing script) is left out, not marked unapproved. `save` throws a
  friendly, actionable error (never the raw `git add failed` string) if asked to write a non-empty
  Shared map on a project where `sharedCommittable` is false; otherwise, whenever committable, it writes
  via `writeHookConfig` and commits via `projects`'s `commitProjectFile` **even with an empty Shared
  map**, so the chosen `combineMode` still persists as the project's default. It always persists the
  Local tier via `saveHookOverrides`, then **approves on save**: `resolveHookRun` again (over what was
  just written, mode `"both"`) and `approveHook` per resolved entry — so a workspace created right after
  saving never sits at `hookAwaitingApproval` for something the user just configured on this machine.
- **Public surface (barrel):** `createServer`, `CreateServerOptions`, `RunningServer`, `bootHost`,
  `BootHostOptions`, `BootedHost`.
- **Allowed deps:** `contracts` (`PROTOCOL_VERSION`, `WS_CHANNELS`); `shared` (`freePort`, `shellEnv` — for
  `boot.ts`); the feature modules it composes (per the parent dependency graph, incl. `fs`'s
  `resolveWorktreeFile` for the `/files` route); Bun/Node.
- **Forbidden:** being imported by any feature module; importing `web`/`cli`/`desktop`.

## Get right

- WS commands return values directly; only events + extension-UI + the workspace lifecycle trio
  (`workspace.created`/`updated`/`removed`, published from the `workspaces` module's injected publisher)
  use push channels. Every push channel a client should hear must be `ws.subscribe`d in the WS `open`
  handler — a publish on an unsubscribed topic reaches nobody, silently.
- The host is the single place features are wired together — features never reach back into it.
- **A send (prompt/steer/followUp/answerQuestion) is acked when ACCEPTED, not when the turn ends**
  (`ackSend`): pi's send methods resolve only at turn end, and a turn can outlive the client's request
  timeout (long tool rounds and multi-minute reasoning turns are routine) — awaiting completion would
  surface a phantom "request timed out" over a healthy turn. A rejection inside the ack window still
  fails the request (bad model / missing key; for `answerQuestion` also an unknown/answered/superseded
  call — `assessAnswerability`'s loud verdicts); later faults reach the client via the event stream.
