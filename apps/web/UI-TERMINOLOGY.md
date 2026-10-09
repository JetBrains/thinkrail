# ThinkRail UI Terminology Reference

A canonical vocabulary for the ThinkRail web UI (`apps/web`), for use by the designer, ChatGPT, and the
pi agent in design discussions.

**Scope & rules for this document:**

- **Frontend only.** Documents `apps/web` as it is implemented today — the single source of truth.
- **Descriptive, not prescriptive.** No redesign, no suggestions, no invented names. Where the codebase
  has no clear name or the naming is inconsistent, that is called out explicitly with a
  **⚠ Naming note**.
- Every region lists, where applicable: **canonical name** (the heading), **implementation name** (the
  React component / file), **`data-testid`** hook (the app's stable identity anchors), **parent**,
  **children**, **position**, and **responsibility**.
- The active-workspace layout projects this window's frontend-local frame and workspace view into a desktop workbench with recursive center groups and movable side groups. The mobile single-view shell is designed but not yet built.

The document proceeds top-down: Application Layout → each region → shared primitives → glossary.

---

# Application Layout

The whole app is composed by one root component and splits into a fixed top bar over a body that has two
mutually-exclusive states.

- **App Shell** — the root frame (`Shell`).
  - **Top Bar** (`<header>`) — always present.
  - **Body** — one of two states:
    - **Workspace Workbench** — the projection of this window's local frame and active workspace view.
    - **Welcome Layout** — the projects rail beside the Welcome screen when no workspace is active.
  - **Toaster** — app-wide notification host, mounted once over either state.

| Canonical name | Implementation | `data-testid` | Notes |
|---|---|---|---|
| App Shell | `shell/Shell.tsx` → `Shell` | `shell` | Composition root; owns the theme DOM side-effect + global hotkeys |
| Top Bar | `<header>` inside `Shell` | — | ⚠ Naming note below |
| Workspace Workbench | `shell/WorkspaceWorkbench.tsx` + `shell/layout/Workbench.tsx` | `workbench` | One window-local frame; workspace-specific resource projection |
| Welcome Layout | `ResizablePanelGroup` (`autoSaveId="thinkrail-shell-welcome"`) | — | Projects rail + Welcome |
| Toaster | `panels/Toaster.tsx` → `Toaster` | — | See Shared Primitives |

**⚠ Naming note (Top Bar):** the code has no component or named prop for the header — it is an inline
`<header>` element in `Shell.tsx`. This reference calls it the **Top Bar**. Do not confuse it with the
**Chat Header** (a per-chat-tab bar) or a **Group Header** (a workbench tab strip).

---

# Top Bar

The application-wide bar across the very top. It is layout-agnostic (present in both body states).

- **Parent:** App Shell.
- **Position:** Full width, top; fixed row above the body (`grid-rows-[auto_1fr]`).
- **Implementation:** inline `<header>` in `shell/Shell.tsx`.

Children (left → right):

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Logo | `<BrandLogo />` (the supplied full vector artwork) | `brand-logo` | The theme-aware ThinkRail brand mark |
| Scope Context | inline block in `Shell.tsx` | `scope-context` | Persistent location breadcrumb; two lines when a workspace is active |
| — Scope Project | inline `<span>` | `scope-project` | Owning project name |
| — Scope Name | inline `<span>` | `scope-name` | Active workspace display name, or `"Project home"` |
| — Scope Branch | inline `<span>` | `scope-branch` | Git branch of the active workspace |
| — Scope Base | inline `<span>` | `scope-base` | `· from <baseBranch>` (hidden for the Default workspace) |
| Connection Status | inline `<span>` | `connection-status` (`data-status`) | Connected / Connecting… / Disconnected pill with a color dot |
| Settings Button | inline `<button>` (gear, `@remixicon/react` `Settings`) | `open-settings` | Opens the Settings Dialog via `store.openSettings()` |

**⚠ Naming note (Scope Context):** the `data-testid` is `scope-context` and the spec text calls it the
"location context". This reference adopts **Scope Context** as canonical; "location context" is an
alternative used in prose.

---

# Projects Tool

The singleton Projects tool, initially in the left side. Its Projects Rail view lists projects and, expanded beneath each, their workspaces.

- **Canonical name:** Projects Tool; **Projects Rail** names its navigation view.
- **Implementation:** `panels/ProjectTree.tsx` → `ProjectTree`, rendered by the shell's Projects tool.
- **`data-testid`:** the tool body wrapper is `left-nav`.
- **Parent:** Workspace Workbench (a movable singleton side tool), or Welcome Layout.
- **Position:** Initially in the left side; its containing group can resize, fold, hide, or move.
- **Responsibility:** open a repo, select a project (a "project home" gesture that deselects any active
  workspace), close a project, expand/collapse to reveal workspaces, create/select/remove workspaces, and
  open a workspace in an external editor / file manager.

**⚠ Naming note (Projects Tool):** legacy names still coexist — the component is `ProjectTree`, its
navigation view is the **Projects Rail**, and the compatibility test id is `left-nav`. Neither “Left Nav”
nor “Left Sidebar” describes durable placement because the tool can move.

Children:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Add-Project Button / Menu | `panels/AddProjectMenu.tsx` → `AddProjectMenu` (the rail "+") | `add-project-menu` | Open project / Open GitHub (soon) / Recents dropdown |
| Project Row | inline row in `ProjectTree` | `project-item` | A project (git repo); clicking selects it (project home) |
| — Project Expander | chevron control | `project-expand` | Expands/collapses the project's workspace list |
| — Project Name | inline `<button>` | `project-name` | Selects the project (project home) |
| — Workspace Count | inline `<span>` | `project-workspace-count` | Collapsed-row count of the project's worktree workspaces |
| — Add-Workspace Button | inline "+" | `add-workspace` | Opens the New Workspace Dialog |
| — Project Actions Menu | Context Menu on the row | `project-actions` | Create workspace (`project-menu-create-workspace`) / Close project (`project-menu-close`) |
| Workspace Row | inline row in `ProjectTree` | `workspace-item` | A workspace (git worktree); two-line: name + branch |
| — Workspace Name | inline `<span>` | `workspace-name` | Display name |
| — Workspace Branch | inline `<span>` | `workspace-branch` | Git branch (muted, proportional metadata; hidden if it equals the name) |
| — Working Badge | `components/RunningIcon.tsx` → `RunningIcon` | `running-icon` | The live TR brand badge shown in place of the row's identity icon while its session runs (also on project rows); label “Agent working” |
| — Attention Dot | `components/AttentionDot.tsx` → `AttentionDot` | `attention-dot` | Static accent dot for needs-input / unread result; label “Needs attention” |
| — Workspace Actions Menu | `MoreVertical` Dropdown Menu | `workspace-menu` / `workspace-actions` | Open in (`workspace-open-in`) / Copy path / Reveal / Remove workspace |
| — Remove-Workspace Item | menu item in the actions menu | `workspace-remove` | Opens a Confirm Dialog; not shown on the Default workspace |

The **Default Workspace** row (`kind === "default"` — the project folder itself) is pinned first, uses a
`House` icon in place of the `GitBranch` glyph, and has no Remove item — but it gets the same Open in /
Copy path / Reveal menu as any worktree.

---

# Welcome Screen

Shown in the Welcome Layout's right column when no workspace is active (fresh install, or after archiving
the last workspace). Mutually exclusive with the Workspace Workbench.

