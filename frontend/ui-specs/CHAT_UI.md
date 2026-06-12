---
id: chat-ui
type: submodule-design
status: active
title: Chat UI Rendering
parent: ui-center-panel
depends-on:
- module-rpc
covers:
- frontend/src/components/ChatStream/
tags:
- frontend
- ui
- chat
- rendering
---
# Chat UI Rendering — Sub-Specification

> Parent: [CENTER_PANEL.md](CENTER_PANEL.md) | Status: **Active** | Created: 2026-02-27 | Updated: 2026-04-08

## Overview

The Chat UI is the center panel's primary content area. It renders a scrolling stream of visual elements derived from JSON-RPC agent event notifications. Each event type maps to a distinct React component with specific rendering rules, interaction behaviors, and state transitions.

This spec reflects the **actual implemented code** as of 2026-03-05. Items not yet implemented are marked **[Planned]**.

> **Modifier key:** Mod = Ctrl on macOS, Alt on Linux/Windows

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
      <DiffCard />                     // toolCallStart for Edit/Write/NotebookEdit (lazy-loaded)
      <SubagentBlock />                // subagentStart (finished derived from subagentEnd)
      <QuestionCard />                 // askUserQuestion
      <SuggestionCard />               // suggestSession
      <ApprovalCard />                 // confirmAction (generic tools)
      <PlanApprovalCard />             // confirmAction when toolName === "ExitPlanMode"
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
- When no sessions and no files are open, `SessionPanel` renders `<div className="center-placeholder">Select a session or create a new one (Mod+T)</div>`.
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
| `toolCallStart` | `<ToolCallCard>` (state derived from paired `toolCallEnd`) — **or `<DiffCard>`** for Edit/Write/NotebookEdit |
| `toolCallEnd` | `null` (data consumed by `toolCallStart` pre-pass) |
| `subagentStart` | `<SubagentBlock>` (finished + childEvents from pre-pass; expand/collapse with summary) |
| `subagentEnd` | `null` |
| `askUserQuestion` | `<QuestionCard>` |
| `suggestSession` | `<SuggestionCard>` |
| `confirmAction` | `<ApprovalCard>` — or `<PlanApprovalCard>` when `toolName === "ExitPlanMode"` |
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
2. `activeSubagents` Set: iterates all events, adds on `subagentStart`, deletes on `subagentEnd`, **clears on `interrupted` or `turnComplete`** (turn-end events implicitly close all open subagents because the SDK's `SubagentStop` hook isn't guaranteed to fire on interrupt)
3. `subagentChildren` Map + `childIndices` Set: **agentId-based grouping** of child events under their parent `subagentStart`. First pass builds `agentStartIdx` (Map of `agentId → subagentStart event index`), cleared on `interrupted`/`turnComplete`. Second pass iterates all events — those with a `payload.agentId` matching a known subagent are added as children of that subagent's start event. Events of type `bonsai_visualize`, `askUserQuestion`, and `confirmAction` are hoisted to top-level (not grouped under the subagent) so they remain visible when the SubagentBlock is collapsed. The `agentId` field is set by the backend, which resolves the SDK's `parent_tool_use_id` on each message via a `tool_use_id → agent_id` mapping built from `SubagentStart` hooks.

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
- Inner: renders text via `<ChatMarkdown>` component — full markdown rendering using `react-markdown` + `remark-gfm`
- When `streaming=true`: renders `<span className="chat-cursor" />` — 7×14px block cursor, `blink` animation (1s step-end)
- **Markdown rendering:** Implemented via `ChatMarkdown` component. Uses `react-markdown` with `remark-gfm` and `remark-frontmatter` plugins for GitHub-Flavored Markdown (tables, strikethrough, task lists). YAML frontmatter blocks render as collapsible `FrontmatterCard` (syntax-highlighted via Monaco). Links render as `<ExternalLink>` component (opens in new tab). Code blocks render with syntax highlighting.
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
  rawInput?: Record<string, unknown>;  // Full tool input object for smart rendering
  toolInput?: string;                   // Legacy: pre-extracted string (backward compat)
  output?: string;
  isError?: boolean;
  state: "running" | "success" | "error";
  compact?: boolean;
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

**Smart Header** (`.chat-tool-header`, always visible, clickable when not running):
- `.chat-tool-icon`: emoji from `TOOL_ICONS` lookup
- `.chat-tool-name`: `cleanToolName(toolName)` — strips `mcp__servername__` prefix for display (e.g., `mcp__bonsai-specs__registry_query` → `registry_query`), `color: var(--blue)`, `font-weight: 600`
- `.chat-tool-input`: smart summary from `extractToolHeader()` registry (see below), `color: var(--muted)`, 11px, truncated with `text-overflow: ellipsis`, `flex: 1 1 auto`
- `.chat-tool-badge`: optional metadata badge (e.g. "4 lines", "3 files"), `color: var(--muted)`, 10px
- `.chat-tool-status`: status icon + text, colored with `borderColor`, `margin-left: auto`

**Header extraction** — `toolHeaderExtractors.ts` provides per-tool functions that extract a `{ summary, badge? }` from the raw input object + output:

| Tool | Summary | Badge |
|---|---|---|
| `Bash` | `command` (truncated 100 chars) | output line count |
| `Read` | `file_path` + line range if offset/limit present | output line count |
| `Grep` | `/pattern/` in `path` | match count from output |
| `Glob` | `pattern` in `path` | file count from output |
| `Agent` | `subagent_type — description` | — |
| `WebSearch` | `query` | — |
| `WebFetch` | `url` (truncated 80 chars) | — |
| `AskUserQuestion` | first question text | — |
| Fallback | first string-valued field, or JSON.stringify first 60 chars | — |

**Structured Body** (`.chat-tool-body`, toggle on header click):
- Only rendered when `expanded`
- **Input detail** (`<ToolInputDetail>`): shown when `rawInput` has >1 non-internal key. Renders key-value pairs with type-aware coloring:
  - Keys: `var(--gold)`, strings: `var(--green)`, numbers: `var(--primary)`, booleans: `var(--blue)`
  - Keys starting with `_` are skipped
  - Long strings (>200 chars) truncated with "show full" toggle
  - Nested objects rendered as indented `JSON.stringify`
- **Output body** (`<ToolOutputBody>`): content-aware renderer:
  - **JSON detection**: tries `JSON.parse` — if valid object/array, pretty-prints with colored syntax (keys: gold, strings: green, numbers: purple, booleans: blue) via simple regex coloring
  - **Error styling**: `isError` flag → red-tinted background + border (`rgba(247,84,100,0.06)` bg, `rgba(247,84,100,0.18)` border)
  - **Truncation**: outputs >30 lines show first 15 + clickable "Show all N lines" button
  - **Plain text**: clean `<pre>` with `white-space: pre-wrap; word-break: break-word`
- Header click does nothing when `state === "running"`

**Data flow** (in `ChatStream` and `SubagentBlock`):
- `rawInput` is passed as `(p.toolInput as Record<string, unknown>) ?? {}` — the full tool input object
- The legacy `extractToolInput()` function remains exported for DiffCard Suspense fallback usage
- `ToolCallCard` falls back to `toolInput` string prop if `rawInput` is not provided

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

