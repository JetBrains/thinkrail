# Chat UI Rendering — Sub-Specification

> Parent: [CENTER_PANEL.md](CENTER_PANEL.md) | Status: **Active** | Created: 2026-02-27 | Updated: 2026-03-05

## Overview

The Chat UI is the center panel's primary content area. It renders a scrolling stream of visual elements derived from JSON-RPC agent event notifications. Each event type maps to a distinct React component with specific rendering rules, interaction behaviors, and state transitions.

This spec reflects the **actual implemented code** as of 2026-03-05. Items not yet implemented are marked **[Planned]**.

---

## Component Hierarchy

```
<SessionPanel>                         // manages sessions + file tabs; one instance in center panel
  <SessionTabBar>                      // unified tab bar: session tabs + file tabs + preview tab
  // Content area — one of the following three:
  <FileViewer />                       // when a file or preview tab is active
  <>
    <ChatStream>                       // scrollable event list (flex column, overflow-y auto)
      // Rendered per-event:
      <SystemMessage />                // sessionStart, notification, turnComplete, interrupted
      <div.chat-user>                  // userMessage (inline, not a named component)
        <div.chat-user-text />
      </div>
      <AssistantMessage />             // textDelta
      <ToolCallCard />                 // toolCallStart (paired with toolCallEnd state)
      <SubagentBlock />                // subagentStart (finished derived from subagentEnd)
      <QuestionCard />                 // askUserQuestion
      <ApprovalCard />                 // confirmAction
      <CompletionBanner />             // done
      <ErrorBanner />                  // error
      <CompactMarker />                // compact
      <div.chat-banner.chat-banner-warn />  // permissionDenied (inline, no named component)
      // turnComplete: AssistantMessage (if result) + SystemMessage
      // toolCallEnd, subagentEnd: return null (handled by pairing logic)
      // progress: return null (no visible element)
      <button.chat-jump-btn />         // sticky "Jump to bottom" button (conditional)
    </ChatStream>
    <SessionStatusLine />              // model selector, permission mode selector, cost, tool calls, context bar, status indicator
    <InputArea />                      // textarea + skill autocomplete + send button
    // OR instead of InputArea:
    <RestoredBar />                    // for restored (read-only) sessions
  </>
  <div.center-placeholder />          // when no sessions/files open, or no active tab
```

**Key structural notes:**
- `SessionPanel` is **not** structured as `SessionHeader + ChatStream + StatusLine + InputArea` as previously specced. There is **no `<SessionHeader>`** component.
- The `<SessionTabBar>` handles both session tabs and file/preview tabs in a single unified bar.
- When no sessions and no files are open, `SessionPanel` renders `<div className="center-placeholder">Select a session or create a new one (Cmd+T)</div>`.
- When sessions/files exist but no active tab matches, it renders `<div className="center-placeholder">Select a tab</div>`.

---

## Sub-Components and Their Actual Props

### `<ChatStream>`

```typescript
interface ChatStreamProps {
  events: AgentEvent[];
  answeredRequests: Map<string, unknown>;
  onResolveRequest: (requestId: string, response: unknown) => void;
}
```

- Root element: `<div className="chat-stream">` with `ref={scrollRef}` and `onScroll={handleScroll}`
- Iterates `events` with `Array.map`, keyed `${index}-${eventType}`
- Maintains `autoScroll` ref (boolean, default `true`) — not React state, so no re-render on change
- Pauses auto-scroll when `distFromBottom >= 50px`
- Resumes and jumps to bottom on "Jump to bottom" button click (smooth scroll)
- **"Jump to bottom" button:** Rendered only when `!autoScroll.current`. Uses `position: sticky; bottom: var(--space-sm)` — **not** a floating overlay.

**Event rendering dispatch table:**

| `eventType` | Rendered Element |
|---|---|
| `sessionStart` | `<SystemMessage variant="ok" text="Session started — {model}">` |
| `userMessage` | `<div.chat-user><div.chat-user-text>{text}</div></div>` |
| `textDelta` | `<AssistantMessage text={text} streaming={streaming}>` |
| `toolCallStart` | `<ToolCallCard>` (state derived from paired `toolCallEnd`) |
| `toolCallEnd` | `null` (data consumed by `toolCallStart` pre-pass) |
| `subagentStart` | `<SubagentBlock>` (finished derived from pre-pass; children=`null`) |
| `subagentEnd` | `null` |
| `askUserQuestion` | `<QuestionCard>` |
| `confirmAction` | `<ApprovalCard>` |
| `turnComplete` | Optional `<AssistantMessage>` (if `result`) + `<SystemMessage variant="ok">` showing cost and turns |
| `interrupted` | `<SystemMessage text="Turn interrupted">` (default variant, i.e. `--hint` color) |
| `done` | `<CompletionBanner>` |
| `error` | `<ErrorBanner>` |
| `notification` | `<SystemMessage text={message}>` (default variant) |
| `compact` | `<CompactMarker>` |
| `permissionDenied` | `<div className="chat-banner chat-banner-warn">Permission denied: {toolName}</div>` (no named component) |
| `progress` | `null` (no visible element rendered) |
| anything else | `null` |

