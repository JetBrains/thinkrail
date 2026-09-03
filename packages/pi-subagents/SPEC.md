---
id: module-pi-subagents
type: module-design
status: active
title: pi-subagents — the Agent tools over the delegation core
parent: architecture
depends-on: [module-pi-delegation]
tags: [pi-extension, subagents]
---

## Responsibility

`pi-subagents` is the **first consumer of [[module-pi-delegation]]** and the extensibility proof of
that framework: the LLM-facing subagent capability. It owns exactly what is subagent-specific —
the `Agent` + `get_subagent_result` tools, agent definitions (discovery / precedence / trust), the
definition → spawn mapping, and background-completion delivery. It contains **zero private
child-assembly code**: everything session-shaped goes through the core's `SessionOptions`. How each
choice was settled: the decision log below.

## Public surface (the barrel, `index.ts`)

- **default export** — the zero-config pure-pi extension entry (the `pi` manifest points here);
  builds its own `DelegationService` with default bindings, projecting the parent off the tool
  `ExtensionContext` at spawn time. The projection includes the public `modelRegistry`, allowing
  the core's self-created runtime to mirror provider registrations made by other extensions before
  each child spawn without inspecting their configuration or relying on pi's private runtime field.
  **The fallback service is session-scoped in lifetime**: on `session_shutdown` the extension
  awaits `disposeChildrenOf(parent)` and drops the service, so a
  vanilla-pi background child never outlives its parent session burning tokens with an
  undeliverable completion (PR #302 review finding). An embedder-injected service is deliberately
  untouched — its lifecycle belongs to the embedder (ThinkRail cascades in `removeSession`).
  `session_shutdown` also flips a closure-level `shuttingDown` flag that **suppresses background
  completion delivery**: without it each detached run's continuation still sends its (now aborted)
  completion with `triggerTurn: true` into the dying session — in pi 0.84.1 an idle parent answers
  that with a provider turn racing teardown (second PR #302 review finding). The flag is set before
  the dispose await so completions arriving *during* teardown are already suppressed, and it
  applies to embedder-injected services too — a completion aimed at a session being shut down is
  undeliverable regardless of who owns the service. A parent-turn *abort* never sets the flag: a
  detached run survives it and still delivers (both sides test-pinned — the suppression via
  `session_shutdown` emitted through pi's public extension runner in the package suite). The
  detached run's late `onUpdate` calls need no such guard: pi-agent-core drops updates after the
  tool call resolves (`acceptingUpdates`), so they are a no-op by construction.
- `createSubagentsExtension({ service?, delegationRoot?, scope? })` — the embedder entry: ThinkRail
  passes its host-bound service (and the matching storage bindings, used for restart-loss error
  messages).
- `SUBAGENT_COMPLETION_MESSAGE` — the custom-message type the web's completion card keys on.
- Definitions: `AgentDefinition`, `discoverAgentDefinitions`, `parseAgentDefinition`,
  `BUILTIN_AGENTS`.
- Mapping: `toSpawnMapping`, `resolveModelRef`, `buildChildSystemPrompt`, `RECURSION_GUARD_TOOLS`.

## The tools

| Tool | Behavior |
| --- | --- |
| `Agent({ subagent_type, task, model?, run_in_background? })` | Snapshots definitions before each parent model turn (editable mid-session), then maps the named one plus the optional invocation model to `SessionOptions` and spawns via `createChild` + `runQueued`; the description and execution closure use that same snapshot, so a mid-session edit cannot make advertised model policy disagree with execution. Model precedence is definition pin → invocation model → live parent; a definition pin silently wins over a supplied invocation value, and the available-agent description advertises each definition's pin or call/parent selection before use. Foreground: awaits the outcome and rides the tool signal; `error` outcomes throw (tool error, reason-first) — and the error tool result **still carries the run's final `details`**: pi replaces a thrown tool error's result with `{content, details: {}}`, so the extension stashes the outcome details by `toolCallId` before throwing and re-injects them via a `tool_result` hook override (the stash is swept on `turn_end` — after finalization — and on `session_shutdown`, so a turn aborted before tool finalization cannot strand entries); a failed run's card keeps its child session id and the transcript stays openable (PR #304 review finding). Background: **never rides the parent turn's abort signal** (a detached run survives a parent abort — core-spec semantics, test-pinned); returns `{childSessionId}` text immediately; the terminal event injects a `subagent-completion` custom message (`deliverAs: "followUp", triggerTurn: true`). Live `onUpdate` details flow to `partialResult` (REPLACE). Results bounded to 50k chars — the full text stays in the child transcript. |
| `get_subagent_result({ session_id })` | **Lineage-checked**: a child whose `record.parentSessionId` is not the calling session takes the unknown-id error path — with a shared (workspace-scoped) service, one tab must not read or mark-collected another parent's child (PR #302 review finding). Reads the core registry via `findChild` + `collectResult`: terminal → final text + details through the **same reason-first, 50k-bounded shaping** as a foreground result (marks collected; an errored run reports its `errorMessage` first — core decision #24); running → status snapshot; unknown id → error naming the restart-loss case + the derived transcript path. |

Both tools register inside `session_start` (emitted by `bindExtensions`). `Agent` additionally
re-registers in `before_agent_start` for the first provider turn and at each `turn_end` for the next
one; pi replaces the same-name tool immediately, so each turn receives one definition snapshot for
both its description and execution while edits remain live without `/reload`.

## Definitions: discovery, precedence, trust

First-name-wins in trust order — **builtins → personal (`<agentDir>/agents/*.md`) → project
(`<cwd>/.pi/agents/*.md`, `<cwd>/.agents/agents/*.md`)** — so a worktree definition can never
shadow a built-in or personal name (decision 6 below), and project definitions load only when
`ctx.isProjectTrusted()`. Built-ins are **TS constants** (`builtins.ts`: scout / planner / worker /
reviewer — user-settled), not `.md` files, so they survive `bun build --compile` and get
typechecked; user-authored definitions keep the community `.md` + frontmatter convention
(`name`, `description`, `tools`, `model`, `thinking`, `max_turns`, `inherit_project_context`,
`skills`, `extensions`; body = system prompt). Malformed files are skipped, never fatal. All four
builtins set `extensions: true` (the embedder's curated child set — inert under pure-pi
zero-config) with the spec READ tools (`spec_grep`/`spec_get`/`spec_graph`) allowlisted for the
read-only roles and web tools (`web_search`/`fetch_content`) for the scout. The reviewer alone opts
into project context: its judgment depends on repository guidance, and its prompt admits only
material, reachable, unmitigated findings attributed to the named target. It must falsify candidate
findings, complete the target, deduplicate by root cause, and end with one explicit verdict; GitHub
review and thread semantics stay outside this portable role.

## The mapping (policy, not mechanism)

`toSpawnMapping`: definition + optional invocation model → `SessionOptions` + `RunOptions.maxTurns`.
The effective reference follows definition pin → invocation model → parent inheritance, so only an
unpinned definition can use a per-call model. Model refs fuzzy-resolve against the session's available
models (`provider/id` → exact id → unique prefix; ambiguous or unknown effective refs throw loud).
Child system prompt = definition body → subagent bridge → env block (cwd, git branch, platform) —
**stable material first** for KV-cache prefix reuse. The
recursion guard (`excludeTools: ["Agent", "get_subagent_result"]`) is unconditional.
`extensions: true` passes through to the core's curated-set opt-in (core decision #25) — which
extensions that set holds is the **embedder's** choice, never this package's.

## Boundary

- **Allowed deps:** `pi-delegation` (through its barrel only); the pi SDK + `typebox` as
  **peerDependencies**; `node:*`.
- **Forbidden:** any `@thinkrail/*` package (must work under vanilla pi); `@earendil-works/pi-tui`
  (pure-pi V1 bar is default rendering); `pi-delegation/src/*` internals.
- The web card / transcript view are the *presentation* side, joined by tool name
  (`registerToolRenderer("Agent", …)`) — they live in `apps/web` (`chat/tools/subagent`), never here.

## Verification

Unit suites in-package (`bun test`), including a two-extension regression where one extension
registers a synthetic provider and the zero-config subagents extension delegates through it. End to
end: `e2e/subagents.live.spec.ts` (`@agent` — the real host driving real children: foreground
fan-out, background completion, transcript reads). The core SPEC's pure-pi bar: **`bun run
smoke:subagents`** — this extension with default bindings under the repo-pinned vanilla pi CLI, in
an isolated throwaway agent dir; on-demand only (needs pi auth, spends real tokens), never a
commit/CI gate.

## Decision log (settled with the user, 2026-08)

0. **Own-build over third-party adoption.** Third-party pi subagent extensions were surveyed twice
   and one adoption was attempted and rolled back; the surveyed options kept mismatching our
   multi-session embedded host, compiled binary, and web renderers (subprocess spawning in some,
   process-wide registries/discovery, TUI management) — though the in-process spawn pattern two of
   them prove (pi SDK as peerDependency) is exactly what the core reuses (core decision #17). Our
   per-session-discovery fix survives upstream as tintinweb/pi-subagents PR #223 (no longer a
   dependency).
1. **Portable workspace package** — a pure-pi extension (pi SDK as a `peerDependency`) consuming
   `pi-delegation`. ThinkRail's server embeds the factory per session, handing it the host-bound
   `DelegationService`; under vanilla pi the extension constructs the service with default
   bindings. It must load and work in pure pi (the core SPEC's pure-pi bar). *Supersedes the original "host-owned bundled extension" decision — reversed in the PR #261
   review round; research + rationale: core decision log #17–21.*
2. **Tool naming: Claude Code style** — `Agent` (spawn; models are trained on the convention) +
   `get_subagent_result` (collect detached results). `steer_subagent` deferred to V2.
3. **V1 scope: foreground + parallel fan-out + background runs.** Parallel fan-out = several
   `Agent` calls in one message (pi runs a batch's tool calls concurrently; the core's semaphore
   paces them) — no `tasks[]`/chain DSL, the model sequences chains itself.
4. **Transcripts persisted, openable anytime** — children are hidden pi sessions on disk; the web
   card links a read-only transcript view that works during the run, after completion, and after a
   host restart. Background completion delivery (`sendMessage` with `deliverAs: "followUp",
   triggerTurn: true`) is lost on host restart and suppressed once its session is shutting down —
   accepted, same class as other followUp messages; the transcript survives regardless.
5. **Built-in agents: a small curated set** tuned to ThinkRail's spec-first workflow (roster +
   TS-constant form: Definitions above); personal + worktree definitions add more.
6. **Precedence/trust: worktree definitions can never shadow built-in or personal names** (mirrors
   the skills invariant; community libs order it the other way — that enabled the "repo ships
   `Explore.md`" attack). Worktree defs ride the project's existing trust posture (same as
   pi-native `.pi` resources); no separate admission gate (earlier user decision).
7. **Child context: narrow by default, per-definition opt-ins.** A child sees the definition body
   + the env block (contents: The mapping above) + the task; opt-ins: `inherit_project_context`
   (worktree AGENTS.md), `skills:` (explicit list). No parent-conversation inheritance in V1;
   fork-mode inheritance is the recorded growth path (core `origin: fork`). Basis (2026-08,
   source-verified): the reference implementations split between narrow-by-default with opt-ins
   (nicobailon — most adopted at 3.1k★ / 56k dl/wk — gotgenes-replace, tintinweb) and
   project-aware (pi example, gotgenes-append); nicobailon's narrow model was chosen as the
   cleanest base for a multi-pattern system, with gotgenes' KV-cache prompt ordering (stable
   material first) adopted within our own layout.
8. **Per-call models are an unpinned-definition fallback.** `Agent.model` lets the parent choose any
   unambiguous model available in its retained runtime generation when the definition has no `model`.
   A definition pin silently wins over a supplied call value (user-settled) rather than failing or
   becoming overrideable; the tool's available-agent list exposes that pin so precedence is visible.
   Definition discovery is snapshotted per parent model turn, preventing a live edit from splitting
   the advertised pin from the execution closure. With neither source set, the core preserves
   parent-model inheritance.