**`agentId`-based nesting:** Events from subagents carry `payload.agentId` (resolved by the backend from the SDK's `parent_tool_use_id`). The pre-pass groups these events under their parent `subagentStart`. Events without `agentId` (root agent or old persisted events) render at the top-level stream.

---

### `<DiffCard>`

Monaco DiffEditor-based replacement for `<ToolCallCard>` when the tool is Edit, Write, or NotebookEdit. Shows a side-by-side diff of the original and modified content.

```typescript
interface DiffCardProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  state: "running" | "success" | "error";
  compact?: boolean;  // true when rendered inside SubagentBlock
}

interface DiffData {
  filePath: string;
  original: string;
  modified: string;
}
```

**Routing logic:**

Both `ChatStream` and `SubagentBlock` define:
```typescript
const DIFF_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const DiffCard = lazy(() => import("./DiffCard.tsx").then(m => ({ default: m.DiffCard })));
```

When `DIFF_TOOLS.has(toolName)`, the event is rendered as:
```tsx
<Suspense fallback={<ToolCallCard toolName={toolName} toolInput={...} state="running" />}>
  <DiffCard toolName={toolName} toolInput={...} output={end?.output} isError={end?.isError} state={state} />
</Suspense>
```

**DiffData extraction** (`extractDiffData` function):

| Tool | `filePath` | `original` | `modified` |
|------|-----------|------------|------------|
| Edit | `toolInput.file_path` | `toolInput.old_string` | `toolInput.new_string` |
| Write | `toolInput.file_path` | `toolInput._previousContent` (injected by backend) | `toolInput.content` |
| NotebookEdit | `toolInput.notebook_path` | `toolInput.old_source` | `toolInput.new_source` or `toolInput.source` |

Returns `null` if required fields are missing → falls back to JSON display.

**Backend `_previousContent` injection** (in `runner.py`):

When a `Write` ToolUseBlock is detected, the backend reads the target file's current content and injects it as `_previousContent` into the `toolInput` dict before emitting `agent/toolCallStart`. If the file does not exist or cannot be read, `_previousContent` is set to `""`.

**Monaco DiffEditor configuration:**

```typescript
options={{
  readOnly: true,
  renderSideBySide: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
  lineNumbers: "on",
  automaticLayout: true,
  enableSplitViewResizing: true,
  ignoreTrimWhitespace: false,
}}
```

Uses the `intellij-darcula` custom theme (shared with `FileViewer`).

**Header** (`.diff-card-header`, always visible, clickable when not running):
- `.diff-card-icon`: emoji from `TOOL_ICONS` (Edit/Write → ✏️, NotebookEdit → 📓)
- `.diff-card-name`: tool name, `color: var(--blue)`, `font-weight: 600`
- `.diff-card-path`: truncated file path, `max-width: 300px`
- `.diff-card-lang`: language badge from `detectLanguage()`
- `.diff-card-stats`: `+N` (green) / `-N` (red) line change counts
- `.diff-card-status`: status icon + text, same as ToolCallCard

**Horizontal scrolling:**
- `.diff-card-editor-scroll`: `overflow-x: auto; overflow-y: hidden`
- `.diff-card-editor`: `min-width: 900px` (700px in compact mode) ensures side-by-side diff is readable; viewport scrolls horizontally if narrower

**Resize behavior:**
- `.diff-card-editor` has `resize: vertical`, `min-height: 100px`, `max-height: 600px`, default `height: 300px` (200px compact)
- A `ResizeObserver` syncs the container's `contentRect.height` to the Monaco `height` prop

**Edge cases:**

| Scenario | Behavior |
|----------|----------|
| Binary file (png, jpg, zip, etc.) | Falls back to text display: `"Binary file: {path}"` |
| Large file (original + modified > 100KB) | Shows warning + "Load diff anyway" button |
| Missing diff fields (null from extractDiffData) | Falls back to `JSON.stringify(toolInput)` display |
| Error state | Diff editor + error output `<pre>` below |

**Compact variant** (`compact={true}`, used inside SubagentBlock):
- `.diff-card--compact`: `border-left-width: 2px`, `background: transparent`, `max-width: 100%`
- Header: smaller padding/font (2px / 11px)
- Editor: `min-width: 700px`, `min-height: 80px`, `max-height: 400px`, default height 200px

---

### `<SubagentBlock>`

```typescript
interface SubagentBlockProps {
  agentType?: string;
  finished: boolean;
  childEvents: AgentEvent[];
  toolStates: Map<string, ToolState>;
}
```

- Root: `<div className="chat-subagent">` — `margin-left: 12px`, `padding-left: 12px`, `border-left: 2px solid var(--border2)`
- Header (`.chat-subagent-header`): clickable toggle, `color: var(--muted)`, 12px
  - Toggle: `▼` expanded, `▶` collapsed
  - Icon: `✓` when `finished`, `⚡` when running
  - Text: `Subagent: {agentType ?? "agent"}`
  - When not finished: `<span className="chat-spinner" />` (10px CSS spinner, `border-top-color: var(--blue)`)
  - When collapsed: summary line (e.g. "8 tool calls (3 Read, 2 Edit, 2 Bash, 1 Grep)")
- Body (`.chat-subagent-body`): renders `childEvents` — `toolCallStart` as `ToolCallCard`/`DiffCard` (compact), `textDelta` as `ChatMarkdown`
- Auto-collapses when `finished` transitions from `false` → `true` (via useEffect)
- **Interrupt safety**: `finished` is derived from the `activeSubagents` pre-pass which clears on `interrupted`/`turnComplete`, so interrupted subagents are correctly shown as finished

---

### `<QuestionCard>`

```typescript
interface QuestionCardProps {
  questions: Question[];
  answered: boolean;
  interrupted?: boolean;
  selectedAnswers?: Record<string, string>;
  onSubmit: (response: Record<string, unknown>) => void;
}
```

**Architecture:** Tabbed multi-question card with keyboard navigation and preview panel.

**Sub-components:**
- `QuestionTabBar` — tab buttons for multi-question flows (shows header + answered indicator per question)
- `QuestionOptionsPanel` — option list (radio for single-select, checkbox for multi-select) + "Other" free-text input
- `QuestionPreviewPanel` — description preview for the currently highlighted option

**Layout:**
- Root: `<div className="chat-question">` with `tabIndex=0` for keyboard focus
- Tab bar (if `questions.length > 1`): horizontal tabs showing each question's header
- Question text: `.chat-question-header` (header badge) + `.chat-question-text` (question)
- Body: split into options panel (left) + preview panel (right)
- Submit bar: Next/Submit buttons + keyboard shortcut hints

**Selection semantics:**
- **Single-select:** Click selects option + auto-advances to next unanswered question (150ms delay). Does NOT auto-submit — user must explicitly click Submit.
- **Multi-select:** Click toggles option (add/remove from selection).
- **"Other":** Always present as the last option. Selecting it focuses a text input for free-text entry.

**Keyboard navigation:**
- `ArrowUp`/`ArrowDown` — highlight next/previous option
- `Enter` — select highlighted option (same as click)
- `ArrowLeft`/`ArrowRight` — switch between question tabs (multi-question)
- `Cmd/Ctrl+Enter` — submit all answers
- `Escape` (when in Other input) — return focus to option list

**Submission flow:**
- If all questions answered: Submit button sends `{ questions, answers }` via `onSubmit`
- If some unanswered: first click shows confirmation ("N of M unanswered"), second click submits
- `advanceToNext()` only advances tabs, never auto-submits

**Answered state:**
- When `answered`: renders `AnsweredTable` showing question→answer mapping
- When `interrupted`: shows "interrupted" badge instead of answers
- Otherwise: sends `{ questions, answers: { [questionText]: selectedLabel } }`
- `Mod+Enter` submits from the free-text textarea

**Actions row** (`.chat-question-actions`, hidden when `answered`):
- Single button: `.chat-btn.chat-btn-primary` labeled "Send"
- Disabled when free-text mode and text is empty

---

### `<SuggestionCard>`

Standalone component for rendering session suggestions from the `SuggestSession` proactive tool. Triggered by `suggestSession` events.

```typescript
interface SuggestionCardProps {
  skill: string;
  specIds: string[];
  name: string;
  reason: string;
  prompt?: string;
  answered: boolean;
  decision?: "approved" | "dismissed";
  dismissReason?: string;
  onApprove: () => void;
  onDismiss: (reason?: string) => void;
}
```

- Root: `<div className="chat-suggestion [chat-suggestion-answered?]">` — `border: 2px solid var(--blue)`, `max-width: 90%`, `background: var(--elevated)`, `slideUp`
- When `answered`: `opacity: 0.7`, collapses to single-line summary row (click to expand details)

**Layout:**

1. **Header** (`.chat-suggestion-header`): `"Session Suggestion"`, 9px uppercase, `color: var(--blue)`, `letter-spacing: 0.05em`
2. **Name** (`.chat-suggestion-name`): suggested session name, `font-weight: 600`, `font-size: 13px`, `color: var(--text)`
3. **Reason** (`.chat-suggestion-reason`): why the agent suggests this, `font-size: 12px`, `color: var(--muted)`
4. **Meta row** (`.chat-suggestion-meta`): skill pill + spec IDs inline
   - **Skill pill** (`.chat-suggestion-skill`): `color: var(--blue)`, `background: rgba(125,207,255,0.1)`, `padding: 2px 8px`, `border-radius: 4px`, `font-size: 11px`, inline pill showing skill ID — only rendered when `skill` is non-empty
   - **Spec IDs** (`.chat-suggestion-specs`): comma-separated spec IDs, `font-size: 11px`, `color: var(--hint)` — only rendered when `specIds.length > 0`
5. **Prompt section** (`.chat-suggestion-prompt-section`, optional): Collapsible section showing `session_prompt` instructions from the agent
   - Toggle button (`.chat-suggestion-prompt-toggle`): `▸ Instructions` / `▾ Instructions`
   - Content (`.chat-suggestion-prompt-content`): `<pre>` block with prompt text, `font-size: 11px`

**Actions row** (`.chat-suggestion-actions`, hidden when `answered`):
- "Start Session" (`.chat-btn.chat-btn-approve`) → green background, calls `onApprove`
- "Dismiss" (`.chat-btn.chat-btn-deny`) → red outline, opens dismiss form

**Dismiss form** (`.chat-suggestion-dismiss-form`): Shown when user clicks "Dismiss" (replaces action buttons)
- Label: `"Why dismiss this suggestion?"`
- `<textarea>` (`.chat-suggestion-dismiss-input`): 2 rows, placeholder "Optional — tell the agent why...", autoFocus
- Keyboard: `Cmd/Ctrl+Enter` submits, `Escape` cancels
- "Dismiss" button → calls `onDismiss(reason)` with optional text
- "Cancel" button → hides form, returns to action buttons

**Answered state** (`.chat-suggestion-answered`): Collapses to single-line clickable summary
- Row shows: `"Session Suggestion"` + name + status badge
- `decision === "approved"`: `✓ Session started` in `var(--green)`, class `.chat-suggestion--approved`
- `decision === "dismissed"`: `✕ Dismissed` in `var(--hint)`, class `.chat-suggestion--dismissed`
- Click to expand: shows skill, specIds, reason, prompt (if present), and dismissReason (if present)
- Dismiss reason shown as: `"Reason: {dismissReason}"` (`.chat-suggestion-dismiss-reason`)

**Rendering in ChatStream:**

```typescript
case "suggestSession":
  return (
    <SuggestionCard
      skill={payload.skill ?? ""}
      specIds={payload.specIds ?? []}
      name={payload.name}
      reason={payload.reason}
      prompt={payload.prompt}
      answered={isAnswered}
      decision={answeredResponse?.behavior === "allow" ? "approved" : "dismissed"}
      dismissReason={answeredResponse?.dismissReason}
      onApprove={() => onResolveRequest(requestId, { behavior: "allow" })}
      onDismiss={(reason) => onResolveRequest(requestId, { behavior: "deny", dismissReason: reason })}
    />
  );
```

**Submission behavior:**
- "Start Session" → `onApprove()` → `resolveRequest` sends `agent/respond` with `{ behavior: "allow" }` → `sessionStore.startSession({ skillId: skill, specIds, name, prompt })` → auto-switch to new session
- "Dismiss" → opens dismiss form → user optionally types reason → `onDismiss(reason)` → `resolveRequest` sends `{ behavior: "deny", dismissReason: "..." }` → agent receives dismissal with reason

**CSS classes:**

| Class | Element | Styles |
|---|---|---|
| `.chat-suggestion` | Root | `border: 2px solid var(--blue); max-width: 90%; background: var(--elevated); border-radius: var(--radius-md); padding: var(--space-md) var(--space-lg)` |
| `.chat-suggestion-answered` | Answered state | `opacity: 0.7` |
| `.chat-suggestion--approved` | Approved modifier | Green tint on left border |
| `.chat-suggestion--dismissed` | Dismissed modifier | Muted appearance |
| `.chat-suggestion-header` | Header label | `font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--blue)` |
| `.chat-suggestion-name` | Session name | `font-weight: 600; font-size: 13px; color: var(--text)` |
| `.chat-suggestion-reason` | Reason text | `font-size: 12px; color: var(--muted)` |
| `.chat-suggestion-skill` | Skill pill | `color: var(--blue); background: rgba(125,207,255,0.1); padding: 2px 8px; border-radius: 4px; font-size: 11px` |
| `.chat-suggestion-specs` | Spec IDs list | `font-size: 11px; color: var(--hint)` |
| `.chat-suggestion-prompt-section` | Prompt container | Collapsible section |
| `.chat-suggestion-prompt-toggle` | Expand/collapse button | `font-size: 11px; cursor: pointer` |
| `.chat-suggestion-prompt-content` | Prompt text | `<pre>; font-size: 11px; background: var(--bg); padding: var(--space-sm)` |
| `.chat-suggestion-dismiss-form` | Dismiss reason form | Replaces action buttons |
| `.chat-suggestion-dismiss-input` | Dismiss textarea | 2 rows, optional reason |
| `.chat-suggestion-dismiss-reason` | Shown dismiss reason (answered state) | `font-size: 11px; color: var(--muted)` |
| `.chat-suggestion-actions` | Button row | `display: flex; gap: var(--space-sm); margin-top: var(--space-md)` |
| `.chat-suggestion-result` | Answered display | `font-size: 12px; margin-top: var(--space-sm)` |

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
- `.chat-approval-tool`: tool name (`.chat-tool-name` class → `var(--blue)`) + formatted input (`.chat-approval-input`)
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

**When answered — Compact mode** (`.chat-approval-compact`):
- Single-line row: "Action requires approval" | tool name + truncated input | approval status
- CSS class includes state modifier: `.chat-approval--approved` or `.chat-approval--denied`
- `formatToolInput()`: extracts most relevant field (command, file_path, path, pattern) or JSON
- `truncate()`: limits display to 60 characters with ellipsis
- Clickable to expand: shows full input in `<pre className="chat-approval-full-command">` and description in `.chat-approval-desc`
- Approval status: `✓ Approved` in `var(--green)` or `✕ Denied` in `var(--red)`

**When not answered** (full card — `.chat-approval-result`):
- `decision === "approve"`: `✓ Approved` in `var(--green)`
- `decision === "deny"`: `✕ Denied` in `var(--red)`

**Response sent to backend on approve:** `{ "behavior": "allow" }`
**Response sent to backend on deny:** `{ "behavior": "deny", "message": "User denied", "interrupt": false }`

---

### `<PlanApprovalCard>`

Specialized approval card for `ExitPlanMode` tool calls. Renders the plan content (markdown) instead of raw tool JSON.

```typescript
interface PlanApprovalCardProps {
  planContent?: string;
  allowedPrompts?: AllowedPrompt[];
  answered: boolean;
  decision?: "approve" | "deny";
  onApprove: () => void;
  onDeny: () => void;
}
```

**Routing:** In `ChatStream`, the `confirmAction` case checks `toolName === "ExitPlanMode"` and renders `<PlanApprovalCard>` instead of `<ApprovalCard>`. The `planContent` prop is extracted from `toolInput.plan` — the SDK's ExitPlanMode tool natively includes the plan markdown in its `plan` field.

**Plan content source (SDK-native):** The Claude Agent SDK's ExitPlanMode tool call includes a `plan` field containing the clean plan markdown that the agent wrote. The backend passes `input_data` through to the frontend as-is — no enrichment needed. The `toolInput` also contains `planContent` (accumulated turn text) and `allowedPrompts`, but only `plan` is used for rendering.

**Title extraction:** `extractPlanTitle(planContent)` extracts a short title from the plan markdown — first `#` heading, or first line, or fallback `"Plan"`.

**When not answered** (pending — full card):
- Root: `<div className="chat-plan-approval">` — `border: 2px solid var(--primary)`, `max-width: 90%`, `background: var(--elevated)`, `slideUp`
- `.chat-plan-approval-header`: "Plan Ready for Review" — 9px uppercase, `font-weight: 700`, `color: var(--primary)`, `letter-spacing: 0.5px`
- `.chat-plan-approval-body`: `<ChatMarkdown content={planContent} />` — renders full plan as markdown, `max-height: 400px`, `overflow-y: auto`, `resize: vertical`, `min-height: 60px`
- `.chat-plan-approval-empty`: Shown when `!planContent` — italic hint text "Plan written to file — approve to continue"
- `.chat-plan-approval-tags`: If `allowedPrompts` present, shows "Requested permissions:" label (`.chat-plan-approval-tags-label`) + tag chips
- `.chat-plan-approval-actions`: Approve Plan / Reject Plan buttons (same `.chat-btn` classes as `ApprovalCard`)

**When answered** (compact, expandable):
- Root: `<div className="chat-plan-approval chat-plan-approval-answered [--approved|--denied]">`
- `.chat-plan-approval-row`: Clickable single row with "Plan Review" label, extracted title, and status (`✓ Approved` / `✕ Rejected`)
- Click toggles `.chat-plan-approval-expanded`: shows full plan body (or empty-state fallback "Plan written to file") + permission tags
- State classes: `.chat-plan-approval--approved` or `.chat-plan-approval--denied`

**Response sent to backend on approve:** `{ "behavior": "allow" }`
**Response sent to backend on deny:** `{ "behavior": "deny", "message": "User denied", "interrupt": false }`

**CSS classes:**

| Class | Element | Key Styles |
|---|---|---|
| `.chat-plan-approval` | Root | `border: 2px solid var(--primary); max-width: 90%; bg: var(--elevated); animation: slideUp` |
| `.chat-plan-approval-header` | Uppercase label (pending) | `font-size: 9px; text-transform: uppercase; font-weight: 700; color: var(--primary); letter-spacing: 0.5px` |
| `.chat-plan-approval-body` | Markdown plan content | `border: 1px solid var(--border); max-height: 400px; overflow-y: auto; resize: vertical; min-height: 60px` |
| `.chat-plan-approval-empty` | Fallback when no content | `font-size: 12px; font-style: italic; color: var(--hint)` |
| `.chat-plan-approval-tags` | Tags wrapper | `display: flex; flex-wrap: wrap; gap: var(--space-xs)` |
| `.chat-plan-approval-tags-label` | "Requested permissions:" | `font-size: 11px; color: var(--muted)` |
| `.chat-plan-approval-tag` | Permission tag chip | `font-size: 11px; bg: rgba(187,154,247,0.1); color: var(--primary); border-radius: 3px` |
| `.chat-plan-approval-answered` | Answered state | `opacity: 0.7; border-width: 1px; border-color: var(--border)` |
| `.chat-plan-approval--approved` | Approved modifier | `border-color: var(--green)` |
| `.chat-plan-approval--denied` | Denied modifier | `border-color: var(--red)` |
| `.chat-plan-approval-row` | Answered compact row | `display: flex; align-items: center; gap: var(--space-md); font-size: 12px; cursor: pointer; user-select: none` |
| `.chat-plan-approval-label` | "Plan Review" label | `color: var(--primary); font-weight: 600; white-space: nowrap` |
| `.chat-plan-approval-title` | Extracted plan title | `flex: 1; text-overflow: ellipsis; color: var(--text)` |
| `.chat-plan-approval-status` | Status text wrapper | `white-space: nowrap; font-weight: 500` |
| `.chat-plan-approval-approved` | "✓ Approved" text | `color: var(--green)` |
| `.chat-plan-approval-denied` | "✕ Rejected" text | `color: var(--red)` |
| `.chat-plan-approval-expanded` | Expand panel | `margin-top: var(--space-sm); border-top: 1px solid var(--border)` |

---

### `<CompletionBanner>`

```typescript
interface CompletionBannerProps {
  costUsd?: number;
  turns?: number;
  durationMs?: number;
}
```

- Root: `<div className="chat-banner chat-banner-done">` — `background: rgba(158,206,106,0.1)`, `border: 1px solid var(--green)`, `color: var(--green)`
- `.chat-banner-title`: `✓ Session complete`
- `.chat-banner-metrics`: flex row with optional `$X.XX` / `N turns` / duration string
  - Duration format: `< 60s → "X.Xs"`, `≥ 60s → "Xm Xs"`

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
  effort: string | null;
  metrics: SessionMetrics;
  status: SessionStatus;
  projectCost?: number;
  disabled?: boolean;
  onChangeModel?: (model: string) => void;
  onChangePermissionMode?: (mode: string) => void;
  onChangeEffort?: (effort: string | null) => void;
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

5. **Effort selector** (`.ssl-selector` with dropdown)
   - Displays current effort label via `displayEffort()`: `null` → `"auto"`, otherwise the effort string
   - Dropdown lists `EFFORT_OPTIONS`: `[{value: null, label: "auto"}, {value: "low"}, {value: "medium"}, {value: "high"}, {value: "max"}]`
   - Uses `useDropdown()` hook (same pattern as model and permission mode)
   - Disabled when session is running or ended

6. **Separator**

7. **Cost** (`.ssl-cost`): `$X.XX | $Y.YY` — session cost (`metrics.costUsd`) + project cost (`projectCost`). Uses `reconstructCost()` / `reconstructContextUsage()` to derive from persisted events on restored sessions.

8. **Separator**

9. **Tool calls** (`.ssl-tools`): `[ssl-pulse?] {toolCalls} calls`
   - `.ssl-pulse`: 6px green dot with `pulse` animation — shown only when `status === "running"`

10. **Context bar** (conditional — only when `metrics.contextMax > 0`):
   - **Separator**
   - `.ssl-context`: text `ctx {N}k/{M}k`
   - `.ssl-context-bar`: 60px × 6px bar, uses CSS vars `--pct` and `--bar-color`
   - Color thresholds: `> 80%` → `var(--red)`, `> 50%` → `var(--gold)`, else → `var(--green)`

11. **Separator**

12. **Status indicator** (`.ssl-status.ssl-status-{class}`):

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
  onSend: (text: string, isMarkdown?: boolean) => void;
  isRunning?: boolean;
  onInterrupt?: () => void;
  showContinue?: boolean;
  onContinue?: () => void;
  showStartSession?: boolean;
  onStartSession?: () => void;
  skillId?: string | null;
}
```

Root: `<div className="input-area">` with `style={{ position: "relative" }}`

See [Markdown Input Design](../../.bonsai/design_docs/DUAL_MODE_INPUT_DESIGN.md) for full architecture.

**Always-markdown input** — no text/markdown mode toggle. All messages are sent as markdown (`onSend(trimmed, true)`). The toolbar is always visible.

**Skill autocomplete:**

State and behaviour live in the `useSlashAutocomplete` hook
(`frontend/src/hooks/useSlashAutocomplete.ts`). `<InputArea>` only
renders the popup and forwards textarea + caret state into the hook.

- **Trigger rule (mid-input):** a `/` is *active* iff the preceding
  character is whitespace, newline, or the start of the textarea. The
  popup opens whenever the caret sits inside the contiguous
  non-whitespace run that starts with an active `/`. Trigger fires
  anywhere in the textarea — not just at position 0. A `/` inside a
  URL or word (no whitespace before it) does **not** open the popup.
- **Query token:** the run from the active `/` up to (but excluding)
  the next whitespace/newline or end-of-text. Filter query is
  `token.slice(1).toLowerCase()`; matches are `id.includes(query)`
  (case-insensitive substring; empty query matches all).
- **Two sources, two sections:**
  1. **"Bonsai"** — bundled skills from the `useSettingsStore` `skills`
     map (populated by `skills/list`). Always rendered first.
  2. **Active runtime's `displayName`** (e.g. **"Claude Code"**) —
     skills from `useSettingsStore.runtimeSkills.get(runtime)`,
     populated lazily by `loadRuntimeSkills(runtime)` on session mount
     (calls `skills/listRuntime`).
  Section headers are non-selectable separator rows.
- **Dedup:** runtime entries whose `id` collides with any Bonsai skill
  id are hidden from the runtime section (Bonsai wins). Per-section
  fields use the same item markup (icon + `/{id}` cyan + description
  hint).
- **Silent fallback:** if `skills/listRuntime` fails, returns `[]`, or
  the active runtime has no skill surface, the runtime section is
  omitted entirely — no toast, no inline warning. The popup still
  shows the Bonsai section.
- **Dropdown (`.input-autocomplete`):** appears above input
  (`bottom: 100%`), max-height 240px.
- **Each item (`.input-autocomplete-item`):** icon + `/{skill.id}`
  (cyan) + description (hint, 11px). Section headers use a separate
  non-interactive class.
- **Keyboard:** ArrowUp/ArrowDown move across the flat order (Bonsai
  entries first, then runtime entries), wrapping at the ends. Tab/Enter
  accept the highlighted suggestion. Escape closes.
- **Active item:** `.input-autocomplete-active`.
- **On select / insert-at-caret:** the active `/`-token (from its
  start through the end of the non-whitespace run) is replaced with
  ``/{id} ``. Caret is placed right after the trailing space. Text
  before and after the token is preserved.
- **Close conditions:** caret moves out of the query token (text edit,
  click outside, Escape) or an item is selected.
- `onMouseDown` (not `onClick`) used on items to prevent textarea blur.

Full algorithm + data shapes: see
[Runtime Skills Autocomplete design](../../.bonsai/runtime-skills-autocomplete/design-doc.md).

**Markdown toolbar** (`.input-md-toolbar`, always visible):
- Preview toggle button (`.input-md-tab`): toggles side-by-side split-pane preview. Highlighted (`.input-md-tab--active`) when active.
- Separator (`.input-md-sep`)
- 10 format buttons (`.input-md-fmt`): B, I, `</>`, 🔗, H, •, 1., ❝, —, ` ``` `