**Pre-pass computations** (done before rendering):
1. `toolStates` Map: iterates all events to collect `toolCallEnd` payloads keyed by `toolUseId`
2. `activeSubagents` Set: iterates all events, adds on `subagentStart`, deletes on `subagentEnd`

---

### `<SystemMessage>`

```typescript
interface SystemMessageProps {
  text: string;
  variant?: "info" | "ok";  // default: "info"
}
```

- Root: `<div className="chat-system [chat-system-ok?]">`
- `variant="info"` (default): class `chat-system` only → `color: var(--hint)`, italic, 12px, centered
- `variant="ok"`: adds `chat-system-ok` → `color: var(--green)`
- Renders plain `{text}` — no markdown, no icon

**Used for:** `sessionStart` (ok variant), `notification` (info variant), `turnComplete` (ok variant), `interrupted` (info variant)

---

### `<AssistantMessage>`

```typescript
interface AssistantMessageProps {
  text: string;
  streaming?: boolean;
}
```

- Root: `<div className="chat-assistant">` — `max-width: 90%`, `slideUp` entrance animation
- Inner: `<pre className="chat-assistant-text">` — renders text as **plain pre-formatted text** (NOT markdown)
- When `streaming=true`: renders `<span className="chat-cursor" />` — 7×14px block cursor, `blink` animation (1s step-end)
- **No markdown rendering is implemented.** **[Planned]**
- Each `textDelta` event renders its own `<AssistantMessage>`. They are **not concatenated** — each event index gets its own component with no merge logic.
- No author label ("Claude") is rendered. **[Planned]**

---

### User Message (inline, no named component)

- Rendered directly in `ChatStream`'s switch as `<div className="chat-user"><div className="chat-user-text">{text}</div></div>`
- Right-aligned (`justify-content: flex-end`), max-width 85%
- Background: `var(--elevated)`, border: `1px solid var(--border)`, border-radius: `10px 10px 2px 10px`
- Color: `var(--text)`, `white-space: pre-wrap`
- Entrance animation: `slideUp 0.22s ease-out`
- No author label ("You") rendered. **[Planned]**

---

### `<ToolCallCard>`

```typescript
interface ToolCallCardProps {
  toolName: string;
  toolInput?: string;
  output?: string;
  isError?: boolean;
  state: "running" | "success" | "error";
}
```

- Root: `<div className="chat-tool">` with inline `borderLeftColor`
- Max-width 90%, `background: var(--elevated)`, `slideUp` entrance animation

**States:**

| `state` | `isError` | Border color | Status icon | Status text | Initial `expanded` |
|---|---|---|---|---|---|
| `running` | — | `var(--blue)` | `●` | `running...` | `false` |
| `success` | `false` | `var(--green)` | `✓` | `done` | `false` |
| `error` | `true` | `var(--red)` | `✕` | `error` | `true` |

**Header** (`.chat-tool-header`, always visible, clickable when not running):
- `.chat-tool-icon`: emoji from `TOOL_ICONS` lookup
- `.chat-tool-name`: `toolName`, `color: var(--cyan)`, `font-weight: 600`
- `.chat-tool-input`: `toolInput` if provided, `color: var(--muted)`, 11px, truncated with `text-overflow: ellipsis`, max-width 300px
- `.chat-tool-status`: status icon + text, colored with `borderColor`, `margin-left: auto`

**Body** (`.chat-tool-body`, toggle on header click):
- Only rendered when `expanded && output`
- `<pre>` containing the raw output string, 11px, `white-space: pre-wrap`, `color: var(--muted)`
- `max-height: 120px`, `overflow-y: auto`
- Header click does nothing when `state === "running"`

**Input extraction** (in `ChatStream`, before passing to `ToolCallCard`):
- if toolInput is a string → use as-is
- if toolInput is an object → use first object value as string
- otherwise → empty string ""

