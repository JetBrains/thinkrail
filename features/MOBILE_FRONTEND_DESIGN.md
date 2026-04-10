# Mobile Frontend Design Specification

**Status:** Draft
**Date:** 2026-04-10
**Target:** Android (MVP), iOS (future via KMP)

## Overview

A Kotlin Multiplatform mobile application serving as a full remote-control frontend for the Bonsai development platform. Connects to an existing Bonsai backend over LAN or Tailscale VPN, providing complete board management, agent session control, and interactive chat capabilities.

### Goals

- **Full remote control** — First-class frontend, not just monitoring. Create tickets, run sessions, approve actions, send messages.
- **Attention-first UX** — Surface sessions needing user input (approvals, questions) immediately. Minimize time-to-response.
- **Thin client** — No local database. All state fetched from backend on connect. Only connection history persisted locally.
- **KMP from day one** — Shared business logic ready for iOS when the time comes. Android-only build target for MVP.

### Non-Goals (MVP)

- iOS build target (architecture supports it, just not built yet)
- Offline mode or local caching
- Authentication (relies on LAN/Tailscale network security)
- Spec creation/editing (read-only spec viewing)
- Graph visualization

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| UI Framework | Compose Multiplatform | Standard KMP UI, shared across platforms |
| Navigation | Decompose | Component-tree with lifecycle management, true multiplatform |
| State Management | MVIKotlin | Structured MVI pattern, pairs with Decompose |
| Networking | Ktor | KMP WebSocket + HTTP client |
| Serialization | kotlinx.serialization | KMP JSON with snake_case/camelCase support |
| DI | Koin | Lightweight, KMP-native |
| Build | Gradle with version catalog | Standard KMP build system |
| Min SDK | Android API 26 (Android 8.0) | Covers 95%+ of active devices |

---

## Project Structure