**Textarea** (`.input-textarea.input-textarea--md`):
- Always visible (never replaced by preview)
- `rows={1}`, auto-height in auto mode
- `resize: none`, `border: 1px solid var(--border)`, `background: var(--elevated)`
- Focus: `border-color: var(--blue)`
- Disabled: `opacity: 0.5; cursor: not-allowed`
- `Mod+Enter` sends; plain `Enter` adds a newline
- `Mod+B/I/K` insert bold/italic/link markers (always active)
- Gets `.input-textarea--split` class when preview visible (bottom-left-only radius)

**Split-pane preview** (`.input-split-pane`, when `previewActive`):
- Textarea and preview appear side by side in a flex container
- Draggable divider (`.input-split-divider`, 5px wide, `cursor: col-resize`)
- Preview pane (`.input-preview`): renders `ChatMarkdown` or "Nothing to preview" placeholder
- Split ratio controlled by `splitRatio` state (default 0.5, clamped 0.2–0.8)
- `Mod+Enter` sends from preview pane via `handlePreviewKeyDown`

**Mic button** (`.input-mic`, conditional on `voice.isSupported`):
- Emoji: 🎙 (replaced by `.input-mic-spinner` when transcribing)
- CSS states: `.input-mic-recording` (active recording), `.input-mic-transcribing` (awaiting backend)
- `handleMicClick`: toggle between `startRecording()` and `stopRecording()`
- On stop: awaits `voice.stopRecording()`, sets textarea text to transcript, auto-resizes
- Speech API mode: `interimText` synced into textarea in real-time during recording
- Disabled when `disabled || voice.isTranscribing`
- Uses `useVoiceInput()` hook — see [Voice Input Design](../../.bonsai/design_docs/VOICE_INPUT_DESIGN.md)

