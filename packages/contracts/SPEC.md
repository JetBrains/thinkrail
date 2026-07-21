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
runtime exports being the WS method/channel constants, the protocol version, and the small theme/config
value-sets (`Theme` / `THEME_IDS` / `DEFAULT_CONFIG`). The one package `apps/web` may depend on — which is
what lets the UI ship independently of the host.

## Boundary

- **Owns:** the wire — entity types, the `pi` event/message types (re-exported), the WS method & channel
  registries, and the protocol version.
- **Public surface (`index.ts`):** `export type *` of `piProtocol` + `domain`; the value re-exports
  `Theme` / `THEME_IDS` / `DEFAULT_CONFIG` from `domain`; `export *` (value) of `wsProtocol`
  (`WS_METHODS`, `WS_CHANNELS`, the typed maps, `PROTOCOL_VERSION`).
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
  - **`WireModel`** = `Pick<Model<string>, "id"|"name"|"provider"|"contextWindow"|"reasoning">` — the shape a
    model takes **on the wire** (`model.list`/`model.default`, the `session.create` result + params,
    `session.setModel` params, `SessionSummary.model`). An **allowlist** of exactly what the UI renders, *not*
    an `Omit`: `Model.baseUrl` carries the jbcentral proxy secret (`.../wire/<SECRET>/...`) when JetBrains AI
    is wired and `headers` can carry auth, and an allowlist **fails closed** — a future `Model` field (secret
    or not) is excluded by default. The host re-resolves the real `Model` from `{provider,id}` — so a client
    can neither read the secret nor inject a `baseUrl` for the agent to call (see the `agent` module SPEC);
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
    re-opened on demand). `session.getMessages` returns `{ summary, messages }` (the transcript is
    **`TranscriptMessage[]`** — the pi-canonical `Message` union widened with **`WireCustomMessage`**, a
    type-only mirror of pi-coding-agent's Node-only `CustomMessage`, so extension-injected messages like
    the ask replies cross the wire; the summary reflects the now-live session after a disk re-open).
  - the **extension-UI frames** **`ExtUiRequest`** / **`ExtUiResponse`** — our wire shape for pi's in-process
    `uiContext` calls (`select`/`confirm`/`input`/`editor` round-trip; `notify`/`setStatus`/`setWidget`/
    `setTitle`/`dismiss` are fire-and-forget), carried on the `pi.extensionUi` channel.
  - the **`ask_user_question`** wire types — **`AskUserQuestionArgs`** (`AskUserQuestionItem` + `AskUserQuestionOption`
    — the latter carries an optional `recommendedReason` the card renders inline as a `Why:` line under the
    option: the questions the agent authors, what the tool card reads from the `toolCall` block),
    **`AskUserQuestionResult`** (`AskUserQuestionAnswer[]` + `cancelled`: the browser's reply),
    **`AskUserQuestionAckDetails`** (the tool result's `details` under the **ack + terminate** design —
    the call resolves instantly; the turn ends) and **`AskUserAnswersDetails`** + the
    **`ASK_USER_ANSWERS_CUSTOM_TYPE`** constant, **`AskUserAnswersMessage`** (the correctly-paired
    tag↔details shape the host's builder is compile-held to) and the shared **`isAskUserAnswersMessage`**
    guard (all in `wsProtocol`, the value-bearing half): the reply travels as an `ask-user-answers`
    custom message the card pairs by `details.toolCallId`. `WireCustomMessage.customType` itself stays
    `string` — the namespace is open (any pi extension can mint custom messages and they all cross the
    wire), so strictness lives at the producer + the guard, which validates the details *shape* (wire
    data is untrusted — another process, possibly another protocol version). The capability
    is a **host-owned pi custom tool** (server `agent/askUserQuestion` — see its SPEC for the design
    rationale); the chat renders the questionnaire **inline** and replies via `session.answerQuestion`
    (correlated by the tool call id; rejected loud when the call is unknown/answered/superseded).
- **domain.ts** — app entities: `Project` (git repo + unique `slug`; "does it have specs?" is **not** a
  field — it's the lazy `project.hasSpecs` query, since it's a full-tree walk), **`ProjectPathStatus`** (a
  candidate path's kind — `repo` / `initable` / `missing` / `notDirectory` — so the UI opens, offers a
  `git init`, or shows an error), `Workspace` (git worktree; its
  optional **`renamed`** flag is the naming lifecycle — absent = **not yet locked** (either pristine
  `workspace-N`, or a *provisional* non-agentic name the host applied from the first prompt), so still
  eligible for the agentic auto-rename; `true` = deliberately named (agentic or user), never auto-touched
  again), `Session` (chat tab),
  `FileNode` (file-tree node), `TabStatus`, `Git*`/diff types; **`ProviderStatus`/`ProviderStatusReport`**
  — the auth-provider status rows the Welcome strip renders (per-provider `configured` + auth `kind`:
  oauth / api-key / env / central / other — never credential values; plus `canOAuth`/`canApiKey`/`canLogout`,
  which gate the strip's in-app Sign-in / Sign-out affordances — `canLogout` is true only for a removable
  auth.json credential, false for env / central / models.json auth the host can't unset); the **in-app login wire** — **`LoginFrame`** (the streamed
  flow updates: `authUrl` / `deviceCode` / `select` / `prompt` / `progress` / `success` / `error`, which
  **accumulate** client-side, never a credential value), **`LoginPush`** (the `provider.login` frame,
  `{ loginId, providerId, frame }`) and **`LoginReply`** (`{ loginId, value }` — the browser's answer to a
  `select`/`prompt`); the JetBrains AI wire — **`ProviderStatusReport.jbcentralInstalled`** (is the
  `central` CLI on the host) alongside `jbcentralWired` and **`jbcentralInstall`** (**`JbcentralInstall`**:
  the host's per-OS `{platform, shell, command}` install one-liner — for the *host's* OS, not the browser's,
  so a remote/phone client still shows the command for the machine running the host), and
  **`JbcentralConnectResult`** (the in-app connect state machine: `connected` / `needs-install` /
  `needs-login` / `error` (+`message`); the `needs-install` command comes from `jbcentralInstall`, not a
  hint on this result));
  the **theme/config value-set** — **`Theme`** (a const-object "enum":
  `Dark`/`Light`/`Darcula`/`Gruvbox`/`HighContrast`;
  adding a value is wire-compatible — an older client falls back to Dark's `:root` tokens), its derived
  **`ThemeId`** type + runtime-iterable **`THEME_IDS`** (the picker source), and the server-synced
  **`AppConfig`** (`{ theme }` — an extensible bag) with its **`DEFAULT_CONFIG`** fallback (persisted host-side
  as `config.json`, delivered in `server.welcome`, mutated via `settings.update`);
  **`SpecGraphNode`/`SpecGraphSnapshot`** — the
  Specs-viewer read DTOs, **mirrored** (like `PiEvent`), never imported from `pi-spec-graph` — the wire
  carries only what the panel renders (`type`/`status` stay `string`: tolerate whatever is on disk);
  **`TodoItem`/`TodoGroupItem`/`TodoPlan`** + the **`TodoStatus`/`TodoOrigin`** unions — the in-chat plan
  DTOs, **mirrored** from `pi-todos/core` (never imported), carrying the chat's per-session TODO list.
- **wsProtocol.ts** — `WS_METHODS` (`project.*` — incl. **`project.inspect`** (classify a path) +
  **`project.init`** (`git init` + commit, then open) + **`project.hasSpecs`** (lazy per-project "has any
  registered spec?" for the Welcome screen — a full-tree walk, so requested only for the shown project,
  never eagerly for every project) / `workspace.*` / `fs.*` / `git.*` / **`spec.graph`**
  (the Specs-viewer whole-graph read, per workspace) / **`todo.*`** — **`list`**/**`add`**/**`update`**/
  **`remove`**, the chat's per-session TODO plan (keyed by `workspaceId` + `sessionId`; `add` tags the
  item `origin:"user"`) / `terminal.*` / `model.list` / **`provider.status`**
(the auth-provider status report; every read revalidates host-side) / the **`provider.*` in-app login**
  (**`loginStart`** — mints a `loginId` and runs pi's OAuth flow **detached** (it can take minutes; it must
  not sit on the request nor block the WS pump) / **`loginReply`** — answers a live `select`/`prompt`,
  correlated by `loginId` / **`loginCancel`** / **`setApiKey`** (single key → auth.json) / **`logout`** /
  the **JetBrains AI** trio **`jbcentralConnect`** (wire Claude+GPT via the jbcentral proxy → a
  `JbcentralConnectResult`) / **`jbcentralDisconnect`** / **`jbcentralLogin`** (launch `central login`)) /
  `session.*` — `create`/`prompt`/`steer`/`followUp`/`abort`/`dispose`/`setModel`/
  `setThinkingLevel`/`compact`/`getStats`/`getCommands`/`extUiReply`/**`answerQuestion`** (the inline
  `ask_user_question` reply, correlated by tool call id)/**`list`**/**`getMessages`** (the
  read side) / **`settings.update`** (merge + persist a partial `AppConfig`, returns the merged config)),
  `WS_CHANNELS` (`server.welcome` — which carries the initial `config: AppConfig` alongside `projects` /
  `pi.event` / `pi.extensionUi` / **`settings.changed`** (the full `AppConfig`, broadcast so every client
  converges) / **`provider.login`** — the session-less in-app login stream (a `LoginPush`
  per frame, keyed by `loginId`; the sibling of `pi.extensionUi`, since a login runs on the Welcome screen
  before any session exists) / `terminal.data` / the **workspace lifecycle trio** — **`workspace.created`**
  / **`workspace.updated`** / **`workspace.removed`** — registry membership changes fanned out to every
  client so it stays shared domain state (architecture #9), all emitted by the server's `workspaces`
  publisher (never a per-client optimistic mutation). `created`/`updated` carry the **full persisted
  `Workspace` snapshot** (idempotent under the transport's last-value replay, so e.g. the auto-rename's
  naive-then-agentic pair merges by `id` — never a delta); `removed` carries a **`WorkspaceRemoved`** id
  pair (`{ projectId, id }` — the record is already gone) / **`workspace.fsChanged`** — the worktree
  change-notifier push (**`WorkspaceFsChangedPayload`**: `{ workspaceId, paths, truncated }`,
  worktree-relative deduped paths, capped — `truncated` = treat as wildcard); an **invalidation nudge,
  not data**: clients re-read via the existing read methods, so a duplicate/replayed frame is harmless.
  The `WsMethodMap` typed request/result map +
  `WsParams`/`WsResult` helpers, and `PROTOCOL_VERSION`.

## Get right

- **Type-only, from the package roots, always** (verified vs 0.80.6: type-only imports are erased by
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