- **Canonical name:** Welcome Panel (a.k.a. Welcome Screen).
- **Implementation:** `panels/WelcomePanel.tsx` → `WelcomePanel`.
- **Parent:** App Shell (Welcome Layout, `id="welcome"` panel).
- **Position:** Centered content in the wide right column beside the Projects Rail.
- **Responsibility:** first-touch surface + the **mode fork** — pair "Start building" (isolated worktree)
  with "Work in project folder" (Default workspace).

Children:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Welcome Heading | inline hero heading | `welcome-title` | Project name, or `PRODUCT_NAME` when no project |
| Provider Warning Banner | `panels/ProviderWarningBanner.tsx` → `ProviderWarningBanner` | — | Gold banner shown only when no provider is connected |
| Project Skills Notice | `panels/ProjectSkillsNotice.tsx` → `ProjectSkillsNotice` | — | Pre-workspace trust surface for committed skills |
| Primary Card (CTA) | `Card` in `WelcomePanel` | `welcome-cta` | Filled-primary action |
| Action Card | `Card` in `WelcomePanel` | `welcome-action` | Quiet secondary actions |

---

# Center Workbench

The central work area is a recursive tree of one to four tab groups. Each group has its own **Group
Header** (tab strip plus group controls), selection, preview slot, and body; horizontal or vertical
separators resize adjacent groups.

- **Canonical name:** Center Workbench (a.k.a. Center Tabbed Area / Editor Area).
- **Implementation:** `shell/layout/Workbench.tsx` (topology and container chrome), integrated by
  `shell/WorkspaceWorkbench.tsx` (feature bodies and local-state orchestration).
- **`data-testid`:** compatibility wrapper `center-tabs`; leaves are `center-group`, Group Headers are
  `center-tab-strip` (a legacy name), and split separators are `center-split-resize`.
- **Parent:** Workspace Workbench.
- **Responsibility:** hosts **File**, **Chat**, **Diff**, **Changes review**, rehydratable **Document**, and
  **Terminal** tabs; owns recursive placement, per-group preview/keep semantics, movement, overflow, and
  focus recovery.

**⚠ Naming note (tab element):** file/chat/diff/changes/document tabs carry `data-testid="editor-tab"`; terminal
placements carry `terminal-tab`. The resource kind is also available through `data-kind`. "Editor tab" is
a compatibility test hook, not the kind.

Children:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Center Group | `CenterGroupView` in `Workbench` | `center-group` | One leaf: tab strip + locally selected body |
| Group Header | `TabStrip` plus injected group controls in `Workbench` | `center-tab-strip` | Fixed one-row chrome containing the ARIA tablist, scrolling, searchable overflow, and group actions |
| Tab | `WorkbenchTab` | `editor-tab` / `terminal-tab` | One canonical placement; `data-preview` marks a preview |
| — Tab Close | inline `X` action | `editor-tab-close` | Close the placement (not the underlying durable resource) |
| New-Chat Button | injected center action | `new-chat` | Open a fresh chat tab |
| Chat-History Menu | `shell/WorkspaceChatHistory.tsx` | `chat-history` | Reopen or delete closed/disk-only chats |
| Editor Pane | injected selected body | `editor-pane` | Locally selected center body |
| Workspace-Ready Receipt | injected empty state | `workspace-ready` | Orientation receipt when a final center leaf is empty |
| — Start-Chat Action | inline action | `start-chat` | New chat from the empty receipt |

Tab-body components:

| Canonical name | Implementation | Tab kind | Responsibility |
|---|---|---|---|
| File Pane | `panels/FilePane.tsx` → `FilePane` | `FileTab` | Registry-dispatched file viewer; richer formats get renderer toggles |
| — Code File | `panels/MonacoEditor.tsx` / `panels/resources/code/PierreFile.tsx` (lazy) | — | Read-only Monaco source on desktop, Pierre source on phones |
| — Markdown Preview | `panels/MarkdownPreview.tsx` → `MarkdownPreview` (lazy) | — | Rendered markdown (document skin) |
| Diff Pane | `panels/DiffPane.tsx` → `DiffPane` | `DiffTab` | File diff; Split\|Inline or Source\|Rendered toggle |
| — Source Diff | `panels/resources/code/PierreDiff.tsx` (lazy) | — | Read-only Pierre split/unified source diff with review and hunk actions |
| — Rendered Diff | `panels/RenderedDiff.tsx` → `RenderedDiff` (lazy) | — | Rich markdown diff (`<ins>`/`<del>`) |
| Changes Review Pane | `panels/ChangesReviewPane.tsx` → `ChangesReviewPane` | `ChangesTab` | Every changed file of one scope as sections; **Stacked** \| **One file** modes (its own section below) |
| Chat View | `chat/ChatView.tsx` → `ChatView` (lazy) | `chat` | The agent conversation (its own section below) |
| Document Pane | `WorkspaceWorkbench` reference renderer | `document` | Rehydratable virtual documents such as TODO plans |
| Terminal Body | `panels/TerminalWorkbench.tsx` → `TerminalWorkbenchBody` | `terminal` | Visibility-gated xterm surface |

---

# Chat View

The agent conversation, rendered inside a Chat tab in the Center Tabbed Area.

- **Canonical name:** Chat View.
- **Implementation:** `chat/ChatView.tsx` → `ChatView` (the only app-integration piece; wires store +
  transport). All the renderers below it are presentational/props-driven.
- **Parent:** Center Workbench (a selected `chat` tab body).
- **Position:** Fills the Editor Pane. Vertically: Chat Header (top) → Message List (middle, scrolls) →
  Composer (bottom).
- **Responsibility:** render pi's canonical message / content-block model as folded rows; own the
  composer, history overlay, plan popover, and dialogs.

## Chat Header

- **Canonical name:** Chat Header.
- **Implementation:** `chat/ChatHeader.tsx` → `ChatHeader`.
- **Parent:** Chat View.
- **Position:** Slim top bar of the Chat View.
- **Children / slots:**
  - **Plan Strip** — `ChatPlanStripContent` (from `chat/ChatPlan.tsx`), passed into the header's `left`
    slot; opens the **Plan Popover** (`ChatPlanContent`) over the chat.
  - **Status Entries** — inline muted `statusEntries` text (extension status).
  - **Session Stats Bar** — `chat/SessionStatsBar.tsx` → `SessionStatsBar` (token/cost stats).
  - **Resources Trigger** — `chat/resources/ResourcesButton.tsx` → `ResourcesButton`
    (`data-testid="resources-trigger"`); the live-resource count (or `—` while the count is not
    authoritative), breathing while anything is live; toggles the **Resources Inspector**.
  - **Skills Button** — `chat/SkillsButton.tsx` → `SkillsButton` (`data-testid="open-skills"`); opens the
    **Skills Dialog** (`chat/SkillsDialog.tsx` → `SkillsDialog`).

## Resources

The current chat's background commands and subagents, rendered through one row grammar on three
surfaces owned by `chat/resources/`.

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Resources Trigger | `resources/ResourcesButton.tsx` → `ResourcesButton` | `resources-trigger` (`data-active-count`) | Header toggle for the inspector; live count |
| Resources Dock | `resources/ResourcesDock.tsx` → `ResourcesDock` | `resources-dock` (`resources-dock-toggle`) | Live rows above the Composer; hidden while the inspector is open; collapses past four rows |
| Resources Inspector | `resources/ResourcesInspector.tsx` → `ResourcesInspector` | `resources-inspector` | Non-modal in-place dialog over the Message List: roster (Active / Finished) + detail of the selected row |
| Resource Row | shared row inside dock and inspector | `resource-command` / `resource-subagent` (`data-resource-id`, `data-status`, `data-state`) | One command or subagent: glyph · name · activity · state · elapsed. In the dock the name and activity are one Inspect button (`resource-inspect`); in the inspector the row wrapper (`data-selected`) holds a listbox option (name · state · elapsed over a truncated activity line; accessible name `name: activity, state`) and its sibling Stop. Stop appears on hover and focus (`resource-stop`) |
| Command Log View | `resources/CommandLogView.tsx` → `CommandLogView` | `command-log-output` / `command-log-unavailable` | Bounded plain-text output; the inspector's detail body for a command |
| Subagent Transcript Pane | `chat/SubagentTranscriptDialog.tsx` → `SubagentTranscriptPane` | `subagent-transcript` | Read-only child transcript; the inspector's detail body for a subagent (and the body of the Subagent Transcript Dialog) |
| Stop-All Action | roster header in the inspector | `resources-stop-all` → `resources-stop-all-confirm` | Stops this chat's active subagents after a confirmation naming the count |
| Still-Running Chip | `TurnDivider` in `chat/turns.tsx` | `turn-divider-running` | "N still running" on the latest turn divider; opens the inspector |

## Message List

- **Canonical name:** Message List (a.k.a. Transcript).
- **Implementation:** a `react-virtuoso` `Virtuoso` in `ChatView`, rendering **derived rows** via
  `chat/rows.ts` (`deriveRows`) dispatched by `chat/turns.tsx` → `ChatTurnView`.
- **Parent:** Chat View.
- **Position:** Scrolling middle region between header and composer.
- **Responsibility:** render pi turns as folded rows with progressive disclosure.

**⚠ Naming note (Message vs Turn vs Row):** the code distinguishes three levels. A **Turn** (`ChatTurn`)
is pi's message-level unit; a **Row** (`ChatRow`) is the derived render unit (folding spans turn
boundaries); every rendered message element carries `data-testid="chat-message"` with a `data-role`. Use
**Row** for render units and **Turn** for pi messages; "Message" is the generic surface term.

Row / message renderers (all in `chat/turns.tsx` unless noted):