**Send button** (`.input-send`):
- Background: `var(--blue)`, label "Send"
- Disabled when `disabled || !text.trim()`

**Continue button** (`.input-continue`, conditional on `showContinue && onContinue`):
- Label: "Continue", title: "Continue without a message"
- Visible when: input enabled, agent not running, session has events
- Behavior (in `SessionPanel`):
  - If question pending: `resolveRequest(sessionId, requestId, { text: "continue" })`
  - If idle/interrupted: `sendMessage(sessionId, "continue")`

**Placeholder states** (computed in `SessionPanel`):

| Condition | Placeholder text |
|---|---|
| `pendingRequest.type === "approval"` | `"Waiting for your approval above..."` |
| `pendingRequest.type === "suggestion"` | `"Review the session suggestion above..."` |
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
inputDisabled = isDone || isRunning || (hasPending && (pendingRequest.type === "approval" || pendingRequest.type === "suggestion"))
```
- Input is **enabled** when waiting for a question (user can type a custom answer)

**Send behavior from `SessionPanel`:**
- If `pendingRequest.type === "question"`: calls `resolveRequest(taskId, requestId, { text })`
- If `status === "idle"`: calls `sendMessage(taskId, text)` (sends new turn message)
- User message is added **optimistically** to events before API response, and status immediately set to `"running"`

---

### `<VisualizationCard>`

Rendered for `toolCallStart` events where `toolName === "bonsai_visualize"`. See [Visualization Design](../../.bonsai/design_docs/VISUALIZATION_DESIGN.md).

```typescript
// VisData is a discriminated union on `type`
type VisData =
  | { type: "progress-tracker"; title?: string; visId?: string; data: ProgressTrackerData }
  | { type: "summary-box"; title?: string; visId?: string; data: SummaryBoxData }
  | { type: "comparison"; title?: string; visId?: string; data: ComparisonData }
  | { type: "data-table"; title?: string; visId?: string; data: DataTableData }
  | { type: "status-list"; title?: string; visId?: string; data: StatusListData }
  | { type: "diagram"; title?: string; visId?: string; data: DiagramData }