```
mobile/
  shared/                              # KMP shared module
    src/commonMain/kotlin/
      dev.aiir.bonsai/
        data/                          # Data layer
          model/                       # Domain models
            Board.kt                   # MetaTicket, MetaTicketSummary, MetaTicketStatus, MetaTicketType
            Session.kt                 # Session, SessionStatus, SessionMetrics, PendingRequest
            Agent.kt                   # AgentConfig, AgentEvent, EventType
            Spec.kt                    # RegistryEntry, SpecDetail, SpecGraph
            Plan.kt                    # Plan, PlanStep, StepStatus
            Settings.kt               # ProjectSettings, ModelInfo
            Connection.kt             # ServerAddress, ProjectInfo
          serialization/               # JSON configuration
            JsonConfig.kt             # snake_case naming, lenient parsing
        network/                       # Network layer
          rpc/                         # WebSocket JSON-RPC client
            RpcClient.kt             # WebSocket connection, request/response, notifications
            JsonRpcProtocol.kt       # Request, Response, Notification message types
            RpcMethods.kt            # Typed method wrappers (board/*, agent/*, session/*, etc.)
          rest/                        # HTTP client
            RestClient.kt            # Health check, project list
          connection/                  # Connection management
            ConnectionManager.kt      # Address parsing, connect/disconnect lifecycle
            ConnectionState.kt        # Sealed class: Disconnected, Connecting, Connected, Error
        component/                     # Decompose components (navigation + logic)
          root/
            RootComponent.kt          # Root: ConnectChild | MainChild
            RootComponentImpl.kt
          connect/
            ConnectComponent.kt       # Server address entry, recent connections
            ConnectComponentImpl.kt
          main/
            MainComponent.kt          # Tab host: Board | Sessions | (drawer items)
            MainComponentImpl.kt
          board/
            BoardComponent.kt         # Both MetaTicket + Task boards
            BoardComponentImpl.kt
          ticket/
            TicketDetailComponent.kt  # Ticket detail with tabs
            TicketDetailComponentImpl.kt
          session/
            SessionListComponent.kt   # Session list with Active | All tabs
            SessionListComponentImpl.kt
            SessionDetailComponent.kt # Full chat view
            SessionDetailComponentImpl.kt
            NewSessionComponent.kt    # Session creation form
            NewSessionComponentImpl.kt
          settings/
            SettingsComponent.kt      # Project settings
            SettingsComponentImpl.kt
          file/
            FileBrowserComponent.kt   # File tree browser
            FileViewerComponent.kt    # File content viewer
        store/                         # MVIKotlin stores
          board/
            BoardStore.kt            # Intent, State, Label for board
            BoardStoreFactory.kt     # Store creation with executor + reducer
          session/
            SessionStore.kt          # Intent, State, Label for sessions
            SessionStoreFactory.kt
          connection/
            ConnectionStore.kt       # Recent connections, current state
            ConnectionStoreFactory.kt
        di/                            # Dependency injection
          AppModule.kt               # Koin module definitions
    src/androidMain/kotlin/
      dev.aiir.bonsai/
        QrScanner.kt                  # ML Kit QR code scanning (expect/actual)
  androidApp/                          # Android app module
    src/main/kotlin/
      dev.aiir.bonsai.android/
        BonsaiApp.kt                  # Application class (Koin init)
        MainActivity.kt              # Single activity (Compose entry)
        ui/
          theme/
            BonsaiTheme.kt           # Material 3 theme (colors, typography)
            Color.kt                 # Color definitions (light + dark)
          screen/
            ConnectScreen.kt         # Connect UI
            BoardScreen.kt           # Kanban board UI
            TicketDetailScreen.kt    # Ticket detail UI
            SessionListScreen.kt     # Session manager UI
            SessionDetailScreen.kt   # Chat UI
            NewSessionScreen.kt      # Session creation UI
            SettingsScreen.kt        # Settings UI
            FileBrowserScreen.kt     # File browser UI
            FileViewerScreen.kt      # File viewer UI
          component/                  # Reusable UI components
            StatusDot.kt             # Session status indicator
            TypeBadge.kt             # Ticket type chip
            ToolCallCard.kt          # Collapsed/expanded tool call
            ApprovalCard.kt          # Approve/deny card
            QuestionCard.kt          # Question with options
            TicketCard.kt            # Board ticket card
            SessionCard.kt           # Session list card
            MarkdownText.kt          # Basic markdown rendering
    src/main/res/                     # Android resources
    AndroidManifest.xml
  build.gradle.kts                    # Root build config
  settings.gradle.kts                 # Module declarations
  gradle/
    libs.versions.toml                # Version catalog
```

---

## Navigation Architecture

### Component Tree (Decompose)

```
RootComponent
├── ConnectChild → ConnectComponent
│   (server address entry, QR scan, recent connections)
│
└── MainChild → MainComponent
    │
    ├── Bottom Tab: Board
    │   └── BoardComponent
    │       ├── MetaTicketBoard (6-column horizontal scroll Kanban)
    │       └── TaskBoard (3-column horizontal scroll Kanban)
    │       └── [overlay] TicketDetailComponent (full-screen on tap)
    │
    ├── Bottom Tab: Sessions
    │   └── SessionListComponent
    │       ├── Active tab (attention-highlighted, sorted to top)
    │       └── All tab (full history)
    │       └── [push] SessionDetailComponent (chat view)
    │       └── [overlay] NewSessionComponent (full-screen form)
    │
    └── Drawer Items:
        ├── Specs → SpecListComponent (read-only spec browser)
        ├── Files → FileBrowserComponent → FileViewerComponent
        ├── Trash → TrashComponent
        └── Settings → SettingsComponent
```

### Navigation Pattern: Hybrid

**Bottom tabs** (always visible):
- **Board** — Primary: ticket management
- **Sessions** — Primary: agent interaction

**Navigation drawer** (hamburger ☰):
- **Board** — Same as bottom tab (mirrored)
- **Sessions** — Same as bottom tab (mirrored)
- **Specs** — Read-only spec browser (from registry)
- **Files** — Project file browser + viewer
- **Trash** — Deleted items management
- **Settings** — Project settings, model selection
- Drawer header: project name + connection status + server address

