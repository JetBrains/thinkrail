# Chat UI Rendering — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §3 | Status: **Active** | Created: 2026-02-27

## Overview

The Chat UI is the center panel's primary content area. It renders a scrolling stream of visual elements derived from JSON-RPC agent event notifications. Each event type maps to a distinct React component with specific rendering rules, interaction behaviors, and state transitions.

## Component Hierarchy

```
<SessionPanel>                         // one per session tab
  <SessionHeader />                    // skill badge, name, status, spec chips
  <ChatStream>                         // scrollable message list
    <SystemMessage />                  // agent/notification, session start
    <AssistantMessage />               // agent/textDelta
    <UserMessage />                    // user-submitted text
    <ToolCallCard />                   // agent/toolCallStart + toolCallEnd
    <SubagentBlock>                    // agent/subagentStart + subagentEnd
      <ToolCallCard /> ...             // nested tool calls within subagent
    </SubagentBlock>
    <QuestionCard />                   // agent/askUserQuestion
    <ApprovalCard />                   // agent/confirmAction
    <CompletionBanner />               // agent/done
    <ErrorBanner />                    // agent/error
    <CompactMarker />                  // agent/compact
    <PermissionDeniedBanner />         // agent/permissionDenied
  </ChatStream>
  <SessionStatusLine />                // model, cost, progress, context bar
  <InputArea />                        // textarea + send button
</SessionPanel>
```

## Event-to-Component Mapping

### 1. `agent/sessionStart`

**Params:** `{ taskId, sessionId, model, tools[], cwd, permissionMode }`

**Rendering:** `<SystemMessage>` with session info.

```
┌─────────────────────────────────────────────────────────┐
│  Session started — module-design · claude-opus-4-6      │
│  12 tools available · permission: default               │
└─────────────────────────────────────────────────────────┘
```

- Centered, italic, muted color (`--hint`)
- Green color variant (`.ok`)
- Populates `<SessionStatusLine>` with model name
- Non-interactive

---

### 2. `agent/textDelta`

**Params:** `{ taskId, sessionId, text, streaming }`

**Rendering:** `<AssistantMessage>` — Claude's text response.

**Streaming behavior:**
- When `streaming: true` — text is appended character-by-character to the current `<AssistantMessage>` bubble. A blinking cursor `▊` is shown at the end.
- When `streaming: false` — the full text block is rendered at once (non-streaming mode).
- Multiple consecutive `textDelta` events with `streaming: true` are concatenated into the same bubble.
- A new `<AssistantMessage>` starts when:
  - A non-textDelta event arrives between text events
  - A new turn begins (after user message or tool result)

**Markdown rendering:**
- Render `text` as GitHub-Flavored Markdown
- **Inline code** — `code` styled with `--cyan` on `--elevated` background
- **Code blocks** — syntax-highlighted with language detection. Monospace font, `--elevated` background, rounded border, horizontal scroll if overflow.
- **Bold** — `--text` color (brighter than surrounding `--muted`)
- **Links** — `--blue` color, underline on hover
- **Lists** — standard indentation, bullet/number styling
- **Tables** — bordered, `--border` color, alternating row background
- **Headings** — not typically in agent responses, but render if present

**Layout:**
```
  Claude                                    ← author label (--purple, 10px)
  ┌──────────────────────────────────────┐
  │ I'll implement the **Spec Module**   │  ← bubble (--panel bg, left-aligned)
  │ based on the specification in        │
  │ `backend/app/spec/README.md`.        │
  └──────────────────────────────────────┘
```

- Left-aligned bubble, max-width 90%
- Border-radius: `10px 10px 10px 2px` (tail bottom-left)
- Entrance animation: `slideUp` (0.22s ease-out)

---

### 3. User Messages

**Source:** User input via `<InputArea>` — sent as `agent/respond` or direct text.

**Rendering:** `<UserMessage>` — right-aligned bubble.

```
                                    You  ← author label (--hint, 10px)
  ┌──────────────────────────────────────┐
  │              Markdown first. Go ahead.│  ← bubble (--elevated bg)
  └──────────────────────────────────────┘
```

