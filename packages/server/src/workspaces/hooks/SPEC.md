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
no caller yet (no merge-initiating code exists in v1) — real extension points, not dead code. Each hook
point resolves to an **ordered list** of commands, not just one — the project's committed Shared tier
and/or a host-local Local tier, combined per `CombineMode` — run one at a time, stopping at the first that
isn't a clean, approved, zero-exit run; see `runHook`/`runHookEntry` in `hooks.ts` for the exact order/stop
semantics.

## Boundary

- **Owns:** command resolution — `resolveHookRun` (`config.ts`) builds a hook's ordered run list from the
  workspace's own worktree's committed `.thinkrail/hooks.json` (the Shared tier) and
  `~/.thinkrail/hookOverrides.json`'s per-project entry (the Local tier), combined per the effective
  `CombineMode` (`Workspace.hookCombineMode ?? committedConfig.combineMode ?? "both"`); the per-source
  approval gate (`~/.thinkrail/hookApprovals.json`, a sha256 of the approved material — the command text,
  or a script's current file contents — keyed per project+hook+`HookSource`; editing the material
  invalidates that source's approval); and the subprocess runner (`sh -c "<command>"` for an inline entry,
  `sh <script>` for a script entry — both streamed stdout/stderr with an optional timeout). `runHook` walks
  a hook's resolved entries **one at a time, in order** (Shared before Local under `"both"`) via
  `runHookEntry`, and **stops at the first entry that isn't a clean, approved, zero-exit run** — a missing
  script, an unapproved entry, or a non-zero exit all halt the remaining entries for that invocation, the
  same `&&` semantics as a shell pipeline; overall success requires every entry to have run and succeeded
  (including the vacuous case of an empty list — nothing declared for this hook is not a failure).
  `runOnCreateHook`/`runPostMergeHook` are fire-and-forget; `runOnDeleteHook`/`runPreMergeHook` are awaited
  by their caller — all four never throw, converting every failure mode (missing approval, a missing
  script, a non-zero exit, timeout, an unexpected error) into either a published
  `hookFailed`/`hookAwaitingApproval` event (tagged with the `HookSource` that produced it) or (for
  `preMerge`) a `false` return.
- **Lifecycle events:** every hook-state transition (`hookAwaitingApproval`, `hookStarted`, `hookOutput`,
  `hookSucceeded`, `hookFailed`) is emitted through an **injected publisher** (`setHookPublisher`, the same
  inversion `workspaces`/`terminal`/`settings` use), carrying the wire-shaped `WorkspaceHookEvent` from
  `contracts` directly — no server-internal-to-wire mapping needed (the same pattern `watch`'s
  `WorkspaceFsChangedPayload` uses, not the workspace-lifecycle trio's kind→channel mapping, since every
  transition here shares one `workspace.hook` channel). Every variant carries `source: HookSource`, so a
  `combineMode: "both"` run's two tagged sequences — Shared's, then (if reached) Local's — are told apart
  instead of conflated into one.