**FAB (+)**: Context-aware floating action button
- On Board tab → Create new ticket
- On Sessions tab → Create new session

---

## Screen Designs

### 1. Connect Screen

**Purpose:** First screen on launch. Enter server address or select from recent connections.

**Layout:**
- Centered Bonsai logo + title
- **First launch:** Address input field (`http://IP:PORT`), Connect button, QR scan button, help text
- **Returning user:** Recent connections list (project name, address, last connected time, reachability dot), compact address input + QR below

**Connection flow:**
1. User enters address or taps recent connection or scans QR code
2. App performs HTTP health check (`GET /api/health`)
3. If server reachable, fetch project list (`GET /api/project/list`)
4. If single project → connect WebSocket directly
5. If multiple projects → show project picker dialog
6. On WebSocket connect → navigate to MainComponent, save connection to recents
7. On failure → inline error with retry button

**QR Code format:** `bonsai://ADDRESS:PORT/PATH` — parsed by `ConnectionManager`

**Local persistence:** Recent connections stored in `SharedPreferences` (address, project path, display name, last connected timestamp).

### 2. Board Screen

**Purpose:** Kanban board for MetaTickets and Tasks.

**Layout:**
- **Toggle switch** at top: "Tickets" | "Tasks" (segmented control)
- **Horizontal scroll** between status columns (Trello-style)
- Column headers: scrollable row showing column name + count, active column highlighted
- Cards within each column scroll vertically

**MetaTicket Board columns:** Idea → Described → Specified → Planned → Executing → Done

**Task Board columns:** Pending → Active → Done

**Ticket card content:**
- Title (bold)
- Type badge (feature/bug/idea/improvement with color)
- Linked specs count + session count (small text)

**Interactions:**
- **Tap card** → Open TicketDetailComponent (full-screen overlay)
- **Long-press** → Context menu: change status, change type, edit, delete
- **Swipe card** → Quick status change (move to next/previous column)
- **FAB (+)** → Create ticket dialog (title, type selector, optional body)

### 3. Ticket Detail Screen

**Purpose:** Full ticket view and management.

**Layout:**
- Header: ticket title, type badge, status badge, overflow menu (⋮)
- Scrollable tabs: Description | Specs (N) | Plan | Sessions (N)

**Description tab:**
- Progress bar (plan step completion: X/Y steps)
- Rendered markdown body
- Success criteria with checkmarks

**Specs tab:**
- List of linked specs with type badge and status
- Tap spec → read-only markdown viewer

**Plan tab:**
- Vertical step timeline with status icons
  - ✓ (green) = done, with linked session ID
  - ⟳ (orange) = in progress
  - Numbered circle (gray) = pending
- Tap step → jump to linked session

**Sessions tab:**
- List of sessions attached to this ticket
- Tap → open session chat

**Actions (overflow menu):**
- Edit title / description
- Change status (valid transitions enforced)
- Change type
- Start new session for ticket
- Delete ticket

### 4. Session List Screen

**Purpose:** Manage all agent sessions. Surface attention-needed sessions prominently.

**Layout:**
- **Tabs:** Active (`!!N / M`) | All
  - `!!N` = attention-needed count (orange), `M` = total active count
- Session cards in a vertical list

**Active tab behavior:**
- Shows running, idle, and waiting sessions
- Sessions needing attention (status = `waiting` with `pendingRequest`) auto-sort to top
- Attention sessions have highlighted background (orange for approvals, blue for questions) and **inline action buttons**:
  - Approval: shows tool name + file path + Approve/Deny buttons
  - Question: shows question text + answer option chips
- Regular active sessions shown below with standard card layout

**All tab:**
- Full session history (all statuses)
- Terminal sessions (done/error) shown at reduced opacity
- Sorted by most recently updated

**Session card content:**
- Status dot (green=running, orange=waiting, gray=done/idle, red=error)
- Session name
- Status text + model + turn count + cost
- Time since last activity

**Interactions:**
- **Tap card** → Open SessionDetailComponent (chat view)
- **Overflow menu (⋮)** → Continue, Stop, Delete
- **Inline approve/deny** → Responds directly via `agent/respond` without entering chat
- **FAB (+)** → Open NewSessionComponent

