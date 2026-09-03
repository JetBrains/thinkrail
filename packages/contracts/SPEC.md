---
id: module-contracts
type: module-design
status: active
title: Wire contracts (types-only)
parent: architecture
depends-on: []
references: [central-integration]
tags: [v1, wire]
spec-budget: "4500"
---

## Responsibility

The browser↔host wire spine: the protocol's single source of truth. Types-only; runtime exports are
just the WS method/channel constants, protocol version, `DEFAULT_CONFIG`. The one package `apps/web`
may depend on—so the UI ships host-independently.

## Boundary

- **Owns:** the wire—entity types, `pi` event/message types (re-exported), WS method & channel
  registries, protocol version, `WsErrorCode`.
- **Public surface (`index.ts`):** `export type *` of `piProtocol` + `domain`; `export *` (value) of
  `wsProtocol` (`WS_METHODS`, `WS_CHANNELS`, typed maps, `PROTOCOL_VERSION`, feature-introduction
  versions); value re-exports from `domain`—`DEFAULT_CONFIG`, `MAX_HISTORY_LIMIT`,
  `MAX_HISTORY_QUERY_LENGTH`, `TODO_NUDGE_PREFIX`, shared readings `isControlMessage(text)` +
  `isRetriedAttempt(messages, index)`; from `piProtocol`, shared `isTranscriptMessageRole(role)`
  guard (single readings—Session read shapes).
- **Allowed deps:** none at runtime. Type-only devDeps on `@earendil-works/pi-ai` +
  `@earendil-works/pi-agent-core`, from their package roots (type-only→erased at build).
- **Deployment obligation:** describes host behavior and compatibility, never the launcher or
  deployment supplying it; a feature's wire shape is shared by browser, desktop, future clients.
- **Forbidden:** any value import of a `pi` package; ANY import (even `type`) of
  `@earendil-works/pi-coding-agent` (pulls `node:fs`); pi-ai provider/API subpaths (`/providers/*`,
  `/api/*`, `/bedrock-provider`, …—statically load Node provider SDKs); importing
  `server`/`shared`/`web`.

## Error codes

- **`WsErrorCode`**—closed set of host-named failures (`WsResponse.errorCode`): today
  `UNKNOWN_COMMIT`, `PUSH_AUTH_FAILED`, `SUBAGENT_TRANSCRIPT_NOT_FOUND` (`subagent.getTranscript`'s
  permanent miss, stopping transcript-dialog polling; transport blips stay plain-`error` transients
  worth retrying); lets clients react to one specific failure, not pattern-match error messages.
- **Earning a code:** only when a client behaves differently for it; else plain `error` string.
  Expected method-specific outcomes stay typed method results, never generic WS failures.

## pi mirrors

- **Re-exports (`import type`, erased at build):** `@earendil-works/pi-ai`—`Model`, `Message`,
  `UserMessage`, `AssistantMessage`, `ToolResultMessage`, `TextContent`, `ThinkingContent`,
  `ImageContent`, `ToolCall`, `AssistantMessageEvent`, `Usage`, `StopReason`;
  `@earendil-works/pi-agent-core`—`AgentEvent`, `AgentMessage`, `ThinkingLevel` (`off`-inclusive).
- **`PiEvent`**—local render union; real superset `AgentSessionEvent` lives in Node-only
  `pi-coding-agent`, hence mirrored: `agent_end.willRetry`+`agent_settled`/`queue_update`/
  `compaction_*`/`auto_retry_*`/`summarization_retry_*`/`session_info_changed`/
  `thinking_level_changed`; `bash_execution_update` rides for union fidelity only (host never
  calls `executeBash`, so the UI never receives it). **`SessionEventPayload`**
  (`{ sessionId, event: PiEvent }`) is the `pi.event` push frame.
- **`agent_settled` vs `agent_end`:** `agent_settled` = host projection of the final attempt's
  terminal metadata (`stopReason`+optional `errorMessage`); `agent_end.willRetry` covers provider
  auto-retry only—no automatic-work terminal when compaction or a queued continuation follows.
- **`CompactionEndResult`**—`compaction_end.result`'s type: allowlist mirror of pi's Node-only
  `CompactionResult`, exactly what the compaction notice renders (`tokensBefore`+optional
  `estimatedTokensAfter`); host constructs it, never casts pi's richer object wholesale; wire data
  untrusted → reducer guards field shapes.
- **Display mirrors (declared in Node-only `pi-coding-agent`):** `SessionStats`+`ContextUsage`
  (tokens/cost/context bar); `SlashCommandInfo`+`SlashCommandSourceInfo` (command/skill autocomplete
  catalog; live `session.getCommands`+skill-only pre-session `skill.list`);
  `SkillCatalogEntry`+`SkillDecision` (`load`/`untrusted`/`pending-ack`/`disabled`)—Skills-manager
  `skills.state` rows.