| Canonical name | Implementation | `data-testid` | Row kind | Responsibility |
|---|---|---|---|---|
| Turn Dispatcher | `ChatTurnView` | — | — | Dispatches a derived row to its renderer |
| User Message | `UserTurn` | `chat-message` (`data-role="user"`) | `user` | A user prompt bubble |
| Assistant Markdown | `chat/Markdown.tsx` → `Markdown` | — | `markdown` | Assistant text (GFM + shiki) |
| System Notice | `SystemTurn` | `chat-message` | `system` | Web-local system notice |
| Error Turn | `ErrorTurn` | `chat-message` | `error` | Persistent tinted failure notice (never folded) |
| Retry Indicator | `RetryIndicator` | `retry-indicator` | `retry` | Retry countdown (turn / summarization) |
| Tool Card | `chat/ToolCard.tsx` → `ToolCard` | `tool-card` (`-toggle`) | `tool` | A primary tool call (collapsible frame) |
| Activity Group | `chat/ActivityGroup.tsx` → `ActivityGroup` | — | `activity` | Folded run of routine steps ("N steps · …") |
| Turn Divider | `TurnDivider` | `turn-divider` / `turn-divider-<id>` | `divider` | Round-end summary + artifact chips |
| — Artifact Chip | `ArtifactChip` | `turn-divider-specs` / `turn-divider-files` | — | "N specs" / "N files changed" deep-link/disclosure; with a host turn receipt the files chip reads `N files changed · +a −r` |
| — Artifact List | `ArtifactList` | `<testid>-list` / `-list-item` | — | Expanded per-path list (per-file `+/−` from the receipt) |
| — Review-Turn Chip | inline in `TurnDivider` | `turn-divider-review` | — | "Review turn": opens the Changes Review Tab at the turn's scope (receipt only) |
| Stream Indicator | `chat/StreamIndicator.tsx` → `StreamIndicator` | `stream-indicator` | — | Live streaming status: the Working Badge + phase label ("Thinking…", "Running bash…") |

## Tool Call

- **Canonical name:** Tool Card (the frame); Tool Renderer (the body).
- **Implementation:** `chat/ToolCard.tsx` → `ToolCard` (the collapsible frame), bodies registered via
  `chat/toolRegistry.tsx` → `registerToolRenderer`. Unregistered tools fall back to
  `DefaultToolRenderer`.
- **Parent:** Message List (a `tool` row), or an Activity Group step row (routine tools).
- **Responsibility:** render one tool call; "card" chrome uses `ToolCard`, "bare" chrome owns its own
  frame.

Built-in tool renderers (in `chat/tools/` unless noted):

| Canonical name | Implementation | Prominence | Responsibility |
|---|---|---|---|
| Bash Card | `BashCard.tsx` → `BashCard` | routine | Terminal command block |
| Read Card | `ReadCard.tsx` → `ReadCard` | routine | File read (path + highlighted file) |
| Write Card | `ReadCard.tsx` → `WriteCard` | routine | File write |
| Edit Card | `EditCard.tsx` → `EditCard` | routine | Edit (removed/added line diff) |
| Ask-User-Question Card | `AskUserQuestionCard.tsx` → `AskUserQuestionCard` | primary, "bare" | Inline questionnaire |
| Visualization Card | `thinkrail-extensions/visualize/web/` → `VisualizationCard` | primary, expanded | Mermaid diagram / comparison cards |
| Web Card(s) | `tools/web/` | routine | Search/fetch renderers |
| Default Tool Renderer | `DefaultToolRenderer` | routine | Fallback for unregistered tools |

## Composer

- **Canonical name:** Composer.
- **Implementation:** `chat/Composer.tsx` → `Composer`.
- **Parent:** Chat View.
- **Position:** Bottom of the Chat View.
- **Responsibility:** the prompt input + send/steer/followUp/abort, `@`-mentions, `/` slash commands,
  template slot sessions, image paste/drop, `↑` recall, and the history-open affordance.

Children / associated surfaces:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Model Selector | `chat/ModelSelector.tsx` → `ModelSelector` | — | Model picker (+ Refresh catalog) |
| Thinking Selector | `chat/ThinkingSelector.tsx` → `ThinkingSelector` | — | Thinking/effort level picker |
| Slash-Command Menu | `chat/SlashCommandCompletion.tsx` → `SlashCommandMenu` | `slash-templates-empty` (footer) | `/` command + template completion |
| Send Button | inline (`ArrowUp` / `Square` abort) | — | Send / steer / follow-up / abort |
| History-Open Button | inline (`History` icon) | `history-open` | Opens the History Overlay |
| Slot Hint Chip | inline pill | `slot-hint` | Template slot session progress (`slot n/m · ⇥ next · esc done`) |
| Slot Highlight | inline backdrop span | `slot-highlight` (`data-slot-state`) | Tinted template-slot ranges |

## History Overlay

- **Canonical name:** History Overlay.
- **Implementation:** `chat/HistoryOverlay.tsx` → `HistoryOverlay`, driven by `chat/useHistorySearch.ts`.
- **Parent:** Chat View (opened by the Composer / `Ctrl+R`).
- **Responsibility:** history recall/search; compact single-column, `Tab` grows to a two-pane zoomed
  layout (results + preview).

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Results List | inside `HistoryOverlay` | `history-results` | Prompt / message hits |
| Preview Pane | inside `HistoryOverlay` | `history-preview` | Full text of the selected hit |
| Scope Picker | inside `HistoryOverlay` | `history-scope` / `-option` | This chat / Workspace / Project / Everywhere |
| Jump Action | inside `HistoryOverlay` | `history-jump` (`-shortcut`) | Go to chat |
| Save-as-Template Action | inside `HistoryOverlay` | `history-save-template` (`-shortcut`) | Opens the Template Editor Dialog |

## Chat Plan (TODO plan)