### 5. New Session Screen

**Purpose:** Configure and launch a new agent session.

**Layout:** Full-screen form with Close (✕) button and Start button in header.

**Fields:**
- **Name** (optional) — Text input
- **Skill** — Dropdown selector (fetched from available skills)
- **Specs** — Multi-select with chip display, searchable spec picker from registry
- **Files** — Multi-select file paths, browsable file picker
- **Model** — Dropdown (fetched from `models/list`); defaults to first available model, not hardcoded
- **Permission Mode** — Chip selector: default | auto | accept-edits | yolo
- **Effort** — Chip selector: low | med | high | max | auto (`null` = auto per backend contract)
- **Linked Ticket** — Optional dropdown to link to a board ticket
- **Initial Prompt** — Multi-line text input

**Creation flow:**
1. Fill fields → tap "Start"
2. App calls `agent/prepare` → creates draft session
3. Shows confirmation dialog: system prompt preview, total token count, section breakdown
4. User confirms → calls `agent/startDraft` with initial prompt
5. Navigate to SessionDetailComponent (chat view)

### 6. Session Detail Screen (Chat)

**Purpose:** Full agent conversation with streaming, tool calls, and interactive approvals.

**Layout:**
- **Header:** Back arrow, session name, status dot + status text + model, overflow menu (⋮)
- **Message stream:** Scrollable list of events
- **Input bar:** Message text field + interrupt/send button

**Message types rendered:**
- **User message** — Green-tinted bubble, right-aligned or labeled "You"
- **Assistant message** — Neutral bubble, labeled "Claude"
- **Tool call (collapsed)** — Compact row: icon + tool name + file path + status (✓/⟳/✕). Tap to expand.
- **Tool call (expanded)** — Full input JSON + output, syntax highlighted, scrollable
- **Approval card** — Pinned above input when active. Shows: tool name, target file, collapsible diff preview (+N/-N lines), Approve/Deny buttons. Input disabled until resolved.
- **Question card** — Pinned above input. Shows question text + option chips or text input field.
- **Streaming indicator** — Pulsing dots while assistant is generating text. Active tool call shows ⟳ spinner.

**Interactions:**
- **Send message** — Type in input bar, tap send (or Enter). Calls `agent/send`. Disabled when session is running or waiting.
- **Interrupt** — Pause button in input bar while session is running. Calls `agent/interrupt`.
- **Approve/Deny** — Buttons on approval card. Calls `agent/respond`.
- **Answer question** — Tap option chip or type custom answer. Calls `agent/respond`.
- **Expand tool call** — Tap collapsed tool call card to see full input/output.
- **Overflow menu (⋮)** — Change model, change permissions, change effort, view metrics, interrupt, end session.

**Streaming behavior:**
- Text arrives via `agent/textDelta` notifications → appended to current assistant message bubble in real-time
- Tool calls arrive via `agent/toolCallStart` / `agent/toolCallEnd` → tool call cards appear/complete in stream
- `agent/turnComplete` → session returns to idle, input enabled

### 7. Settings Screen

**Purpose:** Project settings and connection management.

**Sections:**
- **Connection** — Current server address, project path, disconnect button
- **Models** — Default model selector (from `models/list`), refresh button
- **Display** — Theme toggle (light/dark/system), font size
- **About** — App version, backend version

### 8. File Browser & Viewer

**Purpose:** Browse project files, view content, and edit files.

**File browser:** Tree view of project directory. Accessible from drawer. Tap file to open viewer.

**File viewer / editor:**
- **View mode** (default): Syntax-highlighted read-only view of file content
- **Edit mode** (tap pencil icon): Editable text area with basic syntax highlighting. Save button writes changes back via `file/write` RPC method.
- **Agent edits:** When an agent writes/edits a file during a session, the diff is shown in the chat tool call card. Tap to view full file in the file viewer.

**Interactions:**
- **Tap file in browser** → opens file viewer (read-only)
- **Tap pencil icon** → switches to edit mode
- **Save** → writes file via backend RPC, shows success/error toast
- **Tap tool call diff in chat** → opens affected file in viewer