- **Extension-UI frames `ExtUiRequest`/`ExtUiResponse`**—pi's in-process `uiContext` calls on
  `pi.extensionUi`: `select`/`confirm`/`input`/`editor` round-trip,
  `notify`/`setStatus`/`setWidget`/`setTitle`/`dismiss` fire-and-forget.

## WireModel

- **`WireModel`** = `Pick<Model<string>, "id"|"name"|"provider"|"contextWindow"|"reasoning">` + one
  computed field `thinkingLevels` (pi-ai `getSupportedThinkingLevels`, mapped host-side in
  `toWireModel`; client→host params carry it inert)—a model's on-the-wire shape
  (`model.list`/`model.refresh`/`model.default`, `session.create` result+params, `session.setModel`
  params, `SessionSummary.model`).
- **An allowlist, NOT an `Omit`—fails closed:** extension/provider `Model.baseUrl` and `headers` can
  carry routing credentials; an allowlist excludes any future `Model` field (secret or not) by
  default.
- **Host re-resolves** the real `Model` from `{provider,id}`—client can neither read the secret nor
  inject a `baseUrl` for the agent to call (see `agent` module SPEC).

## Session read shapes

- **`SessionSummary`**—chat session as host-reported for hydration (read side); `live` distinguishes
  in-memory from disk-only. Frontends hydrate locally placed sessions, list the rest in chat history
  for explicit reopen.
- **`openTodos`**—non-`done` TODO-plan count; `session.list`-only (host decorates via todos), for
  history/status; absent = unknown→treated as 0.
- **`lastSettlement`** (live summaries)—host-observed terminal: `null` = run active or settled
  without an assistant; lets reconnect surface a final failure Pi removed from its rebuilt context;
  absent = unobserved this process→persisted transcript authoritative.
- **`queue`** (`SessionQueueState`: pending `steering`/`followUp` texts+`hasImages?: true`; host's
  conservative aggregate over queued browser sends)—live summaries only, when non-empty: hydration
  seed for the client's pending strip—`queue_update` fires only on change, so a mid-run attach never
  learns pre-connect sends. Same aggregate enriches projected `queue_update`; image bytes never ride
  it.
- **Destructive ops** use separate `SessionQueueContent`/`QueuedMessageContent`—each drained
  message's text+optional images exactly once: composer restores complete content; ordinary queue
  broadcasts stay light.
- **`session.getMessages`**→`{ summary, messages }`; transcript = `TranscriptMessage[]` =
  pi-canonical `Message` union+`WireCustomMessage`+`WireCompactionSummary`; summary reflects the
  now-live session after disk re-open.
- **`WireCustomMessage`**—type-only mirror of `pi-coding-agent`'s Node-only `CustomMessage`, so
  extension-injected messages (the ask replies) cross the wire.
- **`WireCompactionSummary`**—mirror of Node-only `CompactionSummaryMessage`
  (`summary`/`tokensBefore`/`timestamp`), the resolved-context compaction record: pi places it
  before the kept tail and drops the summarized messages—forwarding it keeps the compaction boundary
  across reload/reopen, never a transcript starting mid-conversation.
- **Shared readings (one source each, both sides):**
  - **`isTranscriptMessageRole(role)`**—sendable role universe: server filters `session.getMessages`
    by it AND `history` counts `messageIndex` by it; a one-sided role addition silently shifts every
    later jump anchor (`messageIndex` vs client `turnIdByMessageIndex`).
  - **`isControlMessage(text)`**—client hides such sends on hydrate; host skips them in the history
    index, never counts `message_sent`; one reading, not per-side `startsWith`.
  - **`isRetriedAttempt(messages, index)`**—pi's persisted-but-superseded auto-retry attempts:
    hydration hides their turns, history indexer skips their text, both consume the index slot—jump
    anchors stay aligned.

## ask + subagent wire

- **Questions:** `AskUserQuestionArgs` (`AskUserQuestionItem`+`AskUserQuestionOption`, latter with
  optional `recommendedReason`—rendered inline as a `Why:` line under the option)—agent-authored
  questions, read by the tool card from the `toolCall` block.
- **Reply:** `AskUserQuestionResult` (`AskUserQuestionAnswer[]`+`cancelled`); tool-result `details`
  = `AskUserQuestionAckDetails` under the ack+terminate design—the call resolves instantly, the turn
  ends.