**Tool icon map:**

| Tool Name | Icon |
|---|---|
| `Read` | 📖 |
| `Write` | ✏️ |
| `Edit` | ✏️ |
| `Bash` | ▶ |
| `Grep` | 🔍 |
| `Glob` | 📂 |
| `Agent` | ⚡ |
| `WebSearch` | 🌐 |
| `WebFetch` | 🌐 |
| `NotebookEdit` | 📓 |
| Other | 🔧 |

**`parentToolUseId` nesting:** NOT implemented. Subagent tool calls are rendered at the flat event stream level regardless of `parentToolUseId`. **[Planned]**

---

### `<SubagentBlock>`

```typescript
interface SubagentBlockProps {
  agentType?: string;
  finished: boolean;
  children: ReactNode;
}
```

- Root: `<div className="chat-subagent">` — `margin-left: 12px`, `padding-left: 12px`, `border-left: 2px solid var(--border2)`
- Header (`.chat-subagent-header`): `color: var(--muted)`, 12px
  - Icon: `✓` when `finished`, `⚡` when running
  - Text: `Subagent: {agentType ?? "agent"}`
  - When not finished: `<span className="chat-spinner" />` (10px CSS spinner, `border-top-color: var(--blue)`)
- Body (`.chat-subagent-body`): renders `{children}`
- In practice, `children` is always `null` as called from `ChatStream`. Child tool call nesting **is not implemented**. **[Planned]**

---

### `<QuestionCard>`

```typescript
interface QuestionCardProps {
  questions: Question[];
  answered: boolean;
  selectedAnswers?: Record<string, string>;
  onSubmit: (response: Record<string, unknown>) => void;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}
interface QuestionOption {
  label: string;
  description: string;
}
```

- Root: `<div className="chat-question [chat-question-answered?]">` — `border: 2px solid var(--purple)`, `max-width: 90%`, `background: var(--elevated)`, `slideUp`
- When `answered`: `opacity: 0.7`
- Renders each question in a `.chat-question-group`:
  - `.chat-question-header`: `q.header`, 9px uppercase purple label
  - `.chat-question-text`: `q.question`, 12px bold
  - Options present: `.chat-question-options` list of `.chat-option` buttons
  - No options + not answered: `<textarea className="chat-question-textarea">` (free-text mode, `autoFocus`)
  - No options + answered: `<div className="chat-question-answer">` showing the text response

**Option button** (`.chat-option`):
- Radio icon (`.chat-option-radio`): `●`/`○` for single-select, `☑`/`☐` for multi-select
- `.chat-option-label`: option label, 12px, font-weight 500
- `.chat-option-desc`: option description, 11px, `var(--muted)`
- Selected: class `chat-option-selected` → `border-color: var(--purple)`, `background: rgba(187,154,247,0.1)`
- Disabled when `answered`

**Submission:**
- If free-text question: sends `{ text: textInput, answers: selections }`
- Otherwise: sends `{ questions, answers: { [questionText]: selectedLabel } }`
- `Cmd/Ctrl+Enter` submits from the free-text textarea

**Actions row** (`.chat-question-actions`, hidden when `answered`):
- Single button: `.chat-btn.chat-btn-primary` labeled "Send"
- Disabled when free-text mode and text is empty

---

### `<ApprovalCard>`

```typescript
interface ApprovalCardProps {
  toolName: string;
  toolInput?: unknown;
  description?: string;
  answered: boolean;
  decision?: "approve" | "deny";
  onApprove: () => void;
  onDeny: () => void;
}
```

- Root: `<div className="chat-approval [chat-approval-answered?]">` — `border: 2px solid var(--gold)`, `max-width: 90%`, `background: var(--elevated)`, `slideUp`
- When `answered`: `opacity: 0.7`
- `.chat-approval-title`: "Action requires approval", `color: var(--gold)`, 12px bold
- `.chat-approval-tool`: tool name (`.chat-tool-name` class → `var(--cyan)`) + formatted input (`.chat-approval-input`)
- `.chat-approval-desc`: optional description, 11px, `var(--muted)`

**`formatToolInput()` logic:**
- string → use as-is
- object with `.command` → show command string
- object with `.file_path` → show file_path string
- object with `.path` → show path string
- object with `.pattern` → show pattern string
- other object → `JSON.stringify(input, null, 2)`

**When not answered** (`.chat-approval-actions`):
- `.chat-btn.chat-btn-approve` ("Approve") → green background, calls `onApprove`
- `.chat-btn.chat-btn-deny` ("Deny") → red outline, calls `onDeny`

