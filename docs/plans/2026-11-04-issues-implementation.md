# Issue Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the approved GitLab CE Issue workflow with existing ThinkRail sessions and registered project-local worktrees.

**Architecture:** Isolate provider and workflow behavior in server/issues and web/issues; compose through host and versioned contracts. Tokens are stored in the host OS credential store under the latest user decision; no plaintext fallback is authorized. Public bindings and cleanup references remain separate from secrets. Workspace services remain Issue-neutral.

**Tech Stack:** Bun, strict TypeScript, React 19, existing typed WebSocket transport and pi session runtime.

---

## Task 1: Contracts and module boundaries

Files: create `packages/server/src/issues/SPEC.md`, `apps/web/src/issues/SPEC.md`, `packages/contracts/src/issues.ts`; modify owning parent specs and contracts barrel/WS registry. Add provider-neutral connection, Issue summary, version, action and session launch DTOs. No token fields in readable snapshots. Write type/runtime registry tests first and verify failure before implementation. Gate capability with a new protocol version.

## Task 2: GitLab and workflow service

Files: create `packages/server/src/issues/{index,service,client,approvals,workflow,workspace}.ts` and adjacent tests; keep this single module flat until a real dependency boundary requires another barrel. Host-only memory token storage; binding and recovery metadata persisted separately without secrets. Test invalid inputs, pagination, sanitized failures, stale approvals, changed design/commit, operation reconciliation and absence of credentials from public outputs. Use injected fetch with disposable HTTP fixtures; verify red then green with `bun test packages/server/src/issues`.

Use fixed labels and complete label-event pagination. Developer+ qualification is resolved from GitLab, not label presence. Fail closed on ambiguous approval order, unavailable permissions or CI. Preserve Issue goals and human edits with expected content checks. Never retry uncertain side effects without remote reconciliation.

## Task 3: Workspace/session integration

Files: modify `packages/server/src/workspaces/{workspaces.ts,SPEC.md}` and tests, host handlers and workspace export barrel. Add a server-only explicit target-path option owned by workspace services, retaining safety checks and registry/events; never expose arbitrary paths on public workspace.create. Derive `.worktrees/<IID>` in issues/host integration. Register before session startup; recover partial creation and reject occupied or symlink-escaped paths. Test with temporary repositories. Do not auto-delete worktrees. Default workspace serves design; implementation receives the resulting workspaceId.

### Remaining host integration slices

Each slice follows test → observed failure → minimal implementation → focused green → independent
spec/quality review. Do not stage or commit without explicit user permission.

1. `host/issueWorkflowPersistence.test.ts`: save a design-revocation record while retaining each kind
   of implementation receipt; observe rejection, then align the persistence schema with emitted workflow
   states. Run `bun test packages/server/src/host/issueWorkflowPersistence.test.ts packages/server/src/issues/workflow.test.ts`.
2. `agent/agentSessionManager.ts` and adjacent tests: expose a workspace-scoped reuse query using pi's
   idle state, admission reservations, closing and compaction guards; disk lookup must not attach a
   session. Run the new focused test before and after adding the public query.
3. `workspaces/workspaces.ts` and tests: expose the full authoritative Git worktree registry, including
   managed, Default, detached and prunable entries, through the barrel. Test against disposable real
   repositories; do not reuse the filtered import-candidate list.
4. `host/issueWorkspacePersistence.ts` and tests: reserve a cross-process per-project/IID launch before
   any coordinator read or side effect. A crash or uncertain release requires reconciliation; never
   infer a stale reservation from elapsed time. Test two independent processes and a failed save.
5. `issues/workspace.ts` and tests: add a lookup-only owned implementation query that repeats completed
   ownership checks without creating or repairing anything. `issues/workflow.ts` must obtain fresh HEAD
   from a required host port during implementation evidence and before successful transitions, including
   the already-approved fast path; a receipt's commit alone is not current checkout proof.
6. `host/createHostSession.ts`, `host/handlers.ts` and tests: extract the existing session-create sequence
   unchanged for ordinary callers, allowing a guarded Issue caller to use the same defaults, scratch
   setup, runtime and analytics. A failed post-create guard leaves durable session uncertainty, not deletion.
7. `host/issues.ts` and tests: compose existing workspace/session ports and the authenticated service
   capability. Verify trust, binding and connection ownership around awaits and each remote operation;
   approval must be refreshed against the requested trusted design receipt. Bind HEAD checks to the
   coordinator's verified owned workspace rather than caller paths or SHAs.