- **Canonical name:** Chat Plan.
- **Implementation:** `chat/ChatPlan.tsx` (`ChatPlanStripContent` = the Plan Strip in the Chat Header;
  `ChatPlanContent` = the Plan Popover body) + `chat/TodoList.tsx` → `TodoList`.
- **Parent:** Chat Header (strip) → Popover (body).
- **Responsibility:** surface the chat's `pi-todos` plan (group-first, status-ordered). There is no
  side-tool Todo tab — the plan lives in the conversation.

---

# Changes Review Tab

The continuous review surface for one diff scope: every changed file of the scope as a **File Section** in a
center tab. A single click on a Changes row, or the chat's **Review-Turn Chip**, opens it; the Changes Tool is
its navigator.

- **Canonical name:** Changes Review Tab; its body is the **Changes Review Pane**.
- **Implementation:** `panels/ChangesReviewPane.tsx` → `ChangesReviewPane`, rendering
  `panels/ChangesFileSection.tsx` → `ChangesFileSection` per file and the `panels/ChangesReviewGuide.tsx` →
  `ChangesReviewGuide` rail.
- **`data-testid`:** body `changes-review`; its tab is an `editor-tab` with `data-kind="changes"`.
- **Parent:** Center Workbench (a selected `changes` tab body; one per workspace + scope).
- **Position:** Fills the Editor Pane. Vertically: Review Toolbar (top) → sections (middle, scrolls) → Triage
  Bar (bottom, Stacked only); the Review Guide is a left rail beside the sections.
- **View modes:** **Stacked** (default; every section in one virtualized list) and **One file** (one section
  at a time under the Walk Bar), chosen by the toolbar's Stacked\|One file segment and held app-wide.
- **Responsibility:** lazily read each file's diff as a section, keep the tab's viewed / collapsed / kept
  state, and walk the reviewer through the scope.

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Review Toolbar | inline `role="toolbar"` in `ChangesReviewPane` | `changes-review-toolbar` | Scope + target (`changes-review-scope`), `N files · +N −M · n/N viewed` (`changes-review-summary`, `changes-review-viewed-count`), and the controls below |
| — Send Review | `SendAllReviewsButton` | `changes-review-send` | "Send review (N)" |
| — Collapse / Expand All | `HeaderIconButton` | `changes-review-collapse-all` / `changes-review-expand-all` | Every section at once (Stacked only) |
| — Review Guide Toggle | `HeaderIconButton` | `changes-review-guide-toggle` | Show / hide the Review Guide |
| — Whitespace Toggle | `HeaderIconButton` (¶) | `changes-review-toggle-whitespace` | Hide whitespace changes |
| — Diff View Toggle | `ToggleSegment` | `changes-review-toggle-split` / `changes-review-toggle-inline` | Split \| Inline (desktop only) |
| — Layout Toggle | `ToggleSegment` | `changes-review-layout-stacked` / `changes-review-layout-single` | Stacked \| One file |
| File Section | `ChangesFileSection` | `changes-section` (`data-path`, `data-status`, `data-collapsed`, `data-viewed`) | One changed file: header + lazily read diff body, dispatched like the Diff Pane |
| — Section Header | inline; sticky in Stacked | `changes-section-header` | Collapse chevron (`changes-section-toggle`), status, path (`changes-section-path`), `+N −M`, `k/n kept` (`changes-section-kept`), renderer segment, Revert file (`changes-section-revert`), Open as tab (`changes-section-open-tab`), actions menu (`changes-section-menu`) |
| — Viewed | inline toggle button | `changes-section-viewed` (`aria-pressed`) | Marks the file viewed in this tab |
| — Collapsed Notice | inline | `changes-section-collapsed` / `changes-section-expand` | Large or generated file collapsed by default: Expand / Open as tab |
| — Section states | inline | `changes-section-loading` / `changes-section-error` / `changes-section-retry` | Height-reserving placeholder; failed read + Retry |
| Hunk Toolbar | `HunkToolbar` in `panels/resources/code/PierreDiff.tsx` | `hunk-toolbar` (`data-kept`) | Per-hunk Source Diff actions: Revert (`hunk-revert`), Ask agent (`hunk-ask-agent`) |
| — Keep | inline toggle button | `hunk-keep` (`aria-pressed`) | "Keep" / "Kept" hunk triage; review tab in a mutable scope only |
| Triage Bar | inline in `ChangesReviewPane` (Stacked) | `changes-review-triage` | Bottom bar: `n of N reviewed` |
| — Progress Bar | inline | `changes-review-progress` | Viewed fraction |
| — Next Unreviewed | inline button | `changes-review-next-unreviewed` | "Next unreviewed" file (`J`, wraps) |
| — Mark All Viewed | inline button | `changes-review-mark-all` | "Mark all viewed" |
| Walk Bar | inline in `ChangesReviewPane` (One file) | `changes-review-walk` | Prev / Next file (`changes-review-prev` / `changes-review-next`, `Alt+↑` / `Alt+↓`), `n / N` (`changes-review-counter`), Mark viewed (`changes-review-mark-viewed`, `V`) |
| Review Guide | `ChangesReviewGuide` | `changes-review-guide` | "Review guide" left rail (Stacked, not on phones) when the review has a guide or an open agent finding: verdict + summary (`changes-review-guide-summary`) |
| — Guide Step | inline button | `changes-review-guide-step` (`data-active`) | One "Suggested reading order" step; disabled when its file is outside the scope |
| — Guide Finding | inline card | `changes-review-guide-finding` (`data-active`) | One open agent finding; "Fix this one" (`changes-review-guide-fix`) |
| — Guide Prev / Next | inline buttons | `changes-review-guide-prev` / `changes-review-guide-next` | Walk the steps: Start / Next / Restart (`N`; `P` back) |
| — Apply Fixes | inline button | `changes-review-guide-apply` | "Apply fixes": sends every open finding to the agent |
| Large-Scope Notice | inline | `changes-review-large-notice` | More than 50 files: offers One file; dismissable |
| End Note | `ReviewListFooter` | `changes-review-end` | "End of changes · N files" tail of the Stacked list |
| Empty / Error states | inline | `changes-review-empty` / `changes-review-error` / `changes-review-retry` | No changes in this scope; failed read + Retry |

