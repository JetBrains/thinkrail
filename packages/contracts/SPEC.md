---
id: module-contracts
type: module-design
status: active
title: Wire contracts (types-only)
parent: architecture
depends-on: []
references: [central-integration]
tags: [v1, wire]
---

## Responsibility

The browser↔host wire spine: the single source of truth for the protocol. Types-only, with the only
runtime exports being the WS method/channel constants, the protocol version, and the small config default
(`DEFAULT_CONFIG`). The one package `apps/web` may depend on—which is what lets the UI ship independently
of the host.

## Boundary

- **Owns:** the wire — entity types, the `pi` event/message types (re-exported), the WS method & channel
  registries, and the protocol version. Including **`WsErrorCode`** — the closed set of failures the *host
  names* (`WsResponse.errorCode`, today `UNKNOWN_COMMIT`, `PUSH_AUTH_FAILED`, and
  `SUBAGENT_TRANSCRIPT_NOT_FOUND` — the latter is `subagent.getTranscript`'s **permanent** miss, the
  signal that stops the transcript dialog's polling, while transport blips stay plain-`error` transients
  worth retrying), so a client can react to one specific failure
  instead of pattern-matching an error message. A failure earns a code only when a client behaves differently
  for it; everything else stays a plain `error` string. Expected method-specific outcomes remain typed method
  results rather than generic WS failures; current-layout synchronization has no steady-state wire outcome.
- **Public surface (`index.ts`):** `export type *` of `piProtocol` + `domain`; the value re-exports
  `DEFAULT_CONFIG`, `MAX_HISTORY_LIMIT`, `MAX_HISTORY_QUERY_LENGTH`, `TODO_NUDGE_PREFIX` +
  **`isControlMessage(text)`** (the one shared reading of that marker — the client hides such sends on
  hydrate, the host skips them in the history index and does not count them as `message_sent`; both
  sides agree here rather than each re-deriving `startsWith`) + **`isRetriedAttempt(messages, index)`**
  (the one shared reading of pi's persisted-but-superseded auto-retry attempts — the client's hydration
  hides their turns, the host's history indexer skips their text; both consume the index slot so jump
  anchors stay aligned) from `domain`; **`isTranscriptMessageRole(role)`**
  from `piProtocol` (the one definition of which roles a transcript carries: the host filters
  `session.getMessages` by it *and* `history` counts `messageIndex` by it, so two copies differing by a role
  would silently shift every later jump anchor); `export *` (value) of `wsProtocol`
  (`WS_METHODS`, `WS_CHANNELS`, the typed maps, `PROTOCOL_VERSION`).
- **Allowed deps:** none at runtime. **Type-only** devDeps on `@earendil-works/pi-ai` +
  `@earendil-works/pi-agent-core`, imported **from their package roots** (type-only → erased at build).
- **Deployment obligation:** contracts describe host behavior and compatibility, never the launcher or
  deployment that supplies it. A feature's wire shape is shared by browser, desktop, and future clients.
- **Forbidden:** any *value* import of a `pi` package; **any** import (even `type`) of
  `@earendil-works/pi-coding-agent` (pulls `node:fs`); the pi-ai **provider / API subpaths**
  (`/providers/*`, `/api/*`, `/bedrock-provider`, … — they statically load the Node provider SDKs); and
  importing `server` / `shared` / `web`.

## Contents