**When answered** (`.chat-approval-result`):
- `decision === "approve"`: `✓ Approved` in `var(--green)`
- `decision === "deny"`: `✕ Denied` in `var(--red)`

**Response sent to backend on approve:** `{ "behavior": "allow" }`
**Response sent to backend on deny:** `{ "behavior": "deny", "message": "User denied", "interrupt": false }`

---

### `<CompletionBanner>`

```typescript
interface CompletionBannerProps {
  result?: string;
  costUsd?: number;
  turns?: number;
  durationMs?: number;
}
```

- Root: `<div className="chat-banner chat-banner-done">` — `background: rgba(158,206,106,0.1)`, `border: 1px solid var(--green)`, `color: var(--green)`
- `.chat-banner-title`: `✓ Session complete`
- `.chat-banner-metrics`: flex row with optional `$X.XX` / `N turns` / duration string
  - Duration format: `< 60s → "X.Xs"`, `≥ 60s → "Xm Xs"`
- `.chat-banner-result`: optional result text, `color: var(--muted)`

---

### `<ErrorBanner>`

```typescript
interface ErrorBannerProps {
  errors?: string[];
  subtype?: string;
}
```

- Root: `<div className="chat-banner chat-banner-error">` — `background: rgba(247,118,142,0.1)`, `border: 1px solid var(--red)`, `color: var(--red)`
- `.chat-banner-title`: `✕ Session error[: {subtype}]`
- `.chat-banner-errors`: `<ul>` of all error strings (all shown, not just first)

**Recoverable vs terminal errors (store logic, not rendering):**
- `subtype === "turn_error"` → session status goes back to `"idle"` (recoverable)
- Other subtypes → session status set to `"error"` (terminal)

---

### `<CompactMarker>`

```typescript
interface CompactMarkerProps {
  preTokens?: number;
}
```

- Root: `<div className="chat-compact">` — flex row, 10px, `color: var(--hint)`
- Two `.chat-compact-line` spans (flex: 1, `border-top: 1px dashed var(--border)`)
- Center label `.chat-compact-label`: `"Context compacted"` or `"Context compacted — {N}k tokens"` (rounds to nearest 1k)

---

### Permission Denied (inline, no named component)

```html
<div className="chat-banner chat-banner-warn">
  Permission denied: {toolName}
</div>
```
- Uses `.chat-banner-warn` (gold tint) — no title/tool-input breakdown beyond the tool name

---

### `<SessionStatusLine>`

```typescript
interface SessionStatusLineProps {
  model: string;
  permissionMode: string;
  metrics: SessionMetrics;
  status: SessionStatus;
  disabled?: boolean;
  onChangeModel?: (model: string) => void;
  onChangePermissionMode?: (mode: string) => void;
}
```

Root: `<div className="session-status-line">` — flex row, 11px, `color: var(--hint)`, `border-top: 1px solid var(--border)`

**Segments (left to right):**

1. **Model selector** (`.ssl-selector` with dropdown)
   - Button (`.ssl-selector-btn`): displays short model label
   - When `disabled`: adds `.ssl-selector-disabled`
   - Dropdown (`.ssl-dropdown`): opens upward (`bottom: 100%`), lists all available models
   - Active model: `.ssl-dropdown-active` → `color: var(--blue)`
   - Click outside closes via `mousedown` listener

2. **Separator** (`.ssl-sep`: 1px × 12px `var(--border)`)

3. **Permission mode selector** (`.ssl-selector` with dropdown)
   - Displays short labels: `default` / `accept edits` / `yolo` / `plan`
   - Full values: `default` / `acceptEdits` / `bypassPermissions` / `plan`

4. **Separator**

5. **Cost** (`.ssl-cost`): `$X.XX` from `metrics.costUsd`

6. **Separator**

7. **Tool calls** (`.ssl-tools`): `[ssl-pulse?] {toolCalls} calls`
   - `.ssl-pulse`: 6px green dot with `pulse` animation — shown only when `status === "running"`

8. **Context bar** (conditional — only when `metrics.contextMax > 0`):
   - **Separator**
   - `.ssl-context`: text `ctx {N}k/{M}k`
   - `.ssl-context-bar`: 60px × 6px bar, uses CSS vars `--pct` and `--bar-color`
   - Color thresholds: `> 80%` → `var(--red)`, `> 50%` → `var(--gold)`, else → `var(--green)`

9. **Separator**

