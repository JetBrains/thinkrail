---
id: submodule-server-workspaces-hooks
type: submodule-design
status: active
title: workspaces/hooks — lifecycle hook execution
parent: submodule-server-workspaces
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Runs a project's own declared setup/teardown/merge-time commands around a workspace's lifecycle, without
`workspaces` (or anything else in the host) knowing what those commands do. Four named hook points —
`onCreate`, `onDelete`, `preMerge`, `postMerge` — each with its own timing and failure semantics (see the
doc comments on `runOnCreateHook`/etc. in `hooks.ts`); `preMerge`/`postMerge` are fully implemented but have
no caller yet (no merge-initiating code exists in v1) — real extension points, not dead code.

## Boundary

- **Owns:** command resolution (`.thinkrail/hooks.json` in the workspace's own worktree, committed;
  `~/.thinkrail/hookOverrides.json`, host-local, replaces per-hook — never merged), the approval gate
  (`~/.thinkrail/hookApprovals.json`, a sha256 of the approved command per project+hook — editing a command
  invalidates its approval), and the subprocess runner (`sh -c`, streamed stdout/stderr, an optional
  timeout). `runOnCreateHook`/`runPostMergeHook` are fire-and-forget; `runOnDeleteHook`/`runPreMergeHook` are
  awaited by their caller — all four never throw, converting every failure mode (missing approval, non-zero
  exit, timeout, an unexpected error) into either a published `hookFailed`/`hookAwaitingApproval` event or
  (for `preMerge`) a `false` return.
- **Lifecycle events:** every hook-state transition (`hookAwaitingApproval`, `hookStarted`, `hookOutput`,
  `hookSucceeded`, `hookFailed`) is emitted through an **injected publisher** (`setHookPublisher`, the same
  inversion `workspaces`/`terminal`/`settings` use), carrying the wire-shaped `WorkspaceHookEvent` from
  `contracts` directly — no server-internal-to-wire mapping needed (the same pattern `watch`'s
  `WorkspaceFsChangedPayload` uses, not the workspace-lifecycle trio's kind→channel mapping, since every
  transition here shares one `workspace.hook` channel).
- **Public surface (barrel):** `runOnCreateHook`, `runOnDeleteHook`, `runPreMergeHook`, `runPostMergeHook`,
  `setHookPublisher`, `approveHook`.
- **Persisted status:** every transition `emit`s through (except the ephemeral `hookOutput`) also writes
  the hook's latest `HookStatus` onto its workspace's `hookStatus` field via `persistence`'s
  `loadWorkspaces`/`saveWorkspaces` — durability for a reconnecting/reloaded client (`workspace.list` and
  the lifecycle trio's `created`/`updated` snapshots carry it "for free"), not the live update path (an
  already-connected client updates straight from the `workspace.hook` event). `approveHook` itself still
  only records the approval — it never re-invokes a hook. That's sufficient for `onDelete`/`preMerge`,
  whose next natural invocation checks approval fresh and runs; it is **not** sufficient for `onCreate`,
  which fires exactly once at creation time. The host's `workspace.hooks.run` RPC (`host/handlers.ts`,
  dispatching to `runOnCreateHook`/`runOnDeleteHook` by name) is the explicit re-run trigger the approval UI
  composes with `approveHook` to actually bootstrap a workspace stuck at `hookAwaitingApproval` — also a
  general-purpose manual-retry primitive, not approval-specific.
- **Allowed deps:** `persistence` (override/approval storage, and now `hookStatus` persistence); `contracts`;
  `@thinkrail/shared/paths` (the `.thinkrail/` namespace convention); Node (`node:crypto`, `node:fs`).
- **Forbidden:** `host`; `git` (no git operation of its own — the caller already has the worktree);
  `terminal` (hook output is self-contained, never routed through a PTY — see the parent module's
  boundary note on why `workspaces` doesn't depend on `terminal`).