- **`config.ts` owns the on-disk schema, back-compat, and per-source resolution — still git-free (fs only;
  no git operation of its own, per the Forbidden list below).** `loadHookConfig(dir)` parses a project's
  committed `.thinkrail/hooks.json` into the versioned `HookConfigFile` shape
  (`{ version: 1, combineMode, hooks }`), with back-compat for the legacy flat file (`{ onCreate: "…" }`,
  no `version`/`hooks` keys of its own) — the whole object is treated as `hooks`, `combineMode` defaulting
  to `"both"`; missing file, malformed JSON, or a parsed non-object all fall back to the same default
  (`{ version: 1, combineMode: "both", hooks: {} }`), never throwing. `writeHookConfig(projectPath, config)`
  writes the versioned object back, pretty-printed, via the shared `WORKSPACE_INTERNAL_DIR`/
  `WORKSPACE_HOOKS_CONFIG_FILE` constants. `resolveHookRun(args)` resolves one `HookName` into an **ordered
  list** of `ResolvedHookEntry` per `CombineMode` — `"both"` → `[shared?, local?]` (Shared first; a tier
  with no value for this hook is simply omitted, not a gap in the order), `"shared"`/`"local"` → that one
  tier only. Each entry carries its `source` and is either `"inline"` (a bare string or `{ command }`) or
  `"script"` (`{ script }`, resolved to an absolute path — a Shared path and a relative Local path resolve
  against `args.basePath`, an absolute Local path is used as-is); a script entry pre-reads the file into
  `approvalMaterial` at resolve time, so a missing script becomes `missing: true, approvalMaterial: null`
  rather than throwing. `resolveHookCommand` — the older single-tier resolver (a flat committed-map and a
  flat host-local-override-map, override replacing outright) — stays in place only because
  `host/handlers.ts` still calls it; it's dropped once that last caller migrates to `resolveHookRun` (a
  later task). `hooks.ts`'s own `runHook` already runs on `resolveHookRun`, and re-exports it through this
  module's barrel; `ResolvedHookEntry` itself isn't re-exported — reached only by `hooks.ts` importing
  `./config` directly.
- **Public surface (barrel):** `runOnCreateHook`, `runOnDeleteHook`, `runPreMergeHook`, `runPostMergeHook`,
  `setHookPublisher`, `approveHook`, `isApproved` (project+hook+`HookSource`+material approval check — the
  `project.hooks.get` handler in `host` uses it to report per-source approval status), `loadHookConfig`,
  `resolveHookCommand`, `resolveHookRun`, `writeHookConfig` (all four re-exported from `config.ts` — reading/
  writing/resolving a project's committed hooks needs no workspace, so these are called directly on a
  project's root path, not just a workspace's worktree; all were already generic over any directory).
  `resolveHookCommand` is the older single-tier resolver, kept only until `host/handlers.ts` — its last
  remaining caller — migrates to `resolveHookRun` too (`hooks.ts` itself already has).
- **Persisted status:** every transition `emit`s through (except the ephemeral `hookOutput`) also writes
  the hook's latest `HookStatus` onto its workspace's `hookStatus` field via `persistence`'s
  `loadWorkspaces`/`saveWorkspaces` — durability for a reconnecting/reloaded client (`workspace.list` and
  the lifecycle trio's `created`/`updated` snapshots carry it "for free"), not the live update path (an
  already-connected client updates straight from the `workspace.hook` event). Nested per `HookSource`
  (`Workspace.hookStatus[hook][source]`) and merged onto the hook's existing entry, so persisting one
  source's transition never clobbers the sibling source's last-known status (Shared sitting at
  `succeeded` while Local is now `running`, say). `approveHook` itself still
  only records the approval — it never re-invokes a hook. That's sufficient for `onDelete`/`preMerge`,
  whose next natural invocation checks approval fresh and runs; it is **not** sufficient for `onCreate`,
  which fires exactly once at creation time. The host's `workspace.hooks.run` RPC (`host/handlers.ts`,
  dispatching to `runOnCreateHook`/`runOnDeleteHook` by name) is the explicit re-run trigger the approval UI
  composes with `approveHook` to actually bootstrap a workspace stuck at `hookAwaitingApproval` — also a
  general-purpose manual-retry primitive, not approval-specific.
- **`HookStatus.command` is populated on every transition**, not just `hookAwaitingApproval` — so a client
  reading `Workspace.hookStatus` (the Hooks tab; `apps/web/src/panels/HooksPanel.tsx`) can show the
  resolved command regardless of the hook's current state.
- **Allowed deps:** `persistence` (override/approval storage, and now `hookStatus` persistence); `contracts`;
  `@thinkrail/shared/paths` (the `.thinkrail/` namespace convention); Node (`node:crypto`, `node:fs`,
  `node:path`).
- **Forbidden:** `host`; `git` (no git operation of its own — the caller already has the worktree);
  `terminal` (hook output is self-contained, never routed through a PTY — see the parent module's
  boundary note on why `workspaces` doesn't depend on `terminal`).