---

## Data Flow

### Connection Lifecycle

```
App Launch
  → ConnectComponent
  → User enters address / taps recent / scans QR
  → ConnectionManager.connect(address, projectPath)
    → RestClient.healthCheck(address)        # GET /api/health
    → RestClient.listProjects(address)       # GET /api/project/list (if needed)
    → RpcClient.connect(address, projectPath) # WebSocket /ws?project=PATH
  → On connected:
    → BoardStore dispatches LoadTickets      # board/list
    → SessionStore dispatches LoadSessions   # session/list
    → SettingsStore dispatches LoadSettings  # settings/get, models/list
    → RpcClient subscribes to notifications
  → Navigate to MainComponent
```

### RPC Method Mapping

| Mobile Action | RPC Method | Direction |
|--------------|-----------|-----------|
| Load board | `board/list` | request |
| Create ticket | `board/create` | request |
| Move ticket | `board/reorder` | request |
| Update ticket | `board/update` | request |
| Delete ticket | `board/delete` | request |
| Get ticket detail | `board/get` | request |
| Get plan | `board/getPlan` | request |
| List sessions | `session/list` | request |
| Get session events | `session/get` | request |
| Create session (draft) | `agent/prepare` | request |
| Start session | `agent/startDraft` | request |
| Quick-start session | `agent/run` | request |
| Send message | `agent/send` | request |
| Respond to approval/question | `agent/respond` | request |
| Interrupt session | `agent/interrupt` | request |
| End session | `agent/end` | request |
| Continue session | `session/continue` | request |
| Delete session | `session/delete` | request |
| Update session config | `agent/updateConfig` | request |
| Load specs | `spec/list` | request |
| Get spec content | `spec/get` | request |
| Load settings | `settings/get` | request |
| Update settings | `settings/update` | request |
| List models | `models/list` | request |
| Board changed | `board/didChange` | notification |
| Board created | `board/didCreate` | notification |
| Board deleted | `board/didDelete` | notification |
| Agent text delta | `agent/textDelta` | notification |
| Tool call start | `agent/toolCallStart` | notification |
| Tool call end | `agent/toolCallEnd` | notification |
| Turn complete | `agent/turnComplete` | notification |
| Session done | `agent/done` | notification |
| Session error | `agent/error` | notification |
| Ask user question | `agent/askUserQuestion` | server-request |
| Confirm action | `agent/confirmAction` | server-request |
| Suggest session | `agent/suggestSession` | server-request |

### MVI State Flow (per store)

```
User Action (UI)
  → Intent (sealed class)
  → Executor (processes intent, may call RPC, emits Messages)
  → Reducer (Message + State → new State)
  → State (immutable data class, observed by Compose UI)

RPC Notification
  → Store.accept(Intent.OnNotification(...))
  → Same flow as above
```

---

## Backend Requirements

The existing backend needs minimal changes for mobile support:

### New REST Endpoints (Required)

1. **`GET /api/health`** — Simple health check returning `{"status": "ok", "version": "..."}`. For mobile connection validation.

2. **`GET /api/project/list`** — Returns list of available projects (directories containing `.bonsai/registry.json`). For multi-project server support.

### New RPC Methods (Required for File Editing)

3. **`file/tree`** — Returns project file tree structure. For mobile file browser.

4. **`file/read`** `{path: string}` — Returns file content as string. For mobile file viewer.

5. **`file/write`** `{path: string, content: string}` — Writes file content. For mobile file editing. Returns success/error.

### Optional Future Endpoints

6. **`GET /api/connect/qr?project=PATH`** — Returns QR code image encoding `bonsai://HOST:PORT/PATH` URI. For easy mobile connection.

### Existing API Compatibility

All existing WebSocket RPC methods and notification patterns are fully compatible with mobile. No changes needed to the JSON-RPC protocol.

---

## Android-Specific Concerns

### Background WebSocket