10. **Status indicator** (`.ssl-status.ssl-status-{class}`):

| `status` | CSS class | Elements | Color |
|---|---|---|---|
| `"running"` | `ssl-status-running` | `.ssl-status-spinner` (CSS spin) + `" running"` | `var(--blue)` |
| `"idle"`, `"interrupted"` | `ssl-status-waiting` | `⏳ waiting` | `var(--hint)` |
| `"done"`, `"error"` | `ssl-status-ended` | `⏹ ended` | `var(--muted)` |

**Disabled state:** Both dropdowns get `disabled` attribute and `.ssl-selector-disabled` class. Set to `true` when `session.restored || isDone`.

**Data sources:**
- Model and permissionMode come from `session.model` and `session.permissionMode` — updated via `agent/configChanged` RPC notification
- `metrics` comes from `SessionMetrics` — updated in store on `toolCallEnd`, `turnComplete`, `done`
- Context (`contextTokens`, `contextMax`) must be set externally — there is **no automatic update from `agent/compact`** in the current store. `contextMax` defaults to 0, so the context bar is hidden until set. **[Planned]**

---

### `<InputArea>`

```typescript
interface InputAreaProps {
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
}
```

Root: `<div className="input-area">` with `style={{ position: "relative" }}`

**Skill autocomplete:**
- Triggered when text starts with `/`
- Filters `SKILLS` array by `id.includes(query)` (case-insensitive)
- Dropdown (`.input-autocomplete`): appears above input (`bottom: 100%`), max-height 240px
- Each item (`.input-autocomplete-item`): icon + `/{skill.id}` (cyan) + description (hint, 11px)
- Keyboard: ArrowUp/ArrowDown to move, Tab/Enter to insert, Escape to dismiss
- Active item: `.input-autocomplete-active`
- On select: inserts `/{id} ` into textarea and focuses
- `onMouseDown` (not `onClick`) used on items to prevent textarea blur

**Textarea** (`.input-textarea`):
- `rows={1}`, auto-height up to `max-height: 150px`
- `resize: none`, `border: 1px solid var(--border)`, `background: var(--elevated)`
- Focus: `border-color: var(--blue)`
- Disabled: `opacity: 0.5; cursor: not-allowed`
- `Cmd/Ctrl+Enter` sends; plain `Enter` adds a newline

**Send button** (`.input-send`):
- Background: `var(--blue)`, label "Send"
- Disabled when `disabled || !text.trim()`

**Placeholder states** (computed in `SessionPanel`):

| Condition | Placeholder text |
|---|---|
| `pendingRequest.type === "approval"` | `"Waiting for your approval above..."` |
| `pendingRequest.type === "question"` | `"Answer the question above or type a response..."` |
| `status === "done"` | `"Session complete"` |
| `status === "error"` | `"Session ended with error"` |
| `status === "running"` | `"Agent is working..."` |
| `status === "idle"` (default) | `"Message Claude..."` |

**`disabled` computation** (in `SessionPanel`):
```typescript
isDone = status === "done" || status === "error"
isRunning = status === "running"
hasPending = pendingRequest != null
inputDisabled = isDone || isRunning || (hasPending && pendingRequest.type === "approval")
```
- Input is **enabled** when waiting for a question (user can type a custom answer)

**Send behavior from `SessionPanel`:**
- If `pendingRequest.type === "question"`: calls `resolveRequest(taskId, requestId, { text })`
- If `status === "idle"`: calls `sendMessage(taskId, text)` (sends new turn message)
- User message is added **optimistically** to events before API response, and status immediately set to `"running"`

---

### `<RestoredBar>`

Shown instead of `<InputArea>` when `session.restored === true`.

- Root: `<div className="restored-bar">` — flex row, `border-top: 1px solid var(--border)`, `background: var(--panel)`
- `.restored-bar-text`: `"This is a restored session (read-only)"`, italic, 12px, `var(--hint)`
- `.restored-bar-btn`: "Resume Session" button — calls `api.continue(taskId)`, creates a new session tab carrying over the old session's events and name (with `" (resumed)"` suffix)

---

### `<SessionTabBar>`

Unified tab bar rendering both session tabs and file tabs.

```typescript
interface SessionTabBarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSwitchSession: (taskId: string) => void;
  onCloseSession: (taskId: string) => void;
  files: OpenFile[];
  activeFilePath: string | null;
  onSwitchFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  previewFile: OpenFile | null;
  previewFilePath: string | null;
  onClearPreview: () => void;
  onPinPreview: () => void;
}
```