```

- Root: `<div className="vis-card">` — wrapped in `<VisErrorBoundary>`
- Header (`.vis-card-header`): type emoji icon (`VIS_ICONS` map) + title + type label, click toggles collapse
- Body (`.vis-card-body`): one of 6 sub-renderers selected by `data.type`
- Collapse state: `useState(false)` — toggled by header click

**Sub-renderers:**

| Renderer | Data | Renders |
|----------|------|---------|
| `ProgressTracker` | `steps[]: { label, status, file?, substeps? }` | Steps with status icons, optional substeps indented |
| `SummaryBox` | `sections[]: { heading, status?, items[]: { label, value } }` | Grouped label/value pairs |
| `Comparison` | `options[]: { name, description?, pros?, cons? }` | Option cards with pro/con lists |
| `DataTable` | `columns[], rows[][], statusColumn?` | HTML table with optional status-colored column |
| `StatusList` | `items[]: { label, status, meta? }` | Flat list with status badges |
| `Diagram` | `nodes[], edges[], layout?` | Text-based node/edge diagram |

**Status icons and colors:** `STATUS_ICONS` maps `VisStatus` → Unicode symbol, `STATUS_COLORS` maps → CSS var.

**visId collapse pattern:** When multiple cards share the same `visId`, earlier ones render as `<CollapsedVisMarker>` (icon + title + "updated" tag, single line).

**Error boundary:** `<VisErrorBoundary>` catches render errors and shows a fallback message without crashing ChatStream.

**CSS classes:**

| Class | Element | Styles |
|---|---|---|
| `.vis-card` | Root | `border: 1px solid var(--border); border-radius: var(--radius-md); max-width: 90%; bg: var(--elevated)` |
| `.vis-card-header` | Header | `flex; padding: sm md; cursor: pointer; font-size: 12px` |
| `.vis-card-body` | Body | `border-top: 1px solid border; padding: sm md; resize: vertical; min-height: 60px` |

---

### `<DraftConfigCard>` — Read-Only Mode (Session Start)

At session start, `DraftConfigCard` is rendered in **read-only mode** to display the session's configuration and prompt preview. This replaces the former `SessionContextCard` component.

```typescript
interface DraftConfigCardProps {
  bonsaiSid: string;
  readOnly?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}