- **piProtocol.ts** — `import type` re-exports from the pi package roots (type-only → erased at build):
  - `@earendil-works/pi-ai`: `Model`, `Message`, `UserMessage`, `AssistantMessage`,
    `ToolResultMessage`, `TextContent`, `ThinkingContent`, `ImageContent`, `ToolCall`,
    `AssistantMessageEvent`, `Usage`, `StopReason`;
  - **`WireModel`** = `Pick<Model<string>, "id"|"name"|"provider"|"contextWindow"|"reasoning">` **+ the one
    computed field `thinkingLevels`** (pi-ai `getSupportedThinkingLevels`, mapped host-side in `toWireModel`;
    client→host params carry it inert) — the shape a model takes **on the wire**
    (`model.list`/`model.refresh`/`model.default`, the `session.create` result + params,
    `session.setModel` params, `SessionSummary.model`). An **allowlist** of exactly what the UI renders, *not*
    an `Omit`: extension/provider `Model.baseUrl` and `headers` can carry routing credentials, and an allowlist
    **fails closed** — a future `Model` field (secret
    or not) is excluded by default. The host re-resolves the real `Model` from `{provider,id}` — so a client
    can neither read the secret nor inject a `baseUrl` for the agent to call (see the `agent` module SPEC);
  - `@earendil-works/pi-agent-core`: `AgentEvent`, `AgentMessage`, `ThinkingLevel` (the
    `off`-inclusive one);
  - the local render union **`PiEvent`** — the real superset `AgentSessionEvent` lives in the Node-only
    `pi-coding-agent`, so it's **mirrored** here (the `agent_end.willRetry` + `agent_settled` /
    `queue_update` / `compaction_*` / `auto_retry_*` / `summarization_retry_*` /
    `session_info_changed` / `thinking_level_changed` members, plus `bash_execution_update` — mirrored
    for union fidelity only; the host never calls `executeBash`, so the UI never receives it).
    `agent_settled` is a host projection carrying the final attempt's reported terminal metadata
    (`stopReason` + optional `errorMessage`): `agent_end.willRetry` covers provider auto-retry only and
    is not an automatic-work terminal when compaction or a queued continuation follows.
    `compaction_end.result` is typed as **`CompactionEndResult`** — an allowlist mirror of pi's
    Node-only `CompactionResult` carrying exactly what the compaction notice renders
    (`tokensBefore` + optional `estimatedTokensAfter`); the host constructs this projection rather than
    casting pi's richer object wholesale, and wire data remains untrusted, so the reducer guards the field
    shapes rather than assuming them;
  - **`SessionEventPayload`** (`{ sessionId, event: PiEvent }`) — the `pi.event` push frame.
  - the cheap-win mirrors (declared in the Node-only `pi-coding-agent`): **`SessionStats`** + **`ContextUsage`**
    (tokens/cost/context bar — display only) and **`SlashCommandInfo`** + **`SlashCommandSourceInfo`** (the
    command/skill autocomplete catalog, returned by live `session.getCommands` and skill-only pre-session
    `skill.list`), and **`SkillCatalogEntry`** + **`SkillDecision`** (`load`/`untrusted`/`pending-ack`/
    `disabled`) — the workspace Skills manager's `skills.state` rows.
  - **`SessionSummary`** — a chat session as the host reports it for hydration (read side); `live`
    distinguishes an in-memory session from a disk-only one. A frontend hydrates locally placed sessions and
    lists the rest in chat history for explicit reopen. The optional **`openTodos`** (count of non-`done`
    items in the chat's TODO plan) is populated only by `session.list` (the host decorates via the todos
    module) for history/status presentation; absent = unknown, treated as 0. A live
    summary's optional **`lastSettlement`** retains the host-observed terminal (`null` = the live run is
    active or settled without an assistant) so reconnect can surface a final failure Pi removed from its rebuilt context; absent
    means this host process has not observed a settlement and the persisted transcript is authoritative.
    The optional **`queue`** (**`SessionQueueState`**: pi's pending `steering`/`followUp` texts plus
    `hasImages?: true`, the host's conservative aggregate over queued browser sends) rides a live summary
    only when non-empty — the hydration seed for the client's pending strip, since `queue_update` fires only
    on changes and a client attaching mid-run would otherwise never learn of messages queued before it
    connected. The same aggregate enriches projected `queue_update` events; image bytes never ride this
    read-side queue state. Destructive operations use the separate **`SessionQueueContent`** /
    **`QueuedMessageContent`** shapes, which return each drained message's text and optional images exactly
    once so the composer can restore complete content without making ordinary queue broadcasts heavy.
    `session.getMessages` returns `{ summary, messages }` (the transcript is
    **`TranscriptMessage[]`** — the pi-canonical `Message` union widened with **`WireCustomMessage`**, a
    type-only mirror of pi-coding-agent's Node-only `CustomMessage`, so extension-injected messages like
    the ask replies cross the wire, and with **`WireCompactionSummary`** (mirror of the Node-only
    `CompactionSummaryMessage`: `summary`/`tokensBefore`/`timestamp`), the resolved-context record of a
    compaction — pi places it before the kept tail and drops the summarized messages, so forwarding it is
    what makes the compaction boundary survive reload/reopen instead of rendering a transcript that begins
    mid-conversation. The summary reflects the now-live session after a disk re-open). The role universe a
    host may send is pinned by the runtime **`isTranscriptMessageRole(role)`** guard: the single source for
    the server's transcript filter and history index, whose alignment keeps a history hit's `messageIndex`
    valid against the client's `turnIdByMessageIndex` — a role added to one side but not the other would
    silently shift every later jump anchor.
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
- **domain.ts** — app entities: `Project` (git repo + unique `slug` + optional **`closed: true`** — the
  persisted open-rail membership bit; absence means open for backward compatibility, and closing never
  changes the project's id or deletes its workspace associations — plus the skill-trust fields **`trusted`**
  (the per-project grant), **`acknowledgedSkills`** (re-confirm-new — which committed aliases are OK'd) and
  **`disabledSkills`** / **`disabledGroups`** (project-baseline per-skill and per-group off — a group is a
  plugin, a source tier, or the special `@plugins`), which gate what its skills contribute; a workspace layers
  **`Workspace.skillOverrides`** (per-skill on/off) over that baseline;
  "does it have specs?" is **not** a field — it's the lazy `project.hasSpecs` query, since it's a full-tree
  walk), **`ProjectPathStatus`** (a
  candidate path's kind — `repo` / `initable` / `missing` / `notDirectory` — so the UI opens, offers a
  `git init`, or shows an error), `Workspace` (git worktree; its
  optional **`renamed`** flag is the naming lifecycle — absent = **not yet locked** (either pristine
  `workspace-N`, or a *provisional* non-agentic name the host applied from the first prompt), so still
  eligible for the agentic auto-rename; `true` = deliberately named (agentic or user), never auto-touched
  again; its optional **`kind: "default"`** marks the built-in per-project **Default workspace** — the
  project folder itself as a workspace, exactly one per project, pinned first in `workspace.list`,
  non-removable and non-renamable server-side; **`kind: "external"`** marks an explicitly attached,
  user-owned worktree ThinkRail may forget but must never rename or reclaim; absent = a ThinkRail-managed
  worktree workspace; optional literal **`initialTerminalPending: true`** is the host-owned provisioning
  marker carried only by newly persisted workspace records: host reserves the deterministic terminal then
  clears it, while absence is the backward-compatible legacy-or-complete value that forbids automatic
  reseeding—explicit wire fields, never id conventions),
  **`OpenBranchReview`** (the optional open review reference for the active branch: PR vs MR + number; no status/actions),
  **`ExistingWorktreeCandidate`** (a `workspace.listExisting` row: absolute `path` + `branch`, or a
  `detached` row the chooser disables), `Session` (chat tab),
  `FileNode` (file-tree node), `TabStatus`, `Git*`/diff types — incl. **`GitDiffScope`** (what the Changes
  panel is diffing: `branch` → the workspace's work since diverging from its diff base (the range starts at
  their merge-base, never the base's tip) / `uncommitted` → worktree vs `HEAD` /
  `commit` → one commit, `sha^` vs `sha`; omitted on the wire = `branch`, so an older client is unchanged)
  and **`GitCommit`** (a commit row of the scope menu's list). The two meanings of a workspace's base are
  **two fields**: `Workspace.baseBranch` is *creation provenance* (the ref the worktree was cut from — what
  the receipt's `branch · from baseBranch` shows; for a **user-owned** workspace, whose provenance isn't
  ThinkRail's to claim, it is the repo default as the *initial* review target and the UI shows no `from`)
  and the optional **`Workspace.diffBase`** is the *review
  target* (`workspace.setDiffBase`); every read resolves `diffBase ?? baseBranch` **server-side, in one
  place** — collapsing them into one field would make a re-pointed target lie about where the branch came
  from; **`ProviderStatus`/`ProviderStatusReport`**
  — the auth-provider status rows the Welcome strip renders (per-provider `configured` + auth `kind`:
  oauth / api-key / env / other — never credential values; plus `canOAuth`/`canApiKey`/`canLogout`,
  which gate the strip's in-app Sign-in / Sign-out affordances — `canLogout` is true only for a removable
  auth.json credential, false for env / runtime / models.json auth the host can't unset); the **in-app login wire** — **`LoginFrame`** (the streamed
  flow updates: `authUrl` / `deviceCode` / `select` / `prompt` / `progress` / `success` / `error`, which
  **accumulate** client-side, never a credential value), **`LoginPush`** (the `provider.login` frame,
  `{ loginId, providerId, frame }`) and **`LoginReply`** (`{ loginId, value }` — the browser's answer to a
  `select`/`prompt`); the JetBrains AI wire (protocol v43) — **`JbcentralStatus`**, nested on
  `ProviderStatusReport`, is the closed host-authored lifecycle: `absent`, `outdated`, `supported`,
  `configured`, `malformed-version`, `probe-failed`, `configuring`, or `load-failed`. Auth rides as a
  **`signedOut` flag on `supported`/`configured`**, and configured status also carries the closed
  **`proxyStopped`** observation; neither is a state of its own because credentials, proxy process health,
  and configuration are independent axes. Both flags are *positively observed negative
  facts* — unavailable or unreadable probes report `false`, so a client never renders a recovery demand the host did not
  substantiate. No proxy port, PID, URL, status text, or diagnostics cross the wire. Only
  parseable safe versions, closed probe/failure reasons, and the current action appear where relevant.
  `configuring` covers both a reviewed CLI action and the coalesced candidate rebuild for the newest watched
  artifact state; `configured` means the **current runtime for new work** applied that artifact.
  `load-failed.configured` says whether the latest observed global state requested Central, so the client can
  offer the closed Retry/Disconnect actions without receiving an artifact path. Historical live sessions may
  retain an older runtime and are deliberately outside this status. **`JbcentralInstall`**
  carries the host's per-OS `{platform,shell,command}` official install plan. **`JbcentralActionResult`** is
  the closed `applied` / `failed` union; failure reasons distinguish installation, version probe/support,
  Central action, artifact postcondition, and closed runtime-load failure without carrying messages. There
  are no pending, restart, blocked-session, recovery, migration, compensation, or reattachment outcomes. Raw
  stdout/stderr, generated extension content or paths, proxy URLs/secrets, diagnostics, affected-session ids,
  and raw PI models are structurally absent; server and web map codes to their own generic copy);
  the **theme/config selection** — **`ThemeId`** is an open string on the wire, because the host persists
  an opaque selection while the independently shipped web client owns the available manifest catalog;
  **`ComposerGrowthLimit`** (`"compact" | "roomy" | "half-chat"`) is the closed, server-synced composer
  height preference: 6 visual lines, 10 visual lines, or 50% of the mounted chat panel respectively;
  `"half-chat"` is the default, and the web owns translating these semantic ids into geometry;
  **`AppConfig`** (`{ theme, analyticsEnabled, terminalReplayKb, composerGrowthLimit,
  customLayoutPresets }`—an extensible bag; `customLayoutPresets` is the bounded resource-free catalog and
  is the **only** layout value synchronized by the host; current/default preset and group limits are web-local);
  `analyticsEnabled` is the anonymous-usage-analytics switch, default `true`
  — it is the **only** analytics fact on the wire:
  the installation id stays server-side by design, see `submodule-server-analytics`) carries it with the
  **`DEFAULT_CONFIG`** fallback
  (persisted host-side as `config.json`, delivered in `server.welcome`, mutated via `settings.update`).
  Contracts deliberately exports no theme enum/list/labels: a future manifest can mint an id unknown when
  the host was built, and a client missing it resolves its own bundled default;
  **`SpecGraphNode`/`SpecGraphSnapshot`** — the
  Specs-viewer read DTOs, **mirrored** (like `PiEvent`), never imported from `pi-spec-graph` — the wire
  carries only what the panel renders (`type`/`status` stay `string`: tolerate whatever is on disk);
  **`TodoItem`/`TodoGroupItem`/`TodoPlan`/`TodoArtifact`** + the **`TodoStatus`/`TodoOrigin`/
  `TodoArtifactKind`** unions — the in-chat plan
  DTOs, **mirrored** from `pi-todos/core` (never imported), carrying the chat's per-session TODO list.
  `TodoGroupItem` additionally carries **`status: TodoGroupStatus`** — the group's *task* lifecycle
  (`pending`/`active`/`done`), **derived by the host** from the steps (`pi-todos`' `groupStatus`) rather than
  stored: shipping it means the truth table has one home and no client re-derives it. A `commit`
  artifact additionally carries **`files?: GitFileChange[]`** (path + status + `+/−` — the same rows
  the Changes panel renders at the commit scope) — host-derived from git by `todo.list`'s decoration
  (same one-home rationale), never stored; absent = the sha no longer resolves, degrade silently.
  `TodoItem.summary` / `TodoPlan.summary` are the agent's completion notes (per step / whole plan, as
  stored) and `TodoItem.verification` the separate self-reported check line (exact command + result, or
  "not verified" — clients render it as a badge labeled as the agent's own claim, never a host gate); **`TodoItem.review?: TodoReviewInfo`** (+ the **`TodoReviewState`** union) is the host-derived
  review decoration, present only on reviewable items (those with a host change set): `state`
  (`unreviewed`/`reviewed`/`changes_requested` — `unreviewed` = no stored record), `revision` (commit
  count — 1 TODO = N commits), `unreviewedShas` (commits since the user's watermark — the "changed since
  review" delta), `feedback` + `at`. Review state lives in a host sidecar, never the agent-writable plan;
  see [[submodule-server-todos]]. **`TodoPlan.unattributed?: GitFileChange[]`** is the host-derived
  remainder shipped by the same `todo.list` decoration, present only when non-empty: the worktree's
  uncommitted rows attributed to no item of the plan — the changes that would otherwise be invisible in
  the review map (derivation and rationale: [[submodule-server-todos]]).
  **`DelegationRunDetails`** + the **`DelegationRunStatus`** union — the subagent Agent-card DTO,
  **mirrored** from `pi-delegation` (never imported): rides `tool_execution_update.partialResult`
  (REPLACE), the final `Agent` tool result, and the `subagent-completion` custom message; the
  child transcript itself is read via `subagent.getTranscript`, keyed
  `(workspaceId, parentSessionId, childSessionId)` — its result also carries the run's current
  registry `status` (absent once the host no longer knows the run), the client's poll-while-live
  signal. The completion message's tag + pairing live in
  `wsProtocol` (the value-bearing half), mirroring the ask-user-answers posture exactly: the
  **`SUBAGENT_COMPLETION_CUSTOM_TYPE`** constant (mirrors `pi-subagents`' `SUBAGENT_COMPLETION_MESSAGE`,
  never imported — the DTO posture again), **`SubagentCompletionMessage`** (the compile-held tag↔details
  shape) and the shared **`isSubagentCompletionMessage`** guard — wire data is untrusted, so the
  details validate through **`isDelegationRunDetails`** (domain): the **closed status union**, every
  required **numeric usage field**, `durationMs`, and every present optional display field as a string,
  never just "an object is present" (PR #303 review finding). That validator is the one home for the
  shape check — the web's Agent-card reader
  narrows through it too — plus **`customMessageText`** — the one text extraction over
  `WireCustomMessage.content` (string | blocks), shared by the web's event reducer and hydration so the
  completion card's text derives once.
  **history-search read DTOs** — **`HistoryScope`** (the overlay's cycle: this chat → workspace →
  project → everywhere); **`PromptHit`** (a recalled prompt; carries optional `messageIndex` +
  `anchorText` — the kept-newest occurrence's jump anchor) and **`MessageHit`** (a full-text
  conversation match; assistant-only — a user-role hit only ever duplicates its own `PromptHit`'s text,
  so the jump affordance lives there instead; `messageIndex` anchors jump-to-message into
  `session.getMessages` order, `anchorText` makes the anchor drift-tolerant), and
  **`HistorySearchResult`** (the prompts + full-text messages sections, with totals and indexing status);
  the **review DTOs** — **`Review`** (one open review per workspace; `baseSha` — the reviewed diff's
  ORIGINAL side (the branch range's fork point, what that diff actually displays — never the target's
  tip, which can carry upstream commits the review never showed) pinned to a **full commit oid at
  creation**, immutable for the review's life — plus **`fileSessions`**, key → that
  key's review chat: one chat per file, pinned on first send, the **empty key** being the anchorless
  whole-change-set bucket, pinned the same way so a second overall remark continues one discussion —
  and **`doneFiles`**, same keys: files whose review the user marked finished, so a fully-resolved
  file leaves the list only on their say-so), **`ReviewComment`** (`kind`
  inline/diff/file/review; `status` draft/sent/resolved/
  dismissed — orthogonal to **`anchorState`** anchored/moved/outdated; per-comment `sessionId` — the
  chat it was sent into), **`ReviewAnchor`** (`path` + `side` + `contentHash` + an ordered **`ReviewSelector`**
  fallback chain: `lineRange` / `textQuote` / `diffHunk` / `structural` — the last two are forward
  slots V1 authors don't populate; a `side: "base"` anchor additionally carries **`baseRef`**, the ref
  its lines and fragment were captured against, since the two diff sides are two line spaces, plus the
  **`scope`** it was captured in — the diff identity that reopens the one surface rendering that blob),
  **`ReviewSnapshot`** (`{ review, comments }` — the `review.get`
  read and, with `workspaceId`, the `review.changed` push payload **`ReviewChangedPayload`** —
  full-snapshot so replay is idempotent);
  **prompt-template DTOs** — **`TemplateScope`** (`"global"` | `"project"` — where a template lives),
  **`TemplateInfo`** (metadata only: name, optional `description`/`argumentHint`, `scope`, `filePath` —
  what `template.list` returns; deliberately body-free so a listing never ships every file's full text),
  and **`Template`** (`TemplateInfo` + full `content` — frontmatter + body — the by-name
  `template.get`/`template.save` shape);
  **layout preset DTO** — portable **`LayoutPreset`**, the bounded resource-free frame grammar synchronized
  in `AppConfig.customLayoutPresets`: center topology, left/right/bottom group geometry, visibility/folds,
  bottom alignment, and singleton tools, but no workspace, file, diff, chat, document, terminal, preview,
  attention, or current/default-selection identity. Current `WorkbenchFrame` and `WorkspaceViewState` are
  web-local and deliberately absent from contracts.

  During one compatibility protocol only, version-2 **`WorkspaceLayoutDocument`** and
  **`WorkspaceLayoutSnapshot`** remain deprecated exports for the new client's read-once importer. They are
  removed with `layout.get` in the following protocol. Replace params/results, mutation ids,
  `LayoutChangedPayload`, and wire `LayoutSettings` are removed in the first new protocol.
- **wsProtocol.ts** — `WS_METHODS` (`project.*` — incl. **`project.close`** (mark the stable record
  closed without deleting associated state), **`project.inspect`** (classify a path) + **`project.init`**
  (`git init` + commit, then open) + **`project.hasSpecs`** (lazy per-project "contains a registered
  spec?" for the Welcome screen — a full-tree walk, so requested only for the shown project,
  never eagerly for every project) / `workspace.*` — notably **`workspace.list { projectId,
  includeDiffStats? }`**, where omitted/true preserves the existing full rows with computed aggregates and
  `false` returns the same authoritative membership/order without the synchronous per-workspace diff-stat
  fan-out used nowhere by navigation restoration / `fs.*` / `git.*` / **`spec.graph`**
  (the Specs-viewer whole-graph read, per workspace) / **`todo.*`** — **`list`**/**`add`**/**`update`**/
  **`remove`**, the chat's per-session TODO plan (keyed by `workspaceId` + `sessionId`; `add` tags the
  item `origin:"user"`), plus the review ops **`review`** (approve: record `reviewed` + the sha
  watermark), **`requestFix`** (record `changes_requested` + feedback, then the host fires the fix
  package into the item's own chat — detached, rolled back on a pre-turn rejection) and
  **`startReview`** (the AGENT review: the plan's pinned reviewer chat gets the item's package; findings
  arrive as `author: "agent"` review comments, the verdict via the reviewer-only `review_verdict` tool;
  `TodoItem.review` carries `reviewing` while the verdict is pending and `reviewedBy` on an agent
  approve) / **`terminal.*`** — **`reserve`** (idempotently establishes a host-catalog tab
  without starting its PTY; `INITIAL_TERMINAL_TAB_KEY` names the one host-seeded tab that every frontend
  may place passively) / **`attach`** (idempotent get-or-create keyed by `(workspaceId, tabKey)`,
  returning `created` + the `replay` to repaint; the only way a PTY is born, and it replaced
  `create`+`alive`) / **`list`** (the host owns the tab list) / `write` / `resize` /
  **`close`** (by `tabKey`, refusing a busy shell unless `force`) / `model.list` + **`model.refresh`** (awaits the host's
  single-flighted catalog refresh and returns **`RefreshedModels`** — the post-refresh list plus
  **`complete`**, whether that pass settled inside the host's capped wait, since only a settled list is
  authoritative; `force` bypasses pi's 4h freshness throttle, so a user-initiated refresh actually fetches) / **`model.clampThinking`** (pi's
  `clampThinkingLevel` for a `{model, level}` pair — the pre-session picker's effort adjustment, so no
  client re-derives pi's policy) / **`provider.status`**
(the auth-provider status report; every read revalidates host-side) / the **`provider.*` in-app login**
  (**`loginStart`** — mints a `loginId` and runs pi's login flow **detached** (`type` `"oauth"` |
  `"api_key"`, issue #97 — both auth routes ride one channel; a flow can take minutes and must
  not sit on the request nor block the WS pump) / **`loginReply`** — answers a live `select`/`prompt`,
  correlated by `loginId` / **`loginCancel`** / **`logout`** /
  the **JetBrains AI** set **`jbcentralConnect`** / **`jbcentralDisconnect`** /
  **`jbcentralStartProxy`** / **`jbcentralUpdate`** / **`jbcentralLogin`** (native global Central actions
  returning `JbcentralActionResult`; none accepts an executable, artifact path, output, URL, or secret from
  the client)) /
  **`workspace.listExisting`** (the selected project's unattached Git worktrees, with detached rows
  disabled by status) / **`workspace.openExisting`** (revalidate + register one branch-backed checkout as
  `kind: "external"`, emitting the ordinary `workspace.created`, without mutating Git or disk) /
  **`workspace.openReview`** (the active branch's optional `OpenBranchReview` metadata) /
  **`project.setTrust`** (persist a project's trust grant → the updated `Project`; gates its committed
  cross-agent skill aliases) /
  **`skill.list`** (a pre-session, skill-only `SlashCommandInfo[]` preview for a `projectId`, resolved from
  that project's current checkout with its **project-scoped aliases gated by trust**; the eventual worktree
  session is authoritative) / the **Skills-manager set** — **`project.aliasSkills`** (present committed alias
  names, for the presence-gated notice's count) / **`project.acknowledgeSkills`** (confirm skills that
  appeared after trust) / **`project.setSkillEnabled`** (project baseline) / **`project.setGroupEnabled`**
  (turn a plugin / source tier / `@plugins` on/off at the baseline) / **`workspace.setSkillOverride`**
  (per-workspace on/off/clear → the `Workspace`) / **`workspace.setDiffBase`** (re-point the diff target,
  `null` clears it back to the creation base — echoes the updated `Workspace` **and** broadcasts
  `workspace.updated`, so every client converges on the push) / **`workspace.watchReady`** (await the
  fresh watcher's conservative startup nudge before a skill-loading client captures its freshness baseline;
  `{ startupNudge }` is true unless the watcher was already known ready, so a replayed response can supply
  the client's conservative fallback when the event push was lost or startup failed; an optional
  `prewarm: true` marks the started watcher as prewarm-only — the host keeps those in a globally bounded,
  evictable pool and any real preflight/read promotes them out of it, see the server `watch` SPEC) / **`git.status`** +
  **`git.diffFile`**, both
  taking an optional **`scope: GitDiffScope`** (an unresolvable scope — a commit a rebase removed — is
  *rejected*, which the panel reads as "reset the scope" instead of staying wedged on a dead sha) /
  **`git.listCommits`** (the workspace branch's own commits, `<diff base>..HEAD`, newest first, capped
  host-side — the scope menu's lazily-fetched list) / **`git.prefetch`** (best-effort background fetch of a
  remote base — the New-Workspace dialog's freshness warm-up; always acks `{ ok }`, and when the fetch
  actually moved the local remote-tracking ref the host follows up with pathless `workspace.fsChanged`
  frames to the workspaces whose diff base that ref is, so their git-derived reads re-converge) / **`skills.state`** (`SkillCatalogEntry[]` — full catalog +
  per-skill `decision` + `group` — for a `workspaceId`) / **`project.skills`** (the same, project-scoped, for
  the pre-session manager) / **`session.reloadResources`** (re-scan skills + rebuild the system prompt for one
  running session; rejected while streaming) /
  `session.*` — `create`/`prompt`/`steer`/`followUp`/**`clearQueue`** (drain Pi's steering+followUp
  queues, returning complete `SessionQueueContent`; Pi itself emits the emptying `queue_update`; optional
  `requireTextOnly` rejects without draining when the host has observed queued images, which is the manual
  compaction precondition)/**`removeQueued`** (`{ kind, index }` → `RemovedQueuedMessage`: drop or extract ONE
  queued message with its complete content — the strip rows' edit/remove; position-addressed because Pi's
  queue entries are bare strings with no id, and the host emulates per-item removal over Pi's all-or-nothing
  `clearQueue`, see the server agent SPEC)/**`abort`** (ordinary abort preserves queued lanes for Interrupt;
  `{ restoreQueue: true }` atomically drains complete content before signalling abort and returns it after the
  session reaches idle, which is Stop's lossless path)/`dispose`/**`delete`**/`setModel`/
  `setThinkingLevel`/`compact`/`getStats`/`getCommands`/`extUiReply`/**`answerQuestion`** (the inline
  `ask_user_question` reply, correlated by tool call id)/**`list`**/**`getMessages`** (the
  read side) / deprecated read-only **`layout.get`** (one compatibility protocol for read-once import;
  removed next protocol) / **`settings.update`** (merge + validate + persist a top-level partial `AppConfig`; when present,
  `customLayoutPresets` is one complete bounded catalog replacement; returns the merged config) /
  **`history.search`** (the prompt-recall + conversation-search read; results capped,
  recency-ordered; the messages section is assistant-only — a user-role hit surfaces as a jumpable
  `PromptHit` instead, never a separate `MessageHit`) / the **`review.*` set** — **`get`** (the open
  review + comments, lazily created; re-anchored on read) / **`commentAdd`**/**`commentUpdate`**/
  **`commentDelete`** (authoring + manual resolve/dismiss; delete is DRAFT-only — a sent comment is a
  record, and resolved is final: no reopen and no
  worktree rollback on the wire; `commentAdd` takes the diff tab's
  `scope`, which is what lets the host resolve a base-side anchor's `baseRef` — and is persisted on the
  anchor) / **`sendComment`** (one comment → its FILE's review chat, created on the file's first send
  then `followUp`ed) / **`sendBatch`** (all/selected drafts, grouped per key into each key's chat;
  answers with **every** session it touched, in group order — naming only the first left the other
  chats invisible while their comments already read as sent) — both carry **`ReviewSendResult`**: `session.create`'s shape
  plus **`reused`**, the one fact only the host knows (was this chat followed up into, or created now?).
  A reused chat may be one the client has never seen — a second client, or this one after a reload,
  since review state and pi transcripts both outlive the host — so it must be HYDRATED, not opened as
  new; opening it as new shows a blank conversation for comments already marked sent / **`fileDone`**
  (mark a fully-resolved file's review finished; rejected while anything is unresolved — a new
  comment re-opens the file) / **`close`** (the atomic Clear: archive the current review's non-draft
  records, discard drafts, replace the active review, and publish the fresh open snapshot to every client)
  — plus
  **`template.*`** — prompt-template CRUD
  (**`template.list`**, **`template.get`**
  — `scope` optional, project wins over global, **`template.save`**, **`template.delete`**) — all
  read/write pi's prompt dirs (global + project), so templates stay CLI-portable,
  `WS_CHANNELS` (`server.welcome` — which carries the initial `config: AppConfig` alongside **`projects`**
  (open records) and **`recentProjects`** (all known records, open + closed), plus **`hostPlatform`**
  (`darwin | linux | win32`, optional for older hosts) — the OS the *host* runs on, so a client that
  offers host-executed commands (the PR setup dialog) picks the right ones instead of guessing from
  the browser / **`project.updated`** — the
  full persisted `Project` snapshot after open/reopen/close, including `closed` membership, so every client
  atomically converges its rail + Recents without optimistic removal / `pi.event` / `pi.extensionUi` /
  **`session.created`** (the initial `SessionSummary`, broadcast when a new host-owned session registers so
  other frontends can list it in history without opening local placement) / **`session.deleted`** (workspace +
  session id; a non-replayable domain event broadcast after permanent deletion so every client removes the chat
  and blocks stale hydration) /
  **`settings.changed`** (the full `AppConfig`, including custom preset definitions, broadcast so every
  client converges) / **`provider.login`** — the session-less
  in-app login stream (a `LoginPush`
  per frame, keyed by `loginId`; the sibling of `pi.extensionUi`, since a login runs on the Welcome screen
  before any session exists) / **`provider.changed`** — a data-free invalidation broadcast after a watched
  Central state/rebuild result changes the host-authoritative provider status or current model generation;
  clients re-read `provider.status` and invalidate `model.list`, so no raw provider/model data rides the push /
  `terminal.data` + **`terminal.exit`** + **`terminal.detached`** (the only
  **addressed** channels — sent to the single *attached* client rather than broadcast, so a shell's bytes never
  reach another browser; `terminal.data` may carry `truncated` when the host had to drop held output,
  `terminal.detached` says another client took the tab over) / the **workspace lifecycle
  trio** — **`workspace.created`**
  / **`workspace.updated`** / **`workspace.removed`** — registry membership changes fanned out to every
  client so it stays shared domain state (architecture #9), all emitted by the server's `workspaces`
  publisher (never a per-client optimistic mutation). `created`/`updated` carry the **full persisted
  `Workspace` snapshot** (idempotent under the transport's last-value replay, so e.g. the auto-rename's
  naive-then-agentic pair merges by `id` — never a delta); `removed` carries a **`WorkspaceRemoved`** id
  pair (`{ projectId, id }` — the record is already gone) / **`review.changed`** — a workspace's review
  state changed (emitted by the server's `reviews` publisher on every mutation — UI edits, agent
  `resolve_comment` calls, re-anchoring — so all clients converge, same pattern as the trio) /
  **`workspace.fsChanged`** — the worktree
  change-notifier push (**`WorkspaceFsChangedPayload`**: `{ workspaceId, paths, truncated, skillChange }`,
  worktree-relative deduped paths, capped — `truncated` means the generic path list is incomplete and must
  be treated as a wildcard; `skillChange: "none" | "detected" | "unknown"` is an **independent semantic
  fact**, accumulated before that cap, so a concrete non-skill overflow stays `none`, a skill path omitted
  after the cap stays `detected`, and only a pathless platform/startup uncertainty is `unknown`; a pathless
  non-truncated/`none` frame is a whole-workspace invalidation such as repo-metadata drift); an
  **invalidation nudge, not data**: clients re-read via the existing read methods, so a duplicate/replayed
  frame is harmless.
  The `WsMethodMap` typed request/result map +
  `WsParams`/`WsResult` helpers, and `PROTOCOL_VERSION`. Request ids are also the reconnect idempotency key:
  an unresolved client replays the same frame/id, and the host returns the one cached result for
  `(clientKey, requestId)` instead of executing the handler again. Two client→host frames that are *not* requests close
  that loop (hence **`WsClientMessage`**, discriminated on the key): **`WsAck`** (`{ ack: string[] }`) names
  responses the client has *read* — the only thing that distinguishes a reply the page received from one that
  died in a socket buffer, and so the only thing that lets the host free a retained result — and **`WsResume`**
  (`{ resume: string[] }`), sent on every (re)connect ahead of the replays, names the complete set the page
  still considers unresolved, so the host can release everything else. `resume` exists because a receipt is only
  as reliable as the socket carrying it and nothing would ever re-send a lost one: restating the live set beats
  confirming the confirmations. This behavior is protocol-versioned — a replaying UI must never run against a
  pre-dedup host.

## Get right

- **Mirrors are not version-pinned in comments.** A shape re-declared here because its real home is
  Node-only carries *what* it mirrors, never *which pi version it was last checked against*: those
  markers had to be hand-edited across several files on every bump and nothing verified them. A
  UI-relevant lifecycle member must be explicit here (especially the host-enriched `agent_settled`);
  UI-irrelevant session events such as `entry_appended` may remain unmodelled and ignored. Re-audit a
  mirror when a bump's changelog touches it, not because a comment names a version.
- **Type-only, from the package roots, always** (type-only imports are erased by
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