Root: `<div className="session-tabs">` — flex row, `border-bottom: 1px solid var(--border)`, `overflow-x: auto`

Returns `null` when no sessions and no files/preview.

**Session tabs** (`.session-tab`):
- Status dot (`.session-tab-dot`): 6px circle, color by status (`running` → blue, `done` → green, `error` → red, else → hint)
- Name (`.session-tab-name`): `max-width: 120px`, truncated
- Pending request badge (`.session-tab-badge`): animated pulse, shows `"Q"` for question or `"A"` for approval
- Close button (`.session-tab-close`): hidden by default, visible on tab hover
- Active tab: `.session-tab-active` → `color: var(--text)`, `border-bottom: 2px solid var(--purple)`

**Separator** (`.session-tab-sep`): 1px × 16px between session and file tabs

**Pinned file tabs** (`.session-tab.file-tab`):
- File icon: 📄, dirty indicator (`.file-tab-dirty` → gold dot if `isDirty`)
- Close button

**Preview tab** (`.session-tab.file-tab.file-tab-preview`):
- Name is italic
- Double-click pins the preview
- Close button calls `onClearPreview`

---

## Chat Stream Behavior

### Auto-scroll

- Auto-scrolls to bottom when `events.length` changes via `useEffect`
- Pauses when user scrolls up and `distFromBottom >= 50px`
- `autoScroll` is a `useRef<boolean>` (not state) — toggling it does NOT cause a re-render
- "Jump to bottom" sticky button appears based on `!autoScroll.current` (only updates on next render from new event)

### Event key strategy

Keys are `${eventIndex}-${eventType}` — index-based, not content-based.

### Animations

All rendered event elements have `animation: slideUp 0.22s ease-out` (opacity 0→1, translateY 6→0px). Gap is uniform `var(--space-md)` on `.chat-stream`.

---

## Session Status and Store

### `SessionStatus` type

```typescript
type SessionStatus = "idle" | "running" | "done" | "error" | "interrupted";
```

### `SessionMetrics` type

```typescript
interface SessionMetrics {
  costUsd: number;
  turns: number;
  toolCalls: number;
  contextTokens: number;
  contextMax: number;
  durationMs: number;
  filesChanged: Record<string, "created" | "modified" | "deleted">;
}
```

### How metrics are updated in the store

| Metric | Update trigger |
|---|---|
| `toolCalls` | Incremented by 1 on every `agent/toolCallEnd` event |
| `durationMs` | Set to `Date.now() - session.startedAt` on every event |
| `costUsd`, `turns`, `durationMs` | Set from payload on `agent/turnComplete` |
| `costUsd`, `durationMs`, `turns` | Set from payload on `agent/done` |
| `contextTokens`, `contextMax` | NOT updated from any event — remain at 0 unless set externally **[Planned]** |
| `filesChanged` | NOT updated from any event — always `{}` **[Planned]** |

### Session status transitions

| Event | `status` → |
|---|---|
| `sendMessage()` | `"running"` (optimistic) |
| `agent/turnComplete` | `"idle"` |
| `agent/interrupted` | `"idle"` |
| `agent/done` | `"done"` |
| `agent/error` (subtype=`"turn_error"`) | `"idle"` (recoverable) |
| `agent/error` (other subtypes) | `"error"` (terminal) |
| `interruptSession()` | `"interrupted"` |

### Pending request management

- `pendingRequest` is set on `agent/askUserQuestion` and `agent/confirmAction`
- Cleared on `resolveRequest()`, `agent/done`, `agent/error`
- Both events are stored in `answeredRequests` Map (keyed by `requestId`) upon resolution
- For restored sessions, all question/approval events are pre-populated into `answeredRequests` with `{ historical: true }`

### Config changes

- `agent/configChanged` RPC notification updates `session.model` and `session.permissionMode` in the store
- `updateConfig()` store action calls `agent/updateConfig` RPC to change config on running session

---

## Data Flow Summary

```
RPC server
  └─ wireEvents() subscribes to all agent/* methods
      ├─ agent/sessionStart → sessionStore.onSessionStart()
      ├─ agent/textDelta, toolCallStart, etc. → sessionStore.onAgentEvent()
      │     → appendEvent() → toolCallEnd increments metrics.toolCalls
      │     → turnComplete/interrupted sets status="idle", updates metrics
      ├─ agent/done → sessionStore.onSessionDone()
      │     → status="done", update metrics, clear pendingRequest
      │     → notificationStore: toast + badge
      ├─ agent/error → sessionStore.onSessionError()
      │     → status="idle"/"error", clear pendingRequest
      ├─ agent/askUserQuestion → sessionStore.onAskQuestion()
      │     → set pendingRequest={type:"question", ...}
      │     → notificationStore: persistent toast + badge
      ├─ agent/confirmAction → sessionStore.onConfirmAction()
      │     → set pendingRequest={type:"approval", ...}
      └─ agent/configChanged → sessionStore.onConfigChanged()
            → updates session.model and session.permissionMode
```