- Use **Foreground Service** with notification to maintain WebSocket connection when app is backgrounded
- Service shows: "Connected to {project} on {address}"
- Reconnect with exponential backoff: 1s, 2s, 4s, 8s, max 30s

### Disconnect & Reconnect Behavior

When the WebSocket connection drops mid-session:
1. `ConnectionState` transitions to `Error` with message
2. `RpcClient` auto-reconnects with exponential backoff (up to 30s)
3. On reconnect, `SessionDetailComponent` re-fetches session via `session/get` to replay any missed events
4. All pending RPC calls fail immediately with `RpcException` — callers show error in UI
5. Subagent rendering is limited to **3 levels of nesting** in the UI to prevent deeply-nested layouts

### Push Notifications

- When session enters `waiting` state and app is in background:
  - Show Android notification: "Session '{name}' needs your attention"
  - Tap notification → opens app directly to that session's chat/approval
- Notification channels: "Session Alerts" (high priority), "Connection Status" (low priority)

### QR Code Scanning

- Use ML Kit Barcode Scanning API (Android)
- `expect/actual` pattern for KMP: `expect fun scanQrCode(): Flow<String>` in commonMain, Android implementation uses ML Kit

---

## Theme

Material 3 with custom Bonsai colors:

### Color Palette
- **Primary:** Green (#4CAF50) — brand color, active states, FAB
- **On Primary:** White
- **Surface:** Adaptive (light: white, dark: #1a1a2e)
- **Status colors:**
  - Running/Idle: Green (#4CAF50)
  - Waiting/Attention: Orange (#FFB74D)
  - Question: Blue (#64B5F6)
  - Error: Red (#ff6464)
  - Done: Gray (#888)
- **Type badge colors:**
  - Feature: Green
  - Bug: Red
  - Improvement: Blue (#6464ff)
  - Idea: Gold (#FFB74D)

### Typography
- Material 3 default type scale
- Monospace font for code/file content (JetBrains Mono or system monospace)

### Dark/Light Mode
- Follow system setting by default
- Manual override available in Settings

---

## Verification Plan

### Manual Testing Checklist

1. **Connection:**
   - [ ] Connect to backend via LAN IP
   - [ ] Connect via Tailscale IP
   - [ ] QR code scanning connects successfully
   - [ ] Recent connections saved and tappable
   - [ ] Reconnect after connection drop

2. **Board:**
   - [ ] MetaTicket board loads with correct columns
   - [ ] Task board loads with correct columns
   - [ ] Horizontal scroll between columns works
   - [ ] Create ticket via FAB
   - [ ] Tap ticket opens detail
   - [ ] Long-press shows context menu
   - [ ] Status change moves ticket to correct column

3. **Ticket Detail:**
   - [ ] All tabs load (Description, Specs, Plan, Sessions)
   - [ ] Plan timeline shows correct step states
   - [ ] Edit title/description works
   - [ ] Change status via overflow menu

4. **Sessions:**
   - [ ] Session list loads with correct statuses
   - [ ] Active tab shows attention items on top
   - [ ] `!!N / M` badge updates in real-time
   - [ ] Inline approve/deny works from list
   - [ ] Inline question answers work from list
   - [ ] New session form includes all fields (name, skill, specs, files, model, permission, effort, ticket)
   - [ ] Draft preview shows token count
   - [ ] Session creation → chat view transition

5. **Chat:**
   - [ ] Text streaming works in real-time
   - [ ] Tool calls render collapsed, expand on tap
   - [ ] Approval card appears with approve/deny
   - [ ] Question card appears with options
   - [ ] Send message works
   - [ ] Interrupt button stops running session
   - [ ] Overflow menu: change model, permissions, effort

6. **Files:**
   - [ ] File browser shows project tree
   - [ ] Tap file opens viewer with syntax highlighting
   - [ ] Edit mode enables text editing
   - [ ] Save writes changes back via RPC
   - [ ] Agent file diffs in chat are tappable to view file

7. **Background:**
   - [ ] WebSocket stays connected when app backgrounded
   - [ ] Android notification appears for waiting sessions
   - [ ] Tap notification opens correct session