---

# Side Workbench

The left and right sides are independently resizable regions. Each side contains an ordered vertical
stack of tab groups; groups can resize, fold to a 27px row, move, and disappear when empty. Hiding a side
leaves a compact restore rail. Side arrangement is workspace-shared; selection and focus are browser-local.

- **Canonical names:** Left Side, Right Side, Side Group, Hidden-Side Rail.
- **Implementation:** `shell/layout/Workbench.tsx` (`SideStack`, `SideGroupView`).
- **`data-testid`:** `left-stack`, `right-stack`, `left-layout-rail`, `right-layout-rail`,
  `side-group-fold`, and side-specific group resize handles.
- **Parent:** Workspace Workbench.
- **Responsibility:** arrange singleton shell tools and terminals without coupling feature panels to
  their position. Files, diffs, chats, and documents remain center-only; terminals can cross domains.

Every Side Group has a **Group Header**; folding retains that header as a 27px row while its linked
body stays native-hidden and unmounted. Initial Balanced placement puts Projects on the left, Specs and
Files in the first right group, then Changes and Review in the second; the default terminal catalog
joins that last group. This is startup behavior, not a fixed hierarchy.

## Side Tools

| Canonical name | `data-testid` | Implementation / responsibility |
|---|---|---|
| Projects | `tab-projects`, body `left-nav` | `panels/ProjectTree.tsx`; projects and workspaces |
| Specs | `tab-specs` | `panels/SpecsPanel.tsx`; automatically refreshed read-only spec graph, with error-only `specs-retry` |
| Files | `tab-files` | `panels/FileTree.tsx`; worktree file tree |
| Changes | `tab-changes` | `panels/ChangesPanel.tsx`; scoped git changes, Changes Review Tab navigator, diff opens |
| Review | `tab-review` | `panels/ReviewPanel.tsx`; review accordion and send actions |

`WorkspaceWorkbench` owns the long-lived Specs and Review reads so badges, review flags, and artifact
classification remain current even while those tool bodies are not selected.

## Changes Tool

The Changes body keeps its own feature toolbar: scope menu, target-branch picker, and List\|Tree toggle
(Tree by default). A single click on a row opens the scope's **Changes review tab** — every changed file as
a stacked section, or one at a time in its **One file** mode — and the sidebar is that tab's navigator
(the row of the section in view is active, viewed files carry a mark); double-click or *Open as tab* opens
the per-file diff tab. `ChangesPanel` remains arrangement-agnostic; only its side placement changed.

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Changes Header | inline `role="toolbar"` in `ChangesPanel` | `changes-view-toggle` | Scope menu, target-branch picker, List \| Tree |
| Changes Scope Menu | `panels/ChangesScopeMenu.tsx` → `ChangesScopeMenu` | `changes-scope-trigger` (`changes-scope-label`) | Scope pill: All changes (`changes-scope-all`), Uncommitted changes (`changes-scope-uncommitted`), Last turn, Agent turns, Commits (`changes-scope-commit`) |
| — Last Turn | menu item | `changes-scope-last-turn` | "Last turn · N files": the newest agent run; disabled until a run changed files |
| — Agent Turns | menu items under "Agent turns" | `changes-scope-turn` (`data-turn`) | Recent agent runs, newest first (only when there is more than one) |
| Branch Picker | `panels/BranchPicker.tsx` → `BranchPicker` | `changes-target-picker` | Target branch (`vs <base>`) |
| Changes View Toggle | `panels/ToggleSegment.tsx` | `changes-toggle-list` / `changes-toggle-tree` | List \| Tree |
| Changes List Row | inline in `ChangesPanel` | `change-item` (`data-active`, `data-viewed`) | Flat changed-file row |
| Changes Tree | `panels/ChangesTree.tsx` | file rows `change-item`, folders `change-tree-folder` | Folder tree of changed files |
| Viewed Mark | `panels/ViewedMark.tsx` → `ViewedMark` | `change-viewed` | Check glyph on a row the review tab marked viewed |
| Diff-Stat Badge | `panels/DiffStatBadge.tsx` | — | Per-file / per-folder `+N −M` |
| Empty state | inline | `changes-empty` | No changes in this scope |
| Error state | inline | `changes-error` / `changes-retry` | Failed read + Retry |

**⚠ Naming note (Changes Header):** `changes-view-toggle` marks the whole header toolbar, not the List\|Tree
segment (`changes-toggle-list` / `changes-toggle-tree`).

---

# Terminal Placement

A terminal is a movable resource tab, not a permanently lower-right panel. It may occupy a center group
or any side group. The selected terminal in each visible, expanded group mounts; inactive, folded, or
hidden terminal placements do not attach. One terminal identity has at most one mounted body per browser.

- **Implementation:** `panels/TerminalWorkbench.tsx` integrates the host catalog and close flow;
  `panels/TerminalInstance.tsx` is the lazy xterm body.
- **`data-testid`:** placement `terminal-tab`, compatibility body wrapper `terminal-panel`, instance
  `terminal-instance`, and add action `terminal-add`.
- **Responsibility:** preserve host-owned shell identity while layout controls placement and visibility.
  Closing retains the explicit busy-process confirmation flow.

**⚠ Naming note (Status Bar):** ThinkRail has **no dedicated status bar component**. The closest surfaces
are the Top Bar's Connection Status and the Chat Header's Session Stats Bar.

