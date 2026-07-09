---
id: module-contracts
type: module-design
status: active
title: Wire contracts (types-only)
parent: architecture
depends-on: []
tags: [v1, wire]
---

## Responsibility

The browser↔host wire spine: the single source of truth for the protocol. Types-only, with the only
runtime exports being the WS method/channel constants and the protocol version. The one package
`apps/web` may depend on — which is what lets the UI ship independently of the host.

## Boundary

- **Owns:** the wire — entity types, the `pi` event/message types (re-exported), the WS method & channel
  registries, and the protocol version.
- **Public surface (`index.ts`):** `export type *` of `piProtocol` + `domain`; `export *` (value) of
  `wsProtocol` (`WS_METHODS`, `WS_CHANNELS`, the typed maps, `PROTOCOL_VERSION`).
- **Allowed deps:** none at runtime. **Type-only** devDeps on `@earendil-works/pi-ai` +
  `@earendil-works/pi-agent-core`, imported **from their package roots** (type-only → erased at build).
- **Forbidden:** any *value* import of a `pi` package; **any** import (even `type`) of
  `@earendil-works/pi-coding-agent` (pulls `node:fs`); the pi-ai **provider / API subpaths**
  (`/providers/*`, `/api/*`, `/bedrock-provider`, … — they statically load the Node provider SDKs); and
  importing `server` / `shared` / `web`.

## Contents

- **piProtocol.ts** — `import type` re-exports from the pi package roots (type-only → erased at build):
  - `@earendil-works/pi-ai`: `Model`, `Message`, `UserMessage`, `AssistantMessage`,
    `ToolResultMessage`, `TextContent`, `ThinkingContent`, `ImageContent`, `ToolCall`,
    `AssistantMessageEvent`, `Usage`, `StopReason`;
  - `@earendil-works/pi-agent-core`: `AgentEvent`, `AgentMessage`, `ThinkingLevel` (the
    `off`-inclusive one);
  - the local render union **`PiEvent`** — the real superset `AgentSessionEvent` lives in the Node-only
    `pi-coding-agent`, so it's **mirrored** here (the `agent_end.willRetry` + `queue_update` /
    `compaction_*` / `auto_retry_*` / `session_info_changed` / `thinking_level_changed` members);
  - **`SessionEventPayload`** (`{ sessionId, event: PiEvent }`) — the `pi.event` push frame.
  - the cheap-win mirrors (declared in the Node-only `pi-coding-agent`): **`SessionStats`** + **`ContextUsage`**
    (tokens/cost/context bar — display only) and **`SlashCommandInfo`** + **`SlashCommandSourceInfo`** (the
    skill catalog).
  - **`SessionSummary`** — a chat session as the host reports it for hydration (read side); `live`
    distinguishes an in-memory session (auto-restored) from a disk-only one (surfaced in chat-history,
    re-opened on demand). `session.getMessages` returns `{ summary, messages }` (the transcript is the
    pi-canonical `Message[]`; the summary reflects the now-live session after a disk re-open).
  - the **extension-UI frames** **`ExtUiRequest`** / **`ExtUiResponse`** — our wire shape for pi's in-process
    `uiContext` calls (`select`/`confirm`/`input`/`editor` round-trip; `notify`/`setStatus`/`setWidget`/
    `setTitle`/`dismiss` are fire-and-forget), carried on the `pi.extensionUi` channel.
  - the **`ask_user_question`** wire types — **`AskUserQuestionArgs`** (`AskUserQuestionItem` + `AskUserQuestionOption`:
    the questions the agent authors, what the tool card reads from the `toolCall` block) and
    **`AskUserQuestionResult`** (`AskUserQuestionAnswer[]` + `cancelled`: the browser's reply). The capability
    is a **host-owned pi custom tool** (server `agent/askUserQuestion` — see its SPEC for the design
    rationale); the tool blocks while the chat renders the questionnaire **inline** and replies via
    `session.answerQuestion` (correlated by the tool call id).
- **domain.ts** — app entities: `Project` (git repo + unique `slug`; "does it have specs?" is **not** a
  field — it's the lazy `project.hasSpecs` query, since it's a full-tree walk), **`ProjectPathStatus`** (a
  candidate path's kind — `repo` / `initable` / `missing` / `notDirectory` — so the UI opens, offers a
  `git init`, or shows an error), `Workspace` (git worktree; its
  optional **`renamed`** flag is the naming lifecycle — absent = **not yet locked** (either pristine
  `workspace-N`, or a *provisional* non-agentic name the host applied from the first prompt), so still
  eligible for the agentic auto-rename; `true` = deliberately named (agentic or user), never auto-touched
  again), `Session` (chat tab),
  `FileNode` (file-tree node), `TabStatus`, `Git*`/diff types; **`SpecGraphNode`/`SpecGraphSnapshot`** — the
  Specs-viewer read DTOs, **mirrored** (like `PiEvent`), never imported from `pi-spec-graph` — the wire
  carries only what the panel renders (`type`/`status` stay `string`: tolerate whatever is on disk).
- **wsProtocol.ts** — `WS_METHODS` (`project.*` — incl. **`project.inspect`** (classify a path) +
  **`project.init`** (`git init` + commit, then open) + **`project.hasSpecs`** (lazy per-project "has any
  registered spec?" for the Welcome screen — a full-tree walk, so requested only for the shown project,
  never eagerly for every project) / `workspace.*` / `fs.*` / `git.*` / **`spec.graph`**
  (the Specs-viewer whole-graph read, per workspace) / `terminal.*` / `model.list` / `session.*` —
  `create`/`prompt`/`steer`/`followUp`/`abort`/`dispose`/`setModel`/
  `setThinkingLevel`/`compact`/`getStats`/`getCommands`/`extUiReply`/**`answerQuestion`** (the inline
  `ask_user_question` reply, correlated by tool call id)/**`list`**/**`getMessages`** (the
  read side)), `WS_CHANNELS` (`server.welcome` /
  `pi.event` / `pi.extensionUi` / `terminal.data` / **`workspace.updated`** — a host-initiated workspace
  mutation (the auto-rename — the instant naive pass and the agentic refine both push it) fanned out to
  every client; `data` is the **full persisted `Workspace` snapshot** (idempotent under the transport's
  last-value replay, so a naive-then-agentic pair merges by `id` — never a delta), keyed by `id` +
  `projectId`), the `WsMethodMap` typed request/result map +
  `WsParams`/`WsResult` helpers, and `PROTOCOL_VERSION`.

## Get right

- **Type-only, from the package roots, always** (verified vs 0.80.3: type-only imports are erased by
  `verbatimModuleSyntax`, so the web bundle stays provider-free; the pi-ai provider/API subpaths
  statically import the Node SDKs — never touch them). The `/base` entries existed only in 0.79.8–0.79.9.
- `Model` is generic — expose as `Model<any>`.
- `AssistantMessageEvent` (the streaming deltas) is nested under `message_update.assistantMessageEvent`,
  never a top-level event `type`.
- Internal relative imports are **extensionless** (`./domain`), not `./domain.ts` — `composite` emits
  declarations, which is incompatible with `allowImportingTsExtensions`.
- **Bundle gate:** `bun build` the web app and confirm **no** `@anthropic-ai/sdk` /
  `openai` / `node:fs` appears.

## Consumed by

`web` (types + WS constants) and `server` (same, + mapping `session.*` to `AgentSession` methods). The
shell panels need `domain` + `wsProtocol`; the `pi` types + `PiEvent` are the wire for the agent session.