8. `contracts/src/issues.ts`, `contracts/src/wsProtocol.ts`, `host/handlers.ts` and adjacent tests: add
   explicit bounded launch/publication/validation request schemas and a new additive protocol gate.
   Unknown keys and old clients must fail before delegation. No generic arbitrary-action door.
9. `issues/` delivery orchestration and tests: bind push/MR/CI to the owned branch and full SHA, require
   a fresh independent human merge confirmation, and close the Issue only after verified merge.
   Unknown writes remain pending and must not auto-replay.

## Task 4: Host and Agent handoff

Files: host Issue composition adapter and handlers; Issue workflow skill package only if existing session skills cannot carry the approved handoff. Add typed methods for configuration/list/actions and product-owned artifact submission. Agent sees sanitized Issue content and approved stage instructions, never token. Preserve human checkpoints and session streaming behavior. Push uses local Git credentials, not PAT URL injection. MR and CI operations stay in issues, not GitHub PR module. Verify targeted host tests and focused live tests if agent behavior changes.

## Task 5: UI

Files: create `apps/web/src/issues/*`, modify shell singleton tool registration/workbench renderer, store selectors/actions where needed, locales. Read owning styling specs before implementation. Props-driven presentation, existing transport/store integration only. Kanban grouped list, external title links, stage menus, connect/disconnect token input (write-only, cleared after submission), blocked/sync feedback. Feature gate old hosts. Refresh/expand project workspace list after launch, activate returned workspace, then open session with existing navigation helpers. Test focused UI/browser targets.

### Shared GitLab association entry (approved addition)

- `apps/web/src/panels/useOpenProject.tsx`: after successful local open or clone, offer a skippable
  association step without holding project adoption hostage or rolling back an opened/cloned repository.
  Preserve the existing latest-intent guards and ordinary non-GitLab project behavior.
- The latest approved authentication policy supersedes the original memory-only design: HTTP/HTTPS
  association only, OS-vault PAT persistence, exact-instance nonlocal HTTP risk acknowledgment, lazy
  trusted reconnect, and disconnect-and-delete. Failed/locked vault operations are errors, never a
  plaintext fallback. Existing Git SSH authentication and provider SSH clone metadata are unaffected.
- Before wiring the vault, use unique staged credential IDs scoped to the host data directory; persist
  cleanup references before secret writes, commit the new binding before retiring old credentials, and
  never overwrite an active credential in place. Serialize connect/restore/disconnect per local project.
  Disconnect stops local use immediately and awaits cancellation, metadata commit and vault deletion.
  Inject fake vaults in every affected test; do not touch real user credentials.
- `apps/web/src/issues/`: factor the connection form for reuse by that step and the right-side Issues
  association/reconnect/disconnect menu. Token stays component-local and is cleared before transport;
  no browser/store persistence or URL-embedded credentials. Existing binding is shared between entries.
- Resolve HTTP/HTTPS-only repository addresses and origin prefill through typed, validated capabilities;
  reject SSH as association input without removing GitLab provider SSH metadata. Custom-host installation
  prefixes require explicit instance confirmation; never probe guessed endpoints with a PAT. Verify the
  selected GitLab project and never rewrite origin or use API PAT for Git clone/push.
- Add shared canonical instance and exact-instance HTTP consent contracts before service enforcement.
  Keep shape validation separate from authorization; literal loopback alone is exempt, never private LAN,
  DNS resolution, or parser-normalized numeric aliases. A v105 auth capability will distinguish durable
  credential/consent semantics from v103 reads and v104 workflow actions.
- Add focused form/open/clone tests before implementation, then real-browser no-agent coverage for
  skipping, failed association, reconnect and project-navigation races. Update owning Web/panels/issues
  specs before changing those contracts.

## Task 6: Review and gates

Update README with actual delivered scope and reconnect-after-restart behavior. Run targeted tests throughout, then dependency/boundary/seam/lint/typecheck/spec-surface/compiler gates and `bun run e2e` once for combined implementation. Review complete task diff, remove unnecessary layers, audit comments/suppressions. Disposable GitLab CE instance verification and upstream merge rehearsal require accessible infrastructure; record honestly if unavailable, do not claim compatibility solely from mocks. No full paid live suite without approval.