---

# Settings Dialog

- **Canonical name:** Settings Dialog.
- **Implementation:** `panels/SettingsDialog.tsx` → `SettingsDialog` (store-driven; open state in the
  store so multiple surfaces can open it deep-linked).
- **Parent:** App Shell (mounted once inside the Top Bar's `<header>`).
- **Position:** Modal overlay; a two-pane shell (left section rail + scrollable content pane; mobile
  collapses the rail to a horizontal strip).
- **Sections (each its own component):**

| Canonical name | Implementation | Responsibility |
|---|---|---|
| Providers | `panels/ProvidersSettings.tsx` → `ProvidersSettings` | In-app provider auth (+ `panels/JetBrainsAiCard.tsx` → `JetBrainsAiCard`) |
| GitHub | `panels/GithubSettings.tsx` → `GithubSettings` | Local GitHub connection status |
| Appearance | `panels/AppearanceSettings.tsx` → `AppearanceSettings` | Theme picker |
| Layout | `shell/LayoutSettings.tsx` → `LayoutSettings` (injected into the dialog) | Default/apply/capture workbench presets and side-group limit |
| Terminal | `panels/TerminalSettings.tsx` → `TerminalSettings` | Terminal replay budget |
| Templates | `panels/TemplatesSettings.tsx` → `TemplatesSettings` | Global / project prompt templates (`template-row`, `template-starters`) |
| Privacy | `panels/PrivacySettings.tsx` → `PrivacySettings` | Anonymous-usage-analytics toggle |
| General | dimmed nav item | "Soon" placeholder |

---

# Shared UI Primitives

The reusable building blocks (shadcn/ui, Radix), owned under `packages/ui/` and themed with
ThinkRail tokens. Imported per-file as `@thinkrail/ui/<primitive>` (no barrel).

| Canonical name | Implementation | Notes |
|---|---|---|
| Button | `packages/ui/button.tsx` | `default` / `destructive` / `outline` / `ghost` |
| Dialog (Modal) | `packages/ui/dialog.tsx` | The **Modal** primitive; optional `hideClose` |
| Dropdown Menu | `packages/ui/dropdown-menu.tsx` | Height-bounded, scrollable menu; submenu via `DropdownMenuSub*` |
| Context Menu | `packages/ui/context-menu.tsx` | Right-click menu; shares `menu-styles.ts` with Dropdown Menu |
| Popover | `packages/ui/popover.tsx` | Optional `container` portal target |
| Command | `packages/ui/command.tsx` | cmdk combobox body |
| Textarea | `packages/ui/textarea.tsx` | |
| Tooltip | `packages/ui/tooltip.tsx` | |
| Resizable | `packages/ui/resizable.tsx` | `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle` |
| Toast | `packages/ui/toast.tsx` | Presentational; the store owns the queue |
| Error Boundary | `components/ErrorBoundary.tsx` → `ErrorBoundary` | Per-region crash containment |

App-level dialog/popover instances built on those primitives:

| Canonical name | Implementation | Built on | Responsibility |
|---|---|---|---|
| New Workspace Dialog | `panels/NewWorkspaceDialog.tsx` → `NewWorkspaceDialog` | Dialog | Start-working surface (mode fork: isolated worktree / project folder) |
| Confirm Dialog | `panels/ConfirmDialog.tsx` → `ConfirmDialog` | Dialog | Modal yes/no with no stable anchor (init a repo, close project, remove workspace) |
| Notice Dialog | `panels/NoticeDialog.tsx` → `NoticeDialog` | Dialog | Single-button info modal for failures |
| Confirm Popover | `panels/ConfirmPopover.tsx` → `ConfirmPopover` | Popover | Anchored yes/no from a dedicated action control (template delete) |
| Template Editor Dialog | `chat/TemplateEditorDialog.tsx` → `TemplateEditorDialog` | Dialog | Create/edit a prompt template |
| Skills Dialog | `chat/SkillsDialog.tsx` → `SkillsDialog` | Dialog | Skills manager (chat + project modes) |
| Ext-UI Dialog | `chat/ExtUiDialog.tsx` → `ExtUiDialog` | Dialog | `pi.extensionUi` bridge dialog |
| Login Dialog | `auth/` → `LoginDialog` | Dialog | Provider OAuth / API-key login |

**⚠ Naming notes (primitives):**

- **Modal** = the **Dialog** primitive. There is no separate `Modal` component; "Modal" is the generic
  term, "Dialog" is the implementation.
- **Context Menu** — two shapes co-exist. The **Context Menu** primitive (`packages/ui/context-menu.tsx`,
  Radix) backs the Project Row's right-click menu; older right-click surfaces (the Change-Row Actions menu)
  are still the **Dropdown Menu** primitive plus a shared right-click handler — call that one the
  "Row Actions Menu". Both wear the same look via `packages/ui/menu-styles.ts`.
- **Drawer** — there is **no drawer** primitive or component. The mobile single-view shell is designed
  but not built; do not use "Drawer" for any current region. The **Resources Inspector** is an in-place
  non-modal **Dialog** (`DialogPanel`), not a drawer.
- **Toolbar** — there is no `Toolbar` component; the slim per-panel control rows (Changes Header, the
  Diff Pane header, the Review Toolbar, the view toggles) are inline. Use **Panel Header** / **Panel Toolbar** descriptively,
  not as component names.

---

# Glossary — Canonical Names

Use these terms in design discussions. Where multiple names exist, the **canonical** term is listed with
its alternatives in parentheses.

**Top-level layout**

- **App Shell** — the root frame (`Shell`).
- **Top Bar** — the app-wide header (no component name; inline `<header>`).
- **Workspace Workbench** / **Welcome Layout** — the two body states.
- **Toaster** — the app-wide toast host.

**Top Bar**

- **Wordmark** — the ThinkRail brand mark.
- **Scope Context** (alt: location context) — the persistent location breadcrumb.
- **Connection Status** — the connected/connecting/disconnected pill.
- **Settings Button** — opens the Settings Dialog.

**Projects**

- **Projects Tool** — the movable singleton; **Projects Rail** (alt: Project Tree; legacy test id: Left Nav) is its projects → workspaces view.
- **Project Row**, **Workspace Row**, **Default Workspace** — rail rows.
- **Add-Project Menu**, **Add-Workspace Button**, **Remove-Workspace Button**.
- **Diff-Stat Badge** — the `+N −M` badge.

**Welcome**

- **Welcome Panel** (alt: Welcome Screen) — the no-workspace surface.
- **Welcome Heading**, **Primary Card (CTA)**, **Action Card**.
- **Provider Warning Banner**, **Project Skills Notice**.

**Center**

- **Center Workbench** (alts: Center Tabbed Area, Editor Area).
- **Center Group**, **Group Header**, **Tab Strip**, **Tab**, **Tab Close**, **Split Separator**.
- Tab kinds: **File tab**, **Chat tab**, **Diff tab**, **Changes review tab**, **Document tab**,
  **Terminal tab**.
- **Editor Pane**, **Workspace-Ready Receipt**.
- **File Pane** (**Code File** / **Markdown Preview**), **Diff Pane** (**Source Diff** /
  **Rendered Diff**), **Changes Review Pane** (**Stacked** / **One file**), **Document Pane**,
  **Terminal Body**.
- **Chat-History Menu**, **New-Chat Button**.

**Chat**

- **Chat View** — the whole conversation surface.
- **Chat Header** — its top bar. **Plan Strip**, **Session Stats Bar**, **Resources Trigger**, **Skills Button**.
- **Resources** — **Resources Trigger**, **Resources Dock**, **Resources Inspector**, **Resource Row**,
  **Command Log View**, **Subagent Transcript Pane**, **Stop-All Action**, **Still-Running Chip**.
- **Message List** (alt: Transcript). Units: **Turn** (pi message), **Row** (derived render unit).
- Row renderers: **User Message**, **Assistant Markdown**, **System Notice**, **Error Turn**,
  **Retry Indicator**, **Tool Card**, **Activity Group**, **Turn Divider** (with **Artifact Chip** /
  **Artifact List** / **Review-Turn Chip**), **Stream Indicator**.
- **Tool Card** (frame) / **Tool Renderer** (body): **Bash Card**, **Read Card**, **Write Card**,
  **Edit Card**, **Ask-User-Question Card**, **Visualization Card**, **Web Card**, **Default Tool
  Renderer**.
- **Composer** — the prompt input. **Model Selector**, **Thinking Selector**, **Slash-Command Menu**,
  **Send Button**, **History-Open Button**, **Slot Hint Chip**.
- **History Overlay** — **Results List**, **Preview Pane**, **Scope Picker**, **Jump Action**,
  **Save-as-Template Action**.
- **Chat Plan** — **Plan Strip** + **Plan Popover** + **Todo List**.

**Changes review**

- **Changes Review Tab** (body: **Changes Review Pane**) — one per workspace + scope; modes **Stacked** /
  **One file**.
- **Review Toolbar**, **File Section** (**Section Header**, **Viewed**, **Collapsed Notice**),
  **Hunk Toolbar** (**Keep**).
- **Triage Bar** (**Progress Bar**, **Next Unreviewed**, **Mark All Viewed**), **Walk Bar**.
- **Review Guide** (**Guide Step**, **Guide Finding**, **Apply Fixes**), **Large-Scope Notice**,
  **End Note**.

**Sides**

- **Left Side**, **Right Side**, **Side Group**, **Hidden-Side Rail**.
- Singleton tools: **Projects**, **Specs**, **Files**, **Changes**, **Review**.
- **Specs Panel**, **Files Panel** (alt: File Tree), **Changes Panel**, **Review Panel**.
- **Changes Header** (no component): **Changes Scope Menu** (with **Last Turn** / **Agent Turns**),
  **Branch Picker**, **Changes View Toggle**.
- **Changes List** / **Changes Tree**, **Change-Row Actions**, **Tree Row**, **Viewed Mark**,
  **Diff-Stat Badge**.

**Terminal**

- **Terminal Placement**, **Terminal Tab**, **Terminal Instance**, **Add-Terminal Button**. A terminal
  may live in a center or side group; it is not a fixed lower-right region.

**Settings**

- **Settings Dialog** with sections: **Providers**, **GitHub**, **Appearance**, **Layout**,
  **Terminal**, **Templates**, **Privacy**.

**Shared primitives**

- **Modal** = the **Dialog** primitive. **Dropdown Menu**, **Context Menu**, **Popover**, **Command**,
  **Tooltip**, **Toast**, **Resizable**, **Error Boundary**.
- App dialogs: **New Workspace Dialog**, **Confirm Dialog**, **Notice Dialog**, **Confirm Popover**,
  **Template Editor Dialog**, **Skills Dialog**, **Ext-UI Dialog**, **Login Dialog**.

**Terms that do NOT map to a ThinkRail region (avoid or use only as noted)**

- **Status Bar** — none exists; the closest are the Connection Status pill and the Session Stats Bar.
- **Context Menu** — a real primitive now (Project Row right-click); the Changes rows' right-click is still
  the Dropdown Menu (the **Row Actions Menu**). Name the surface, not just "context menu".
- **Drawer** — none exists (mobile shell not yet built).
- **Toolbar** — no component; slim control rows are inline **Panel Headers**.
- **Bottom Terminal** — no fixed region exists; say **Terminal Placement** and name its group.