- Right-aligned, max-width 85%
- Border-radius: `10px 10px 2px 10px` (tail bottom-right)
- `--text` color (brighter than Claude's `--muted`)

---

### 4. `agent/toolCallStart` + `agent/toolCallEnd`

**Start params:** `{ taskId, sessionId, toolUseId, toolName, toolInput, parentToolUseId? }`
**End params:** `{ taskId, sessionId, toolUseId, toolName, output, isError }`

**Rendering:** `<ToolCallCard>` — a collapsible card that transitions through states.

**States:**

| State | Border color | Status text | Body |
| --- | --- | --- | --- |
| Running | `--blue` | `● running...` (animated) | Hidden (collapsed) |
| Success | `--green` | `✓ done` | Output (collapsed by default, expandable) |
| Error | `--red` | `✕ error` | Error output (expanded by default) |

**Layout:**
```
  ┃ 📖 Read  backend/app/spec/README.md       ✓ done  ← header (clickable)
  ┃─────────────────────────────────────────────────────
  ┃ Module spec content (148 lines)...                  ← body (toggle)
```

- Left border: 3px colored stripe indicating state
- **Header** — always visible. Contains:
  - Tool icon (mapped by tool name, see §Tool Icons)
  - Tool name (`--cyan`, bold)
  - Tool input summary (first arg or file path, `--muted`, 10px, truncated)
  - Status indicator (right-aligned)
- **Body** — toggle on header click
  - For `Read` / `Grep` / `Glob`: show output as monospace text, max-height 120px with scroll
  - For `Write` / `Edit`: show file path and snippet of content
  - For `Bash`: show command and output
  - Truncate long outputs to 50 lines with "Show more" link
- **Collapsing behavior:**
  - Running: body hidden
  - Success: body hidden by default (click header to expand)
  - Error: body expanded by default
- Max-width: 90% of chat area

**Tool Icons:**

| Tool Name | Icon |
| --- | --- |
| `Read` | 📖 |
| `Write` | ✏️ |
| `Edit` | ✏️ |
| `Bash` | ▶ |
| `Grep` | 🔍 |
| `Glob` | 📂 |
| `WebSearch` | 🌐 |
| `WebFetch` | 🌐 |
| `Task` | ⚡ |
| `TodoWrite` | ✅ |
| `AskUserQuestion` | ❓ |
| `NotebookEdit` | 📓 |
| Other | 🔧 |

**`parentToolUseId` handling:**
- If `parentToolUseId` is set, this tool call was initiated by a subagent. Render it indented inside the parent `<SubagentBlock>`.

---

### 5. `agent/subagentStart` + `agent/subagentEnd`

**Start params:** `{ taskId, sessionId, agentId, agentType, parentToolUseId }`
**End params:** `{ taskId, sessionId, agentId }`

**Rendering:** `<SubagentBlock>` — a visually indented section grouping nested events.

**Running state:**
```
  ┃ ⚡ Subagent: Explore — searching codebase    [spinner]
  ┃   ┃ 🔍 Grep  "class.*BaseModel"              ✓ 3 matches
  ┃   ┃ 📖 Read  backend/app/spec/models.py       ✓ done
```

**Completed state:**
```
  ┃ ⚡ Subagent: Explore                          ✓ done
  ┃   [collapsed — click to expand]
```

- Left border: 2px `--purple` line
- Indent: 12px margin-left, 12px padding-left
- Header: agent type name, `--purple` color, bold
- Running indicator: CSS spinner (10px, `--purple` border, 0.8s rotation)
- On `subagentEnd`: collapse child tool calls, show summary ("N tool calls, done")
- Child events (tool calls) between `subagentStart` and `subagentEnd` render indented inside this block

---

### 6. `agent/askUserQuestion`

**Params:** `{ taskId, requestId, questions[] }`
**Each question:** `{ question, header, options[], multiSelect }`
**Each option:** `{ label, description, markdown? }`

**Rendering:** `<QuestionCard>` — interactive card requiring user response.

```
  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  ← purple border (2px)
  │ APPROACH                               │  ← header (9px, uppercase)
  │                                        │
  │ Which format should I prioritize?      │  ← question (12px, bold)
  │                                        │
  │ ┌────────────────────────────────────┐ │
  │ │ ● Markdown first (Recommended)    │ │  ← selected option
  │ │   All existing specs are Markdown. │ │
  │ └────────────────────────────────────┘ │
  │ ┌────────────────────────────────────┐ │
  │ │ ○ JSON first                      │ │  ← unselected option
  │ │   Simpler to parse.               │ │
  │ └────────────────────────────────────┘ │
  │                                        │
  │            [Submit]  [Skip]            │  ← action buttons
  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

**Interaction:**
- Options are clickable. Single-select: radio behavior. Multi-select: checkbox behavior.
- Selected option: `--purple` border, subtle purple background tint
- Hover: `--purple` border, lighter tint
- "Submit" button — sends `agent/respond` with `{ answers: { [questionText]: selectedLabel } }`
- "Skip" / "Other" — opens the text input for a custom answer
- **After response:** card becomes non-interactive, shows the chosen answer with a check mark
- **Multiple questions:** render each question as a section within the card

**Pending state:**
- While waiting for user response, the card pulses gently
- The input area below shows "Answer the question above or type a response..."

---

### 7. `agent/confirmAction`

**Params:** `{ taskId, requestId, toolName, toolInput, description }`

**Rendering:** `<ApprovalCard>` — confirmation prompt for tool execution.

```
  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  ← gold border (2px)
  │ ⚠ Action requires approval            │  ← title (gold, bold)
  │                                        │
  │ Bash: pip install markdown-it-py       │  ← tool + input (cyan)
  │ Install Markdown parsing dependency    │  ← description (muted)
  │                                        │
  │    [✓ Approve]    [✕ Deny]            │  ← action buttons
  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

**Interaction:**
- "Approve" — green button, sends `agent/respond` with `{ decision: "approve" }`
- "Deny" — red outline button, sends `agent/respond` with `{ decision: "deny" }`
- After response: card becomes non-interactive, shows "✓ Approved" or "✕ Denied"
- **Tool input display:** for `Bash`, show the command. For `Write`/`Edit`, show the file path. For others, show a summary.

---

### 8. `agent/done`

**Params:** `{ taskId, sessionId, result, costUsd, turns, durationMs, usage }`

**Rendering:** `<CompletionBanner>` — session success indicator.

```
  ┌──────────────────────────────────────────────────────┐
  │ ✓ Session complete                $0.12 · 8t · 45s  │  ← green border
  └──────────────────────────────────────────────────────┘
```

- Green background tint, green border
- Left: check mark + "Session complete"
- Right: cost, turn count, duration (formatted)
- Updates `<SessionStatusLine>` final values
- Sets session tab status dot to blue (done)
- Disables `<InputArea>` (session is finished)

---

### 9. `agent/error`

**Params:** `{ taskId, sessionId, subtype, errors[] }`

**Rendering:** `<ErrorBanner>` — session error indicator.

```
  ┌──────────────────────────────────────────────────────┐
  │ ✕ Session error: max_turns_reached                   │  ← red border
  │   Exceeded maximum turn limit (50)                   │
  └──────────────────────────────────────────────────────┘
```

- Red background tint, red border
- Shows error subtype and first error message
- Expandable to show full error details if multiple errors
- Sets session tab status dot to red (error)

**Error subtypes:** `max_turns_reached`, `tool_error`, `api_error`, `context_overflow`, `user_interrupt`, `permission_denied`

---

### 10. `agent/notification`

**Params:** `{ taskId, sessionId, message, title? }`

**Rendering:** `<SystemMessage>` — subtle inline notification.

```
                    ℹ Searching for patterns...
```

- Centered, italic, `--hint` color, 10px
- If `title` present: show as bold prefix
- Non-interactive
- No bubble — plain text in the stream

---

### 11. `agent/compact`

**Params:** `{ taskId, sessionId, trigger, preTokens }`

**Rendering:** `<CompactMarker>` — context boundary indicator.

```
  ─ ─ ─ context compacted — 145k tokens ─ ─ ─
```

- Dashed border top and bottom
- Centered text, `--hint` color, 9px
- Shows pre-compaction token count
- Updates context bar in `<SessionStatusLine>`

---

### 12. `agent/permissionDenied`

**Params:** `{ taskId, sessionId, toolName, toolInput }`

**Rendering:** `<PermissionDeniedBanner>` — warning about denied tool.

```
  ┌──────────────────────────────────────────────────────┐
  │ ⚠ Permission denied: Bash                            │  ← gold border
  │   rm -rf /tmp/test-data                              │
  └──────────────────────────────────────────────────────┘
```

- Gold background tint, gold border
- Shows tool name and input that was denied
- Non-interactive (informational only)

---

### 13. `agent/progress`

**Params:** `{ taskId, sessionId, status, message }`

**Rendering:** Updates `<SessionStatusLine>` progress bar and status text. Does not create a visible element in the chat stream.

## Chat Stream Behavior

### Auto-scroll
- Chat auto-scrolls to bottom when new messages arrive
- Auto-scroll pauses if user has scrolled up (> 50px from bottom)
- "Jump to bottom" button appears when auto-scroll is paused
- Auto-scroll resumes when user clicks "Jump to bottom" or scrolls to bottom manually

### Message grouping
- Consecutive tool calls (without intervening text) are grouped visually with reduced gap (4px instead of 12px)
- System messages have reduced gap (2px)

### Entrance animations
- All new elements: `slideUp` animation (0.22s ease-out) — translate Y from 6px to 0, opacity 0 to 1
- Streaming text: no animation per character, only on initial bubble appearance

### Maximum content sizes
| Element | Max width | Max height |
| --- | --- | --- |
| Assistant bubble | 90% | unlimited (scrolls within chat) |
| User bubble | 85% | unlimited |
| Tool card body | 90% | 120px (scroll), expandable |
| Question card | 90% | unlimited |
| Approval card | 90% | unlimited |
| Code blocks (in markdown) | 100% of bubble | 300px (scroll) |

## Session Status Line

Compact strip between chat and input area. Always visible per session.

```
┌──────────────────────────────────────────────────────────────────────┐
│ claude-opus-4-6 │ $0.08 │ ██████░░ 12 calls │ ctx 45k/200k ██░░░░ │
└──────────────────────────────────────────────────────────────────────┘
```

### Data sources and update triggers

| Element | Source event | Update logic |
| --- | --- | --- |
| Model | `agent/sessionStart` → `model` | Set once on session start |
| Cost | `agent/done` → `costUsd`; estimated during run from `agent/toolCallEnd` count | Increment estimate per tool call; finalize on done |
| Progress bar | `agent/toolCallEnd` count / estimated total | Fill increases with each tool call; animated pulse while running |
| Tool calls | `agent/toolCallEnd` count | Increment on each toolCallEnd |
| Context bar | `agent/compact` → `preTokens`; `agent/sessionStart` → infer from model | Set max from model (e.g., 200k for opus). Update used on compact events. |

### Context bar color thresholds
| Usage | Color |
| --- | --- |
| < 50% | `--green` |
| 50-80% | `--gold` |
| > 80% | `--red` |

## Input Area

### States

| State | Placeholder | Behavior |
| --- | --- | --- |
| **Ready** | "Message Claude..." | Normal text input, Cmd+Enter to send |
| **Waiting for question** | "Answer the question above or type a response..." | Question card is visible above; typing submits as custom answer |
| **Waiting for approval** | "Waiting for your approval above..." | Input disabled; approval card buttons are the only way to respond |
| **Session done** | "Session complete" | Input disabled, send button disabled |
| **Session error** | "Session ended with error" | Input disabled |

### Send behavior
- `Cmd+Enter` submits the message
- Empty messages are not sent
- After sending, textarea clears and auto-focuses
- While agent is streaming a response, user can still type but sending queues the message until the current turn completes

## Theming Integration

All colors use CSS custom properties from the root theme. Components do not hardcode colors.

| Semantic | Variable | Default |
| --- | --- | --- |
| Assistant bubble bg | `--panel` | `#1a1b26` |
| User bubble bg | `--elevated` | `#24283b` |
| Tool card bg | `--elevated` | `#24283b` |
| Author label (Claude) | `--purple` | `#bb9af7` |
| Author label (You) | `--hint` | `#565f89` |
| Tool name | `--cyan` | `#7dcfff` |
| Inline code | `--cyan` on `--elevated` | |
| Success indicators | `--green` | `#9ece6a` |
| Error indicators | `--red` | `#f7768e` |
| Warning indicators | `--gold` | `#e0af68` |
| Interactive borders | `--purple` | `#bb9af7` |

## Performance Considerations

- **Virtualization:** For sessions with 100+ messages, use virtual scrolling (e.g., `react-virtuoso`) to only render visible messages in the DOM.
- **Streaming debounce:** Batch `agent/textDelta` events at 16ms intervals (one animation frame) to prevent excessive re-renders during fast streaming.
- **Markdown memoization:** Memoize rendered markdown output keyed by raw text content. Only re-render when text changes.
- **Tool card lazy expansion:** Tool card bodies are not rendered until expanded. Output content is stored in state but only mounted to DOM on expand.

## Accessibility

- All interactive elements (options, buttons) are keyboard-navigable (Tab, Enter, Space)
- Tool card expand/collapse uses `aria-expanded`
- Question options use `role="radio"` / `role="checkbox"` depending on `multiSelect`
- Status changes (done, error) announced via `aria-live="polite"` region
- Color indicators always paired with text/icon (not color-only)

## Known Limitations

- **No message editing:** Users cannot edit previously sent messages
- **No message search:** No Ctrl+F search within chat history (only browser-native search)
- **Streaming text only forward:** Cannot replay or slow down streaming — text appears at the speed the backend sends it

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §3
- **Depends on:** [RPC Module](../../backend/app/rpc/README.md) (agent events), [API Client](../src/api/README.md) (event subscriptions)
- **Related:** [Session History](SESSION_HISTORY.md) (read-only replay), [Notification System](NOTIFICATION_SYSTEM.md) (background alerts)
