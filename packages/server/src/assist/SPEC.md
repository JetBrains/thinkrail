---
id: submodule-server-assist
type: submodule-design
status: active
title: assist — ad-hoc one-shot tasks
parent: module-server
depends-on: [module-contracts, submodule-server-agent]
tags: [v1, pi, oneshot]
---

## Responsibility

Small, **best-effort** agentic helpers that run a single cheap-model completion — the "ad-hoc one-shot
task service." Each task owns its prompt, its output parsing/guards, and its graceful-degrade fallback;
it never blocks or crashes its caller. First task: **workspace naming** from a session's first turn,
consumed by the host's auto-rename flow (`host/autoRename` — it owns the turn gating, the flag lifecycle,
and the rename/push; assist only turns a prompt/turn into a slug). Naming has two halves here: the agentic
`suggestWorkspaceName` (a cheap-model refinement) and the pure `naiveWorkspaceSlug` (the instant
non-agentic name the host shows first). PR-draft (title/body) and similar
tasks land here next. The tasks are a **library surface** — no wire method; consumers are host-side flows.

## Boundary

- **Owns:**
  - The task catalog + their prompts, output guards, and fallbacks. `suggestWorkspaceName(turn)` →
    a `≤5`-word kebab-case slug or `null` (best-effort: returns `null` — never throws — on nothing
    authenticated, timeout, or unusable output, so the caller keeps its `workspace-N` default). Always
    time-boxed (`AbortSignal.timeout`) and bounded (`maxTokens`).
  - `toWorkspaceSlug(raw)` — pure model-output → safe slug normalization (strip wrapping quotes/backticks,
    collapse to kebab-case, clamp words + length).
  - `naiveWorkspaceSlug(prompt)` — pure, **non-agentic** raw-prompt → short kebab slug (or `null` on a
    blank/unusable prompt). Grows the slug a word at a time to *at least* a minimum (so a run of very
    short words still reads) and stops *before* a maximum (words + chars); same slug alphabet as
    `toWorkspaceSlug`. No runner — the host's naive-rename pass shows this the moment a turn starts,
    before the agentic `suggestWorkspaceName` refinement lands.
  - `extractFirstTurn(messages)` — pure: pull the first **clean** `{ prompt, answer }` turn out of a
    pi-canonical transcript (`Message[]`), or `null` if there is none. **Killed turns are skipped, not
    just gated:** a turn whose terminal assistant message stopped `error`/`aborted` is passed over
    (naming from a retracted prompt is the failure mode — an aborted first prompt must not become the
    name once a later turn settles cleanly). Composed by the host's auto-rename flow with
    `getSessionMessages`; assist never reads session state itself — settled-turn gating is the
    caller's job.
  - `setOneShotRunner(fn)` — a test seam swapping the one-shot runner (default = `agent.completeOnce`) so
    tasks unit-test against a fake with no pi/auth/network.
- **Public surface (barrel):** `suggestWorkspaceName`, `naiveWorkspaceSlug`, `toWorkspaceSlug`,
  `extractFirstTurn`, `setOneShotRunner`; `WorkspaceNameTurn`, `OneShotRunner`.
- **Allowed deps:** `agent` (the `completeOnce`/`OneShotRequest`/`OneShotResult` primitive, via its
  barrel); `contracts` (`Message`/`UserMessage`/`AssistantMessage`/`TextContent`); Node.
- **Forbidden:** `host`; **`@earendil-works/pi-ai` / `pi-coding-agent` directly** (model access + dispatch
  belong to `agent`); reaching into another feature's internals.

## Get right

- Every task **degrades to `null`** — a naming failure must never block workspace creation or surface as
  an error. Wrap the runner call; the caller supplies the deterministic default.
- Never trust model formatting: cap `maxTokens`, then normalize/clamp the text yourself.
- These are stateless, side-effect-free `fetch`es on the shared loop (no disk, no tools) — safe to run in
  parallel; no manager/registry needed.