```

When `readOnly` is true, the component renders a display-only version of the draft card:
- **Header:** Session name as plain text (`.draft-config-name`), no input field
- **Skill row:** Read-only pill (no remove/change buttons)
- **Specs row:** Read-only pills (no remove/add buttons)
- **Ticket row:** Read-only pill (no remove/attach buttons)
- **Files row:** Read-only pills showing filenames (tooltip: full path), or "none"
- **Config row:** Static pills showing model, permission mode, turns, effort, 1M context (no selects or interactive buttons)
- **Prompt preview:** Full `<PromptPreview>` with structured sections, token bar chart, collapsible markdown — identical to draft view
- **No actions row** (Start/Discard buttons hidden)

Uses `IntersectionObserver` on `cardRef` to track visibility via `onVisibilityChange` — used by `StickyContextBar` to show/hide a condensed context bar when the card scrolls out of view.

**Data source:** Reads all data from the session store by `bonsaiSid`. For `systemPrompt` and `promptSections`: available in-memory for sessions started from a draft; for restored sessions, `systemPrompt` is extracted from the persisted `sessionStart` event payload. `PromptPreview` falls back to markdown rendering of raw `systemPrompt` when structured `promptSections` are unavailable.

**CSS classes:** `.draft-config-card--readonly` (modifier, removes margin), `.draft-config-name` (plain text session name), `.draft-config-card--drag-over` (dashed blue outline when dragging files over), plus shared `.draft-config-*` classes from DraftConfigCard

---

### `<DraftConfigCard>` — File Attachments

Users can attach project files to a draft session. Attached file paths are listed in the agent's system prompt so it can read them on demand.

**Files row** (between Ticket and Config rows):
- Pills showing filename (basename), tooltip shows full relative path, `×` to remove
- `+ attach file` button opens a `FileSelector` popover
- Read-only mode: pills only (no buttons)

**Drag-and-drop:** Files can be dragged from the left-panel `FileTree` and dropped onto the draft card. Uses native HTML5 drag API with custom MIME type `application/x-bonsai-file`. Drop zone shows dashed blue outline (`.draft-config-card--drag-over`).

### `<FileSelector>`

Compact file tree browser for selecting files to attach to a draft session.

```typescript
interface FileSelectorProps {
  selectedPaths: string[];
  onToggle: (path: string) => void;
}
```

- Fetches project file tree from `/api/project/files`
- Tree view with expandable directories (collapsed by default)
- Search input filters files by name
- Click a file to toggle selection; selected files show checkmark
- Rendered inside `DraftConfigCard`'s popover

**CSS classes:** `.file-selector`, `.file-selector-search`, `.file-selector-list`, `.file-selector-item`, `.file-selector-item--selected`, `.file-selector-check`

### `<PromptPreview>` — Files Section

The "Relevant Files" prompt section uses teal color (`#56B6C2`). When expanded, shows each file as an expandable entry with:
- Header: `▶ filename.tsx` + token count
- Expanded: **Monaco editor** (read-only, syntax highlighted via `detectLanguage()`) for code/text files, auto-sized to content (max 300px). Falls back to `<pre>` while Monaco loads.
- **Image files** (png, jpg, gif, svg, webp, etc.): rendered as `<img>` via `/api/file/raw` endpoint, max 300px height
- Empty preview: italic "No preview available" message

Reuses the same expand/collapse state (`expandedSpecs`) and CSS classes (`prompt-spec-list`, `prompt-spec-entry`) as spec details.

**CSS classes:** `.prompt-file-preview`, `.prompt-file-preview--image`, `.prompt-file-image`, `.prompt-file-preview--empty`, `.prompt-file-fallback`

### FileTree — Drag Source

File rows (not directories) in `FileTree` are draggable (`draggable="true"`). On drag start, sets `application/x-bonsai-file` and `text/plain` data transfer types with the file path.

**CSS:** `.ft-row[draggable="true"]` gets `cursor: grab`.

---

### Resize Behavior

Several ChatStream containers support manual vertical resizing via CSS `resize: vertical`:

| Container | CSS Rule | Min Height |
|-----------|----------|------------|
| `.chat-tool-body` | `resize: vertical` | 40px |
| `.chat-subagent-body` | `resize: vertical` | 60px |
| `.chat-approval-expanded` | `resize: vertical` | 40px |
| `.vis-card-body` | `resize: vertical` | 60px |
| `.diff-card-editor` | `resize: vertical` | 100px (max: 600px, default: 300px) |