---

## CSS Class Reference

| Class | Element | Key styles |
|---|---|---|
| `.chat-stream` | ChatStream root | `flex: 1; overflow-y: auto; padding: lg; flex-direction: column; gap: md` |
| `.chat-system` | SystemMessage | `text-align: center; font-style: italic; color: var(--hint); font-size: 12px` |
| `.chat-system-ok` | SystemMessage variant=ok | `color: var(--green)` |
| `.chat-user` | User message wrapper | `display: flex; justify-content: flex-end; animation: slideUp` |
| `.chat-user-text` | User message bubble | `max-width: 85%; bg: var(--elevated); border-radius: 10px 10px 2px 10px` |
| `.chat-assistant` | AssistantMessage wrapper | `max-width: 90%; animation: slideUp` |
| `.chat-assistant-text` | AssistantMessage pre | `white-space: pre-wrap; color: var(--text)` |
| `.chat-cursor` | Streaming cursor | `7×14px block; animation: blink 1s step-end infinite` |
| `.chat-tool` | ToolCallCard root | `border-left: 3px solid {dynamic}; bg: var(--elevated); max-width: 90%` |
| `.chat-tool-header` | ToolCallCard header | `flex; gap: sm; padding: sm md; cursor: pointer; font-size: 12px` |
| `.chat-tool-name` | Tool name | `color: var(--cyan); font-weight: 600` |
| `.chat-tool-input` | Tool input summary | `color: var(--muted); font-size: 11px; max-width: 300px` |
| `.chat-tool-status` | Tool status | `margin-left: auto; font-size: 11px` |
| `.chat-tool-body` | Tool output | `border-top: 1px solid border; max-height: 120px; overflow-y: auto` |
| `.chat-subagent` | SubagentBlock root | `margin-left: 12px; padding-left: 12px; border-left: 2px solid var(--border2)` |
| `.chat-subagent-header` | Subagent header | `flex; color: var(--muted); font-size: 12px` |
| `.chat-spinner` | CSS spinner | `10×10px; border-top: var(--blue); animation: spin 0.8s` |
| `.chat-question` | QuestionCard root | `border: 2px solid var(--purple); max-width: 90%; bg: var(--elevated)` |
| `.chat-question-answered` | Answered state | `opacity: 0.7` |
| `.chat-question-header` | Section header | `9px; uppercase; color: var(--purple)` |
| `.chat-option` | Option button | `flex; padding: sm md; border: 1px solid border; border-radius: sm` |
| `.chat-option-selected` | Selected option | `border-color: var(--purple); bg: rgba(187,154,247,0.1)` |
| `.chat-approval` | ApprovalCard root | `border: 2px solid var(--gold); max-width: 90%; bg: var(--elevated)` |
| `.chat-approval-title` | Title | `color: var(--gold); font-weight: 600; font-size: 12px` |
| `.chat-btn` | Generic button | `padding: xs lg; border: 1px solid border; bg: transparent; font-size: 12px` |
| `.chat-btn-primary` | Primary button | `bg: var(--purple); color: var(--bg)` |
| `.chat-btn-approve` | Approve button | `bg: var(--green); color: var(--bg)` |
| `.chat-btn-deny` | Deny button | `border-color: var(--red); color: var(--red)` |
| `.chat-banner` | Banner base | `border-radius: md; padding: md lg; font-size: 12px; animation: slideUp` |
| `.chat-banner-done` | Completion banner | `bg: rgba(158,206,106,0.1); border: var(--green)` |
| `.chat-banner-error` | Error banner | `bg: rgba(247,118,142,0.1); border: var(--red)` |
| `.chat-banner-warn` | Warning banner | `bg: rgba(224,175,104,0.1); border: var(--gold)` |
| `.chat-compact` | CompactMarker | `flex; color: var(--hint); font-size: 10px` |
| `.chat-jump-btn` | Jump to bottom | `position: sticky; bottom: sm; align-self: center` |
| `.session-status-line` | StatusLine root | `flex; padding: xs lg; border-top: 1px solid border; font-size: 11px` |
| `.ssl-selector` | Model/mode selector | `position: relative` |
| `.ssl-selector-btn` | Selector button | `bg: transparent; color: var(--muted); font-size: 11px` |
| `.ssl-selector-disabled` | Disabled state | `opacity: 0.5; cursor: not-allowed` |
| `.ssl-dropdown` | Dropdown menu | `position: absolute; bottom: 100%; bg: var(--panel); z-index: 100` |
| `.ssl-dropdown-active` | Active option | `color: var(--blue)` |
| `.ssl-pulse` | Running dot | `6×6px; bg: var(--green); animation: pulse 2s infinite` |
| `.ssl-context-bar` | Context bar | `60×6px; uses CSS vars --pct and --bar-color` |
| `.ssl-status` | Status segment | `flex; align-items: center; gap: 4px; font-size: 11px` |
| `.ssl-status-running` | Running state | `color: var(--blue)` |
| `.ssl-status-waiting` | Idle/interrupted | `color: var(--hint)` |
| `.ssl-status-ended` | Done/error | `color: var(--muted)` |
| `.ssl-status-spinner` | Running spinner | `8×8px; border-top: var(--blue); animation: spin 0.8s` |
| `.input-area` | InputArea root | `flex; align-items: flex-end; padding: md lg; border-top: 1px solid border` |
| `.input-textarea` | Textarea | `flex: 1; max-height: 150px; bg: var(--elevated)` |
| `.input-send` | Send button | `bg: var(--blue); color: var(--bg); font-size: 12px` |
| `.input-autocomplete` | Skill dropdown | `position: absolute; bottom: 100%; max-height: 240px; z-index: 100` |
| `.input-autocomplete-active` | Highlighted item | `bg: var(--hover); color: var(--text)` |
| `.session-tabs` | Tab bar root | `flex; border-bottom: 1px solid border; overflow-x: auto` |
| `.session-tab` | Tab | `flex; padding: sm md; font-size: 12px; border-bottom: 2px solid transparent` |
| `.session-tab-active` | Active tab | `color: var(--text); border-bottom-color: var(--purple)` |
| `.session-tab-dot` | Status dot | `6×6px; border-radius: 50%` |
| `.session-tab-badge` | Pending badge | `9px; bg: var(--purple); animation: pulse 2s` |
| `.session-tab-close` | Close button | `opacity: 0; visible on tab hover` |
| `.restored-bar` | Restored bar root | `flex; border-top: 1px solid border; bg: var(--panel)` |
| `.restored-bar-btn` | Resume button | `bg: var(--blue); color: #fff` |

