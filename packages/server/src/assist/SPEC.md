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
it never blocks or crashes its caller. First task: **workspace naming** from a session's first turn.
PR-draft (title/body) and similar tasks land here next. The tasks are a **library surface** — no wire
method is exposed yet; a host handler / auto-rename flow wires them in when a consumer needs it.

## Boundary

- **Owns:**
  - The task catalog + their prompts, output guards, and fallbacks. `suggestWorkspaceName(turn)` →
    a `≤5`-word kebab-case slug or `null` (best-effort: returns `null` — never throws — on nothing
    authenticated, timeout, or unusable output, so the caller keeps its `workspace-N` default). Always
    time-boxed (`AbortSignal.timeout`) and bounded (`maxTokens`).
  - `toWorkspaceSlug(raw)` — pure model-output → safe slug normalization (strip wrapping quotes/backticks,
    collapse to kebab-case, clamp words + length).
  - `extractFirstTurn(messages)` — pure: pull the first `{ prompt, answer }` turn out of a pi-canonical
    transcript (`Message[]`), or `null` if there's no user message yet. Meant to be composed by a host
    handler with `session.getMessages` (not wired yet); assist never reads session state itself.
  - `setOneShotRunner(fn)` — a test seam swapping the one-shot runner (default = `agent.completeOnce`) so
    tasks unit-test against a fake with no pi/auth/network.
- **Public surface (barrel):** `suggestWorkspaceName`, `toWorkspaceSlug`, `extractFirstTurn`,
  `setOneShotRunner`; `WorkspaceNameTurn`, `OneShotRunner`.
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