`DiffCard` additionally uses a `ResizeObserver` to sync the Monaco editor height with its container when expanded:

```typescript
useEffect(() => {
  const el = editorContainerRef.current;
  if (!el || !expanded) return;
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) setEditorHeight(entry.contentRect.height);
  });
  observer.observe(el);
  return () => observer.disconnect();
}, [expanded]);
```

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
- Pending request badge (`.session-tab-badge`): animated pulse, shows `"Q"` for question, `"A"` for approval, or `"S"` for suggestion
- Close button (`.session-tab-close`): hidden by default, visible on tab hover
- Active tab: `.session-tab-active` → `color: var(--text)`, `border-bottom: 2px solid var(--primary)`

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

- `pendingRequest` is set on `agent/askUserQuestion`, `agent/confirmAction`, and `agent/suggestSession`
- Cleared on `resolveRequest()`, `agent/done`, `agent/error`
- All events are stored in `answeredRequests` Map (keyed by `requestId`) upon resolution
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
      │     → notificationStore: persistent toast + badge
      ├─ agent/suggestSession → sessionStore.onSuggestSession()
      │     → set pendingRequest={type:"suggestion", ...}
      │     → notificationStore: persistent toast + badge
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
| `.chat-tool-name` | Tool name | `color: var(--blue); font-weight: 600` |
| `.chat-tool-input` | Tool input summary | `color: var(--muted); font-size: 11px; flex: 1 1 auto; ellipsis` |
| `.chat-tool-badge` | Header metadata badge | `color: var(--muted); font-size: 10px` |
| `.chat-tool-status` | Tool status | `margin-left: auto; font-size: 11px` |
| `.chat-tool-body` | Tool output | `border-top: 1px solid border; overflow-y: auto; resize: vertical` |
| `.tool-section-label` | "Input" / "Output" label | `color: var(--muted); font-size: 10px; uppercase` |
| `.tool-input-detail` | Structured input container | key-value pairs with type coloring |
| `.tool-input-key` | Input key name | `color: var(--gold)` |
| `.tool-input-value` | Input string value | `color: var(--green)` |
| `.tool-input-value--number` | Input number value | `color: var(--primary)` |
| `.tool-input-value--bool` | Input bool/null value | `color: var(--blue)` |
| `.tool-output` | Output pre block | `font-size: 11px; pre-wrap; bg: rgba(0,0,0,0.12)` |
| `.tool-output--error` | Error output | `bg: rgba(red, 0.06); border: 1px solid rgba(red, 0.18)` |
| `.tool-output--json .json-key` | JSON key | `color: var(--gold)` |
| `.tool-output--json .json-string` | JSON string | `color: var(--green)` |
| `.tool-output--json .json-number` | JSON number | `color: var(--primary)` |
| `.tool-output--json .json-bool` | JSON bool/null | `color: var(--blue)` |
| `.tool-output-expand` | Truncation expand button | `text-align: center; color: var(--blue)` |
| `.diff-card` | DiffCard root | `border-left: 3px solid {dynamic}; bg: var(--elevated); max-width: 90%; animation: slideUp` |
| `.diff-card--compact` | DiffCard compact variant | `border-left-width: 2px; bg: transparent; max-width: 100%` |
| `.diff-card-header` | DiffCard header | `flex; gap: sm; padding: sm md; cursor: pointer; font-size: 12px` |
| `.diff-card-name` | Tool name | `color: var(--blue); font-weight: 600` |
| `.diff-card-path` | File path | `color: var(--muted); font-size: 11px; max-width: 300px; text-overflow: ellipsis` |
| `.diff-card-lang` | Language badge | `font-size: 10px; color: var(--hint); bg: var(--hover); border-radius: sm` |
| `.diff-card-stats` | Change stats | `font-size: 11px; flex; gap: xs` |
| `.diff-card-stats-add` | Added lines | `color: var(--green)` |
| `.diff-card-stats-del` | Removed lines | `color: var(--red)` |
| `.diff-card-status` | Status indicator | `margin-left: auto; font-size: 11px` |
| `.diff-card-editor-scroll` | Editor scroll wrapper | `border-top: 1px solid border; overflow-x: auto; overflow-y: hidden` |
| `.diff-card-editor` | Editor container | `min-width: 900px; resize: vertical; min-height: 100px; max-height: 600px; height: 300px` |
| `.diff-card-error` | Error output | `border-top: 1px solid border; padding: sm md` |
| `.diff-card-fallback` | Fallback display | `border-top: 1px solid border; padding: sm md` |
| `.diff-card-large-warning` | Large file warning | `border-top: 1px solid border; padding: md; text-align: center` |
| `.chat-subagent` | SubagentBlock root | `margin-left: 12px; padding-left: 12px; border-left: 2px solid var(--border2)` |
| `.chat-subagent-header` | Subagent header | `flex; color: var(--muted); font-size: 12px` |
| `.chat-spinner` | CSS spinner | `10×10px; border-top: var(--blue); animation: spin 0.8s` |
| `.chat-question` | QuestionCard root | `border: 2px solid var(--primary); max-width: 90%; bg: var(--elevated)` |
| `.chat-question-answered` | Answered state | `opacity: 0.7` |
| `.chat-question-header` | Section header | `9px; uppercase; color: var(--primary)` |
| `.chat-option` | Option button | `flex; padding: sm md; border: 1px solid border; border-radius: sm` |
| `.chat-option-selected` | Selected option | `border-color: var(--primary); bg: rgba(187,154,247,0.1)` |
| `.chat-suggestion` | SuggestionCard root | `border: 2px solid var(--blue); max-width: 90%; bg: var(--elevated)` |
| `.chat-suggestion-answered` | Answered state | `opacity: 0.7` |
| `.chat-suggestion-header` | Header label | `9px; uppercase; color: var(--blue)` |
| `.chat-suggestion-name` | Session name | `font-weight: 600; font-size: 13px` |
| `.chat-suggestion-skill` | Skill pill | `color: var(--blue); bg: rgba(125,207,255,0.1); border-radius: 4px` |
| `.chat-approval` | ApprovalCard root | `border: 2px solid var(--gold); max-width: 90%; bg: var(--elevated)` |
| `.chat-approval-title` | Title | `color: var(--gold); font-weight: 600; font-size: 12px` |
| `.chat-btn` | Generic button | `padding: xs lg; border: 1px solid border; bg: transparent; font-size: 12px` |
| `.chat-btn-primary` | Primary button | `bg: var(--primary); color: var(--bg)` |
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
| `.input-mic` | Mic button | `bg: transparent; cursor: pointer` |
| `.input-mic-recording` | Recording state | Active indicator |
| `.input-mic-transcribing` | Transcribing state | Shows spinner |
| `.input-mic-spinner` | Transcription spinner | Animated spinner replacing mic icon |
| `.input-continue` | Continue button | Visible when idle with events |
| `.input-autocomplete` | Skill dropdown | `position: absolute; bottom: 100%; max-height: 240px; z-index: 100` |
| `.input-autocomplete-active` | Highlighted item | `bg: var(--hover); color: var(--text)` |
| `.session-tabs` | Tab bar root | `flex; border-bottom: 1px solid border; overflow-x: auto` |
| `.session-tab` | Tab | `flex; padding: sm md; font-size: 12px; border-bottom: 2px solid transparent` |
| `.session-tab-active` | Active tab | `color: var(--text); border-bottom-color: var(--primary)` |
| `.session-tab-dot` | Status dot | `6×6px; border-radius: 50%` |
| `.session-tab-badge` | Pending badge | `9px; bg: var(--primary); animation: pulse 2s` |
| `.session-tab-close` | Close button | `opacity: 0; visible on tab hover` |
| `.restored-bar` | Restored bar root | `flex; border-top: 1px solid border; bg: var(--panel)` |
| `.restored-bar-btn` | Resume button | `bg: var(--blue); color: #fff` |
| `.vis-card` | VisualizationCard root | `border: 1px solid var(--border); max-width: 90%; bg: var(--elevated)` |
| `.vis-card-header` | Vis header | `flex; padding: sm md; cursor: pointer; font-size: 12px` |
| `.vis-card-body` | Vis body | `border-top: 1px solid border; resize: vertical; min-height: 60px` |
| `.session-context-card` | SessionContextCard | `bg: var(--elevated); border: 1px solid var(--border)` |
| `.session-context-row` | Context row | `flex; gap: sm` |
| `.session-context-pill` | Info pill | `font-size: 11px; border-radius: 4px; padding: 2px 8px` |
| `.session-context-pill--model` | Model pill variant | `color: var(--blue)` |
| `.session-context-pill--beta` | Beta pill variant | `color: var(--blue)` |
| `.chat-approval-compact` | Compact approval | Single-line answered approval |
| `.chat-approval--approved` | Approved state | `border-color: var(--green)` |
| `.chat-approval--denied` | Denied state | `border-color: var(--red)` |
| `.chat-plan-approval` | PlanApprovalCard root | `border: 2px solid var(--primary); max-width: 90%; bg: var(--elevated)` |
| `.chat-plan-approval-header` | Uppercase label | `font-size: 9px; text-transform: uppercase; font-weight: 700; color: var(--primary)` |
| `.chat-plan-approval-body` | Markdown content | `max-height: 400px; overflow-y: auto; resize: vertical` |
| `.chat-plan-approval-empty` | No-content fallback | `font-size: 12px; font-style: italic; color: var(--hint)` |
| `.chat-plan-approval-tag` | Permission chip | `font-size: 11px; bg: rgba(187,154,247,0.1); color: var(--primary)` |
| `.chat-plan-approval-answered` | Answered state | `opacity: 0.7; border-width: 1px` |
| `.chat-plan-approval--approved` | Approved modifier | `border-color: var(--green)` |
| `.chat-plan-approval--denied` | Denied modifier | `border-color: var(--red)` |
| `.chat-plan-approval-row` | Compact row | `flex; gap: md; font-size: 12px; cursor: pointer` |