---

## Animations

| Name | Keyframes | Used by |
|---|---|---|
| `slideUp` | `from {opacity:0; transform:translateY(6px)} to {opacity:1; transform:translateY(0)}` | All chat event elements |
| `blink` | `50% {opacity: 0}` | `.chat-cursor` |
| `spin` | `to {transform: rotate(360deg)}` | `.chat-spinner`, `.ssl-status-spinner` |
| `pulse` | (defined globally) | `.ssl-pulse`, `.session-tab-badge` |

---

## Not Implemented (Planned)

| Feature | Notes |
|---|---|
| Markdown rendering in AssistantMessage | Currently renders raw text in `<pre>` |
| Author labels ("Claude", "You") above bubbles | Not rendered |
| Message concatenation (multiple textDelta → one bubble) | Each textDelta renders its own AssistantMessage |
| `parentToolUseId` nesting (tool calls inside SubagentBlock) | SubagentBlock children are always null |
| "Skip" / "Other" button in QuestionCard | Only "Send" is implemented |
| Context tokens update from agent events | `contextTokens`/`contextMax` not updated |
| `filesChanged` tracking in metrics | Always `{}` |
| `agent/progress` visual rendering | Returns null |
| Virtual scrolling for large sessions | Not implemented |
| Accessibility (aria-expanded, role="radio", aria-live) | Not implemented |

---

## Related Specs

- **Parent:** [Center Panel](CENTER_PANEL.md)
- **Depends on:** [RPC Module](../../backend/app/rpc/README.md) (agent events), [API Client](../src/api/README.md) (event subscriptions)
- **Types:** `frontend/src/types/agent.ts`, `frontend/src/types/session.ts`
- **Store:** `frontend/src/store/sessionStore.ts`, `frontend/src/store/wireEvents.ts`
- **Skills constant:** `frontend/src/constants/skills.ts`
