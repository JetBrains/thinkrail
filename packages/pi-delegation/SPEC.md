---
id: module-pi-delegation
type: module-design
status: draft
title: pi-delegation — the session fabric (portable delegation core)
parent: architecture
implements: [task-delegation-core]
references: [task-subagent-support]
tags: [pi-package, delegation, subagents]
---

## Responsibility

`pi-delegation` is the **portable, pure-pi delegation core**: the framework for creating agent
sessions *from* agent sessions. One creation primitive (`createChild`) with orthogonal axes; a
handle that owns the run loop (per-parent FIFO pacing, turn caps, usage aggregation); lineage as
the storage layout; an in-memory run registry; and lifecycle events. The full contract, semantics,
and decision log live in [[task-delegation-core]] — this SPEC states the boundary.

**V1 implements exactly one axis combination** — hidden, non-interactive, fresh-origin children
with explicit `SessionOptions` — consumed by [[task-subagent-support]]. Every other combination
(`listed`, `fork`, `seeded`, `interactive`, `runNow`, absent `session`, a `workspace` provider) is
typed in the contract and **loud-rejected** with a typed `DelegationError` until its consumer
lands.

## Public surface (the barrel, `index.ts`)

- `createDelegationService(bindings)` — the service: `createChild` / `findChild` / `childrenOf` /
  `onLifecycle` / `disposeChildrenOf`.
- `DelegationBindings` — everything host-specific: `resolveParent` (required — ThinkRail: the
  manager; pure pi: the consuming extension's own session), `delegationRoot`, `scope`,
  `modelRuntime`, `maxConcurrentPerParent`.
- Storage helpers: `defaultDelegationRoot` / `delegationSessionDir` / `deriveChildSessionFile`
  (post-restart transcript reads) / `DEFAULT_SCOPE`.
- The contract types (`CreateChildSpec`, `ChildHandle`, `RunOptions`, `RunOutcome`,
  `DelegationRunDetails`, `SpawnRecord`, `RunSnapshot`, `LifecycleEvent`, `WorkspaceProvider`) and
  `DelegationError`.

## Boundary

- **Allowed deps:** the pi SDK (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`) as
  **peerDependencies** — the loading runtime supplies them; `node:*`.
- **Forbidden:** any `@thinkrail/*` package (this package must work under vanilla pi);
  `@earendil-works/pi-tui` (headless by design — rendering is the embedder's);
  importing another workspace package's internals.
- `DelegationRunDetails` is **authored here and mirrored into `@thinkrail/contracts`** (never
  imported from it, never re-exported by it) — the `pi-todos` DTO posture.
- Consumers import **through the barrel only**; `src/` is internal.
- The raw child `AgentSession` never crosses the barrel — `ChildHandle` is the sole control path.

## V1 child assembly (what the core owns, consumers never see)

Hidden children persist under `<delegationRoot>/<scope>/<parentSessionId>/` via
`SessionManager.create(cwd, sessionDir)` — never pi's default sessions root. The child's resource
loader is **narrow by default**: no extensions, no prompt templates, no themes; context files and
skills are explicit `SessionOptions` opt-ins; `systemPrompt` maps to `systemPromptOverride`.
Model/thinking default to the live parent's current values; `cwd` is the parent's.