- **Ask custom message:** the reply travels as an `ask-user-answers` custom message the card pairs
  by `details.toolCallId`; `wsProtocol` (value-bearing half) holds `AskUserAnswersDetails`, the
  `ASK_USER_ANSWERS_CUSTOM_TYPE` constant, `AskUserAnswersMessage` (compile-held tag↔details pairing
  for the host's builder), shared `isAskUserAnswersMessage` guard.
- **Open namespace:** `WireCustomMessage.customType` stays `string`—any pi extension can mint custom
  messages; all cross the wire—so strictness lives at producer+guard, which validates the details
  shape (wire data untrusted: another process, maybe another protocol version).
- **Ask ownership:** the `ask_user_question` capability is a host-owned pi custom tool (server
  `agent/askUserQuestion`—design rationale in its SPEC); chat renders the questionnaire inline;
  replies via `session.answerQuestion` (tool-call-id correlated; rejected loud when
  unknown/answered/superseded).
- **Subagent DTO:** `DelegationRunDetails`+`DelegationRunStatus`—the Agent-card DTO, mirrored from
  `pi-delegation` (never imported); rides `tool_execution_update.partialResult` (REPLACE), the final
  `Agent` tool result, the `subagent-completion` custom message. The child transcript is read via
  `subagent.getTranscript`, keyed `(workspaceId, parentSessionId, childSessionId)`; its result also
  carries the run's current registry `status` (absent once host no longer knows the run)—client's
  poll-while-live signal.
- **Subagent completion pairing** (in `wsProtocol`, the ask-user-answers posture exactly):
  `SUBAGENT_COMPLETION_CUSTOM_TYPE` (mirrors `pi-subagents`' `SUBAGENT_COMPLETION_MESSAGE`, never
  imported), `SubagentCompletionMessage` (compile-held tag↔details shape), shared
  `isSubagentCompletionMessage` guard.
- **Subagent validation:** details validate through `isDelegationRunDetails` (`domain`)—closed
  status union, every required numeric usage field, `durationMs`, every present optional display
  field as a string, never just "an object is present" (PR #303 finding); the one shape-check
  home—web's Agent-card reader narrows through it too. `customMessageText`—one text extraction over
  `WireCustomMessage.content` (string | blocks), shared by web's event reducer+hydration—the
  completion card's text derives once.

## Domain entities

- **`Project`**—git repo+unique `slug`+optional `closed: true` (persisted open-rail membership;
  absence = open, backward-compatible; closing never changes the id, never deletes workspace
  associations). "Has specs?" is not a field—lazy `project.hasSpecs` query.
- **`Workspace.renamed`**—naming lifecycle: absent = not yet locked (pristine `workspace-N` or a
  provisional non-agentic name host applied from the first prompt), still agentic-auto-rename
  eligible; `true` = deliberately named (agentic or user), never auto-touched again.
- **`kind: "default"`**—built-in per-project Default workspace (the project folder itself as a
  workspace): exactly one per project, pinned first in `workspace.list`, non-removable+non-renamable
  server-side. **`kind: "external"`**—explicitly attached user-owned worktree ThinkRail may forget
  but must never rename or reclaim; absent = ThinkRail-managed.
- **`initialTerminalPending: true`**—host-owned provisioning marker, carried only while a workspace
  needs host reservation: host reserves the deterministic terminal, then clears it; absence = no
  provisioning work remains. Explicit wire fields, never id conventions.
- **Two base fields:** `Workspace.baseBranch` = creation provenance (the ref the worktree was cut
  from—the receipt's `branch · from baseBranch`; for a user-owned workspace, the repo default as
  initial review target, UI shows no `from`); optional `Workspace.diffBase` = review target
  (`workspace.setDiffBase`). Every read resolves `diffBase ?? baseBranch` server-side, in one
  place—collapsing them would make a re-pointed target lie about where the branch came from.
- **`GitDiffScope`**—what the Changes panel diffs: `branch` = work since diverging from the diff
  base (range starts at the merge-base, never the base's tip) / `uncommitted` = worktree vs `HEAD` /
  `commit` = one commit (`sha^` vs `sha`); omitted = `branch`, older clients unchanged. `GitCommit`
  = scope-menu commit row.
- **Small entities:** `ProjectPathStatus` (candidate path kind—`repo`/`initable`/`missing`/
  `notDirectory`; UI opens, offers `git init`, or errors), `OpenBranchReview` (active branch's
  optional open-review reference: PR vs MR+number; no status/actions), `ExistingWorktreeCandidate`
  (`workspace.listExisting` row: absolute `path`+`branch`, or a `detached` row the chooser
  disables); `Session` (chat tab), `FileNode` (file-tree node), `TabStatus`, `Git*`/diff types.

## Auth + Central wire

- **`ProviderStatus`/`ProviderStatusReport`**—Welcome-strip rows: per-provider `configured`+auth
  `kind` (oauth/api-key/env/other—never credential values)+`canOAuth`/`canApiKey`/`canLogout` gating
  in-app Sign-in/Sign-out; `canLogout` true only for a removable auth.json credential (false for
  env/runtime/models.json auth host can't unset).
- **Login wire:** `LoginFrame` (streamed `authUrl`/`deviceCode`/`select`/`prompt`/`progress`/
  `success`/`error`—accumulate client-side, never a credential value), `LoginPush` (`provider.login`
  frame, `{ loginId, providerId, frame }`), `LoginReply` (`{ loginId, value }`—answer to a
  `select`/`prompt`).
- **Login methods (`provider.*`):** `loginStart` mints a `loginId`, runs pi's flow detached
  (`type`
  `"oauth"`|`"api_key"`, issue #97—both auth routes ride one channel; a flow takes minutes, must not
  sit on the request or block the WS pump); `loginReply` answers a live `select`/`prompt` by
  `loginId`; `loginCancel`; `logout`; `provider.status` (every read revalidates host-side).
- **`JbcentralStatus`** (protocol v43), nested on `ProviderStatusReport`—closed host-authored
  lifecycle: `absent`, `outdated`, `supported`, `configured`, `malformed-version`, `probe-failed`,
  `configuring`, `load-failed`.
  - **Flags, not states:** `signedOut` rides on `supported`/`configured`; `configured` also carries
    the closed `proxyStopped` observation—credentials, proxy process health, configuration are
    independent axes.
  - **Positively observed negative facts:** unavailable/unreadable probes report `false`—client
    never renders an unsubstantiated recovery demand. No proxy port, PID, URL, status text, or
    diagnostics cross—only parseable safe versions, closed probe/failure reasons, the current
    action.
  - **`configuring`** = reviewed CLI action or coalesced candidate rebuild for the newest watched
    artifact; **`configured`** = the current runtime for new work applied that artifact. Historical
    live sessions may retain an older runtime—deliberately outside this status.
  - **`load-failed.configured`** = whether the latest observed global state requested Central—client
    can offer the closed Retry/Disconnect actions without an artifact path.
  - **`JbcentralInstall`**—host's per-OS `{platform,shell,command}` official install plan.
  - **`JbcentralActionResult`**—closed `applied`/`failed` union; failure reasons: installation,
    version probe/support, Central action, artifact postcondition, runtime-load failure (no
    messages). No pending/restart/blocked-session/recovery/migration/compensation/reattachment
    outcomes. Structurally absent: raw stdout/stderr, extension content/paths, proxy URLs/secrets,
    diagnostics, affected-session ids, raw PI models; server+web map codes to own generic copy.
  - **Central methods:** `jbcentralConnect`/`jbcentralDisconnect`/`jbcentralStartProxy`/
    `jbcentralUpdate`/`jbcentralLogin`—native global actions→`JbcentralActionResult`; none accepts
    an executable, artifact path, output, URL, or secret from the client.

## Skills + trust wire

- **Trust fields on `Project`:** `trusted` (per-project grant), `acknowledgedSkills`
  (re-confirm-new—which committed aliases are OK'd), `disabledSkills`/`disabledGroups`
  (project-baseline per-skill/per-group off—a group = plugin, source tier, or the special
  `@plugins`); they gate what the project's skills contribute. A workspace layers
  `Workspace.skillOverrides` (per-skill on/off) over that baseline.
- **`project.setTrust`**—persist the grant→updated `Project`; gates the project's committed
  cross-agent skill aliases.
- **`skill.list`**—pre-session, skill-only `SlashCommandInfo[]` preview for a `projectId`, resolved
  from the project's current checkout with project-scoped aliases gated by trust; the eventual
  worktree session is authoritative.
- **Manager reads:** `skills.state` (`SkillCatalogEntry[]`—full catalog+per-skill `decision`+`group`
  —for a `workspaceId`); `project.skills` (same, project-scoped, pre-session manager).
- **Manager writes:** `project.aliasSkills` (present committed alias names—for the presence-gated
  notice's count), `project.acknowledgeSkills` (confirm post-trust arrivals),
  `project.setSkillEnabled` (project baseline), `project.setGroupEnabled` (plugin/source
  tier/`@plugins` at baseline), `workspace.setSkillOverride` (per-workspace on/off/clear→the
  `Workspace`).
- **`session.reloadResources`**—re-scan skills+rebuild the system prompt for one running session;
  rejected while streaming.
- **`workspace.watchReady`**—awaits the fresh watcher's conservative startup nudge before a
  skill-loading client captures its freshness baseline; `{ startupNudge }` = true unless
  already-known-ready, so a replayed response supplies the conservative fallback on lost
  push/failed startup. `prewarm: true` = prewarm-only watcher: kept in a globally bounded, evictable
  pool, promoted out by any real preflight/read (see server `watch` SPEC).

## TODO plan wire

- **Plan DTOs:** `TodoItem`/`TodoGroupItem`/`TodoPlan`/`TodoArtifact`+`TodoStatus`/`TodoOrigin`/
  `TodoArtifactKind` unions—the chat's per-session TODO list, mirrored from `pi-todos/core` (never
  imported).
- **`TodoGroupItem.status: TodoGroupStatus`**—group task lifecycle (`pending`/`active`/`done`),
  host-derived from the steps (`pi-todos`' `groupStatus`), never stored: one home for the truth
  table; no client re-derives it.
- **Commit artifacts** add `files?: GitFileChange[]` (path+status+`+/−`—the Changes panel's
  commit-scope rows), host-derived from git by `todo.list` decoration (same one-home rationale),
  never stored; absent = sha no longer resolves—degrade silently.
- **Summaries/verification:** `TodoItem.summary`/`TodoPlan.summary` = agent completion notes (per
  step/whole plan, as stored); `TodoItem.verification` = separate self-reported check line (exact
  command+result, or "not verified")—rendered as a badge labeled the agent's own claim, never a host
  gate.
- **`TodoItem.review?: TodoReviewInfo`** (+`TodoReviewState`)—host-derived review decoration, only
  on reviewable items (those with a host change set): `state`
  (`unreviewed`/`reviewed`/`changes_requested`; `unreviewed` = no stored record), `revision` (commit
  count—1 TODO = N commits), `unreviewedShas` (commits since the user's watermark—the "changed since
  review" delta), `feedback`+`at`. Review state lives in a host sidecar, never the agent-writable
  plan—[[submodule-server-todos]].
- **`TodoPlan.unattributed?: GitFileChange[]`**—host-derived remainder from the same `todo.list`
  decoration, only when non-empty: uncommitted worktree rows attributed to no plan item—otherwise
  invisible in the review map (derivation+rationale: [[submodule-server-todos]]).
- **Methods (`todo.*`):** `todo.list`/`add`/`update`/`remove` (keyed `workspaceId`+`sessionId`;
  `add` tags `origin:"user"`).
- **Review ops:** `review` (approve: record `reviewed`+sha watermark), `requestFix` (record
  `changes_requested`+feedback, then host fires the fix package into the item's own chat—detached,
  rolled back on pre-turn rejection), `startReview` (AGENT review: plan's pinned reviewer chat gets
  its package; findings as `author: "agent"` comments; verdict via the reviewer-only
  `review_verdict` tool; `TodoItem.review` carries `reviewing` while pending, `reviewedBy` on agent
  approve).

## Review wire

- **`Review`**—one open review per workspace; `baseSha` = reviewed diff's ORIGINAL side (branch
  range's fork point, what the diff displays—never the target's tip, which can carry upstream
  commits the review never showed), pinned to a full commit oid at creation, immutable for life.
- **`fileSessions`**—key→that key's review chat: one chat per file, pinned on first send; the empty
  key = anchorless whole-change-set bucket, pinned likewise—a second overall remark continues one
  discussion. **`doneFiles`** (same keys)—user-finished files; a fully-resolved file leaves the list
  only on their say-so.
- **`ReviewComment`**—`kind` inline/diff/file/review; `status` draft/sent/resolved/dismissed,
  orthogonal to `anchorState` anchored/moved/outdated; per-comment `sessionId` = the chat it was
  sent into.
- **`ReviewAnchor`**—`path`+`side`+`contentHash`+ordered `ReviewSelector` fallback chain
  (`lineRange`/`textQuote`/`diffHunk`/`structural`—last two are forward slots V1 authors don't
  populate); a `side: "base"` anchor adds `baseRef` (the ref its lines/fragment were captured
  against—two diff sides = two line spaces)+the `scope` captured in (diff identity reopening the one
  surface rendering that blob).
- **`ReviewSnapshot`** (`{ review, comments }`)—the `review.get` read and (with `workspaceId`) the
  `review.changed` push payload `ReviewChangedPayload`—full-snapshot, replay idempotent.
- **Methods (`review.*`):** `review.get`—open review+comments, lazily created, re-anchored on
  read.
  `commentAdd`/`commentUpdate`/`commentDelete`—authoring+manual resolve/dismiss; delete DRAFT-only
  (sent = record, resolved = final: no reopen, no worktree rollback); `commentAdd` takes the diff
  tab's `scope`—host resolves+persists a base-side anchor's `baseRef`. `fileDone`—mark a
  fully-resolved file finished (rejected while anything unresolved; a new comment re-opens).
  `close`—atomic Clear: archive non-draft records, discard drafts, replace active review, publish
  fresh open snapshot to all clients.
- **Sends:** `sendComment`—one comment→its FILE's review chat, created on the file's first send,
  then `followUp`ed. `sendBatch`—all/selected drafts grouped per key into each key's chat; answers
  with EVERY touched session, in group order—naming only the first left other chats invisible while
  their comments already read as sent.
- **`ReviewSendResult`** (both sends) = `session.create`'s shape+`reused`—knowable only host-side
  (followed up into, or created now?). A reused chat may be unseen by this client (a second client,
  or post-reload—review state+pi transcripts outlive the host), so HYDRATE, never open as new:
  opening as new shows a blank conversation for comments already marked sent.

## Specs + history wire

- **`SpecGraphNode`/`SpecGraphSnapshot`**—Specs-viewer read DTOs, mirrored (like `PiEvent`), never
  imported from `pi-spec-graph`; wire carries only what the panel renders (`type`/`status` stay
  `string`: tolerate whatever is on disk). `spec.graph` = whole-graph read, per workspace.
- **History DTOs:** `HistoryScope` (overlay's cycle: this chat→workspace→project→everywhere);
  `PromptHit` (recalled prompt; optional `messageIndex`+`anchorText`—the kept-newest occurrence's
  jump anchor); `MessageHit` (full-text match, assistant-only—a user-role hit only duplicates its
  own `PromptHit`'s text, so the jump affordance lives there; `messageIndex` anchors
  jump-to-message into `session.getMessages` order; `anchorText` makes the anchor drift-tolerant);
  `HistorySearchResult` (prompts+messages sections, totals, indexing status).
- **`history.search`**—prompt-recall+conversation-search read; results capped, recency-ordered
  (assistant-only rationale above).

## Templates

- **DTOs:** `TemplateScope` (`"global"`|`"project"`—where a template lives); `TemplateInfo`
  (metadata only: name, optional `description`/`argumentHint`, `scope`, `filePath`—what
  `template.list` returns; deliberately body-free—a listing never ships every file's full text);
  `Template` (`TemplateInfo`+full `content`—frontmatter+body—the by-name
  `template.get`/`template.save` shape).
- **Methods (`template.*`):** `template.list`, `template.get` (`scope` optional, project wins
  over global), `template.save`, `template.delete`—all read/write pi's prompt dirs
  (global+project), so templates stay CLI-portable.

## Layout + config

- **`ThemeId`**—open string on the wire: host persists an opaque selection; the independently
  shipped web client owns the manifest catalog. Contracts deliberately exports no theme
  enum/list/labels—a future manifest can mint an id unknown at host build time; missing ids resolve
  to the client's bundled default.
- **`ComposerGrowthLimit`** (`"compact" | "roomy" | "half-chat"`)—closed, server-synced composer
  height: 6 visual lines / 10 visual lines / 50% of the mounted chat panel; `"half-chat"` default;
  web owns translating semantic ids into geometry.
- **`AppConfig`** (`{ theme, analyticsEnabled, terminalReplayKb, composerGrowthLimit,
  customLayoutPresets, reviewModel?, reviewEffort?, reviewAutoFix }`)—extensible bag, carried with
  the `DEFAULT_CONFIG` fallback: persisted host-side as `config.json`, delivered in
  `server.welcome`, mutated via `settings.update`.
- **`customLayoutPresets`**—bounded resource-free catalog, the ONLY layout value host-synchronized;
  current/default preset and group limits are web-local.
- **`analyticsEnabled`** (default `true`)—anonymous usage-analytics switch, the ONLY analytics fact
  on the wire; the installation id stays server-side by design (see `submodule-server-analytics`).
- **`InterviewResponse`**—closed `"book" | "postpone" | "never"` action accepted from the automatic
  feedback popup; no usage count, eligibility, dismissal state, or client identity crosses the wire.
- **`LayoutPreset`**—portable bounded resource-free frame grammar in `AppConfig.customLayoutPresets`:
  center topology, left/right/bottom group geometry, visibility/folds, bottom alignment, singleton
  tools—no workspace, file, diff, chat, document, terminal, preview, attention, or
  current/default-selection identity. Every current-layout type (incl. projected
  `WorkspaceLayoutDocument`, `WorkbenchFrame`, `WorkspaceViewState`) is web-local, deliberately
  absent from contracts; no current-layout method or push channel exists.

## WS methods

- **`project.*`:** `project.close` (the `closed: true` write above), `project.inspect` (classify a
  path), `project.init` (`git init`+commit, then open), `project.hasSpecs` (lazy "contains a
  registered spec?" for Welcome—full-tree walk only for the shown project, never eager).
- **`workspace.*` — `workspace.list { projectId, includeDiffStats? }`**—omitted/true = full
  rows+computed aggregates; `false` = same authoritative membership/order without the synchronous
  per-workspace diff-stat fan-out navigation restoration never uses.
- **`workspace.listExisting`**—selected project's unattached Git worktrees (rows per
  `ExistingWorktreeCandidate`). **`workspace.openExisting`**—revalidate+register one branch-backed
  checkout as `kind: "external"`; emits ordinary `workspace.created`; no Git/disk mutation.
- **`workspace.rename`** (`{ id, name }`→locked updated `Workspace`)—managed worktrees only;
  display name, Git branch+cwd preserved; broadcasts ordinary `workspace.updated`.
  `WORKSPACE_RENAME_PROTOCOL_VERSION` pins v55—a newer client omits the action against an older
  host.
- **`workspace.openReview`**—active branch's optional `OpenBranchReview`; `allowCached: true`
  permits a settled host cache hit, omission keeps original force-fresh for older independently
  shipped clients; either form joins an in-flight lookup.
- **`workspace.setDiffBase`**—re-point the diff target (`null` = back to creation base); echoes
  updated `Workspace` AND broadcasts `workspace.updated`—clients converge on the push.
- **`fs.*` + `git.*`: `git.status`/`git.diffFile`** take optional `scope: GitDiffScope`; an
  unresolvable scope
  (a commit a rebase removed) is rejected—the panel reads it as "reset the scope", not wedged on a
  dead sha.
- **`git.listCommits`**—branch's own commits `<diff base>..HEAD`, newest first, host-capped; the
  scope menu's lazy list.
- **`git.prefetch`**—best-effort remote-base fetch (New-Workspace dialog warm-up); always acks
  `{ ok }`; when the fetch moved the local remote-tracking ref, pathless `workspace.fsChanged`
  follows to workspaces whose diff base it is—git-derived reads re-converge.
- **`terminal.*`:** `reserve`—idempotent host-catalog tab, no PTY started; `INITIAL_TERMINAL_TAB_KEY`
  = the one host-seeded tab any frontend may place passively. `attach`—idempotent get-or-create
  keyed `(workspaceId, tabKey)`→`created`+`replay` to repaint; the only PTY birth; replaced
  `create`+`alive`. `list` (host owns tabs), `write`, `resize`, `close` (by `tabKey`; refuses busy
  shell unless `force`).
- **`model.*`:** `model.refresh` awaits the host's single-flighted catalog
  refresh→`RefreshedModels` = post-refresh list+`complete` (whether the pass settled within the
  host's capped wait—only a settled list is authoritative); `force` bypasses pi's 4h freshness
  throttle, so user refresh actually fetches. `model.clampThinking` = pi's `clampThinkingLevel` for
  `{model, level}`—pre-session picker's effort adjustment, no client re-derives pi's policy.
- **`session.*`**—`create`/`prompt`/`steer`/`followUp`/`dispose`/`delete`/`setModel`/
  `setThinkingLevel`/`compact`/`getStats`/`getCommands`/`extUiReply`/`list`/`getMessages` (the read
  side), `answerQuestion` (see ask wire), plus:
  - **`clearQueue`**—drains Pi's steering+followUp queues→complete `SessionQueueContent`; Pi emits
    the emptying `queue_update` itself; `requireTextOnly` rejects without draining when host
    observed queued images (manual-compaction precondition).
  - **`removeQueued`** (`{ kind, index }`→`RemovedQueuedMessage`)—drop/extract ONE queued message
    with complete content (strip rows' edit/remove); position-addressed since Pi queue entries are
    bare strings without ids; host emulates per-item removal over Pi's all-or-nothing `clearQueue`
    (see server agent SPEC).
  - **`abort`**—ordinary abort preserves queued lanes for Interrupt; `{ restoreQueue: true }`
    atomically drains complete content before signalling abort, returns it once idle—Stop's lossless
    path.
- **`settings.update`**—merge+validate+persist a top-level partial `AppConfig`;
  `customLayoutPresets` (when present) = one complete bounded catalog replacement; returns merged
  config.
- **`feedback.respond`** (`{ action: InterviewResponse }`→ack)—persists the automatic invitation's
  book/postpone/permanent-dismiss; the Settings link never calls it.
  `FEEDBACK_INTERVIEW_PROTOCOL_VERSION` pins the addressed channel's v56 introduction—host never
  claims an older independently shipped client lacking the `?protocol=` capability.

## WS channels

- **`server.welcome`**—initial `config: AppConfig`+`projects` (open records)+`recentProjects` (all
  known, open+closed)+`hostPlatform` (`darwin | linux | win32`, optional for older hosts): the
  host's OS, so clients offering host-executed commands (the PR setup dialog) pick correctly, not
  browser-guessed.
- **`project.updated`**—full persisted `Project` snapshot after open/reopen/close (incl. `closed`);
  every client atomically converges rail+Recents, no optimistic removal.
- **`pi.event` / `pi.extensionUi`**—agent event stream+extension-UI channel (see pi mirrors).
- **`session.created`**—initial `SessionSummary`, broadcast when a host-owned session registers;
  other frontends list it in history without local placement. **`session.deleted`**—workspace+session
  id; non-replayable, post permanent deletion; clients remove the chat, stale hydration blocked.
- **`settings.changed`**—full `AppConfig` (incl. custom preset definitions), broadcast convergence.
- **`feedback.interview`**—empty, addressed invitation, host-claimed frontend only; never broadcast,
  subscribed, or replayed.
- **`provider.login`**—session-less in-app login stream (`LoginPush` per frame, keyed `loginId`);
  `pi.extensionUi` sibling—a login runs on Welcome pre-session.
- **`provider.changed`**—data-free invalidation after watched Central state/rebuild changes
  host-authoritative provider status or model generation; clients re-read `provider.status`,
  invalidate `model.list`—no raw provider/model data rides the push.
- **Terminal (addressed):** `terminal.data`+`terminal.exit`+`terminal.detached`→the single attached
  client, never broadcast—a shell's bytes never reach another browser; `terminal.data` may carry
  `truncated` (host dropped held output); `terminal.detached` = another client took the tab over.
- **Workspace trio:** `workspace.created`/`workspace.updated`/`workspace.removed`—registry
  membership fanned out to all clients as shared domain state (architecture #9), all from server's
  `workspaces` publisher (never per-client optimistic mutation). `created`/`updated` carry the full
  persisted `Workspace` snapshot (idempotent under last-value replay—the auto-rename's
  naive-then-agentic pair merges by `id`; never a delta); `removed` carries `WorkspaceRemoved`
  (`{ projectId, id }`—record already gone).
- **`review.changed`**—workspace review state changed; server's `reviews` publisher emits on every
  mutation (UI edits, agent `resolve_comment` calls, re-anchoring); clients converge—same pattern as
  the trio.
- **`workspace.fsChanged`**—change-notifier push (`WorkspaceFsChangedPayload`: `{ workspaceId,
  paths, truncated, skillChange }`): worktree-relative deduped paths, capped; `truncated` = path
  list incomplete—treat as wildcard. Invalidation nudge, not data: clients re-read via existing
  reads; duplicates/replays harmless.
- **`skillChange: "none" | "detected" | "unknown"`**—independent semantic fact, accumulated before
  the cap: non-skill overflow stays `none`; skill path omitted post-cap stays `detected`; only
  pathless platform/startup uncertainty is `unknown`. Pathless non-truncated/`none` frame =
  whole-workspace invalidation (e.g. repo-metadata drift).

## Request idempotency

- **Typed maps:** `WsMethodMap` request/result map+`WsParams`/`WsResult` helpers, `PROTOCOL_VERSION`.
- **Request ids double as the reconnect idempotency key:** unresolved clients replay the same
  frame/id; host returns the one cached result for `(clientKey, requestId)` instead of re-executing
  the handler.
- **`WsClientMessage`** (key-discriminated) adds two non-request frames: **`WsAck`** (`{ ack:
  string[] }`)—responses the client has read; the only signal distinguishing a page-received reply
  from a socket-buffer-dead one, hence the only way host frees a retained result. **`WsResume`**
  (`{ resume: string[] }`)—sent on every (re)connect ahead of replays; the complete set the page
  still considers unresolved, so host releases everything else.
- **Why resume exists:** a receipt is only as reliable as the socket carrying it—nothing would
  re-send a lost one; restating the live set beats confirming the confirmations. Protocol-versioned:
  a replaying UI must never run against a pre-dedup host.

## Get right

- **`spec-budget: 4500` (frontmatter)**—the wire's single source of truth is the corpus' most
  decision-dense spec and grows with every protocol change; one genuine boundary stays one document
  rather than splitting to fit 3,000.
- **Mirrors are not version-pinned in comments.** A Node-only-home shape re-declared here carries
  WHAT it mirrors, never which pi version it was last checked against—those markers needed
  hand-edits across several files on every bump, verified by nothing. Re-audit a mirror when a
  bump's changelog touches it, not because a comment names a version. Model the UI-relevant
  (especially host-enriched `agent_settled`); UI-irrelevant session events such as `entry_appended`
  may stay unmodelled, ignored.
- **Type-only, from the package roots, always**—type-only imports are erased by
  `verbatimModuleSyntax`, so the web bundle stays provider-free; pi-ai provider/API subpaths
  statically import the Node SDKs (never touch). The `/base` entries existed only in 0.79.8–0.79.9.
- **`Model` is generic**—expose it as `Model<any>`.
- **`AssistantMessageEvent`** (the streaming deltas) nests under
  `message_update.assistantMessageEvent`, never a top-level event `type`.
- **Extensionless internal imports** (`./domain`, not `./domain.ts`)—`composite` emits declarations,
  incompatible with `allowImportingTsExtensions`.
- **Bundle gate:** `bun build` the web app and confirm NO `@anthropic-ai/sdk` / `openai` /
  `node:fs` appears.

## Consumed by

`web` (types+WS constants) and `server` (same, +mapping `session.*` to `AgentSession` methods).
Shell panels need `domain`+`wsProtocol`; `pi` types+`PiEvent` are the wire for the agent session.