---

## Animations

| Name | Keyframes | Used by |
|---|---|---|
| `slideUp` | `from {opacity:0; transform:translateY(6px)} to {opacity:1; transform:translateY(0)}` | All chat event elements |
| `blink` | `50% {opacity: 0}` | `.chat-cursor` |
| `spin` | `to {transform: rotate(360deg)}` | `.chat-spinner`, `.ssl-status-spinner` |
| `pulse` | (defined globally) | `.ssl-pulse`, `.session-tab-badge` |

---

## View Modes

ChatStream supports multiple view modes, controlled by `event_view` in `.bonsai/settings.json`. The architecture uses a **renderer registry pattern**: pre-scan logic is shared, but each event type delegates to a view-specific renderer component.

**Design:** [compact-event-view-design.md](../../docs/superpowers/specs/2026-04-08-compact-event-view-design.md) | **Task:** [feature_compact_event_view.md](../../.bonsai/implementation_tasks/frontend/feature_compact_event_view.md)

### Architecture

```
ViewModeContext (React context, provided at SessionPanel level)
  └── ChatStream.tsx
      ├── Pre-scan (shared): toolStates, subagentChildren, approvalByToolIndex
      └── renderEvent(mode, event, index, ctx)
            └── viewRendererMap[mode][eventType] ?? viewRendererMap["classic"][eventType]
```

- **`context/ViewModeContext.tsx`** — `ViewMode` type union, context, `useViewMode()` hook
- **`ChatStream/renderers/`** — renderer registry: `types.ts`, `classicRenderer.tsx`, `compactRenderer.tsx`, `registry.ts`
- Classic fallback: unspecified event types in any mode fall back to classic rendering

### Available Modes

| Mode | Setting Value | Description |
|------|---------------|-------------|
| Classic | `"classic"` (default) | Current rendering — cards, full padding, separate approval events |
| Compact | `"compact"` | Log-style lines, 2px padding, 1px gap, inlined approvals, right-aligned user messages |

### Compact Mode Event Rendering

| Event | Compact Rendering |
|-------|-------------------|
| `toolCallStart` (done) | `CompactToolLine`: icon + name + detail + optional approval badge + ✓/✗ |
| `toolCallStart` (running) | Same, blue border, "running..." |
| `confirmAction` (answered) | Suppressed — badge rendered on parent tool's `CompactToolLine` |
| `confirmAction` (pending) | Full card (same as classic `ApprovalCard`) |
| `askUserQuestion` (answered) | Log line: ❓ + "Question" + text + answer badge |
| `askUserQuestion` (pending) | Full card (same as classic `QuestionCard`) |
| `userMessage` | `CompactUserMessage`: right-aligned, "You" inline, single-line, click-to-expand |
| `subagentStart` | Collapsible log header: toggle + ⚡ + type + tool count + status |
| `subagentStart` (expanded) | Nested `CompactToolLine` at 10px font, indented with left border |
| All others | Shared with classic (banners, vis, system messages, etc.) |

### Approval-to-Tool Linking

`confirmAction` events lack `toolUseId`. Pre-scan links them by **sequence + toolName**: when `confirmAction(toolName=X)` appears, it pairs with the next `toolCallStart(toolName=X)`.

```typescript
approvalByToolIndex: Map<number, ApprovalInfo>;  // toolCallStart event index → linked approval
```

---

## Session Context Menu

Right-click on the chat stream opens a `SessionContextMenu` component (fixed-position overlay at click coordinates).

**Items:**

| Item | Condition | Behavior |
|------|-----------|----------|
| Switch to [mode] view | Always | Toggles classic/compact via `settingsStore.updateSettings({ event_view })` |
| Expand all | Always | Dispatches `bonsai:expandAll` CustomEvent on document |
| Collapse all | Always | Dispatches `bonsai:collapseAll` CustomEvent on document |
| Copy transcript | Always | Builds plain-text from events, writes to clipboard |
| Revise answer | Right-click on answered QuestionCard | Sends user message asking agent to re-ask the question |

**Expand/Collapse implementation:** `useExpandCollapse.ts` hook listens for `bonsai:expandAll` / `bonsai:collapseAll` on `document`. Used by ToolCallCard, SubagentBlock, CompactToolLine, CompactSubagent.

**Question detection:** Answered QuestionCard renders `data-question-request-id={requestId}` on its root. `findQuestionRequestId()` walks up from click target to find it.

---

## Not Implemented (Planned)

| Feature | Notes |
|---|---|
| Author labels ("Claude", "You") above bubbles | Not rendered |
| Message concatenation (multiple textDelta → one bubble) | Each textDelta renders its own AssistantMessage |
| `parentToolUseId` precise nesting | Implemented via `agentId`-based grouping — backend resolves SDK `parent_tool_use_id` to `agentId` on all event notifications; frontend groups by `agentId` instead of temporal stack |
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
