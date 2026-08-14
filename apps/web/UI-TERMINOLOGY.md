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
- The layout is a desktop three-column shell today; the mobile single-view shell is designed but not yet
  built, so this reference describes the desktop arrangement.

The document proceeds top-down: Application Layout → each region → shared primitives → glossary.

---

# Application Layout

The whole app is composed by one root component and splits into a fixed top bar over a body that has two
mutually-exclusive states.

- **App Shell** — the root frame (`Shell`).
  - **Top Bar** (`<header>`) — always present.
  - **Body** — one of two states:
    - **Active-Workspace Layout** — the resizable three-column IDE (shown when a workspace is active).
    - **Welcome Layout** — the projects rail beside the Welcome screen (shown when no workspace is active).
  - **Toaster** — app-wide notification host, mounted once over either state.

| Canonical name | Implementation | `data-testid` | Notes |
|---|---|---|---|
| App Shell | `shell/Shell.tsx` → `Shell` | `shell` | Composition root; owns the theme DOM side-effect + global hotkeys |
| Top Bar | `<header>` inside `Shell` | — | ⚠ Naming note below |
| Active-Workspace Layout | `ResizablePanelGroup` (`autoSaveId="thinkrail-shell"`) | — | Three columns |
| Welcome Layout | `ResizablePanelGroup` (`autoSaveId="thinkrail-shell-welcome"`) | — | Projects rail + Welcome |
| Toaster | `panels/Toaster.tsx` → `Toaster` | — | See Shared Primitives |

**⚠ Naming note (Top Bar):** the code has no component or named prop for the header — it is an inline
`<header>` element in `Shell.tsx`. This reference calls it the **Top Bar**. Do not confuse it with the
**Chat Header** (a per-chat-tab bar) or a **Panel Header** (per right-rail/terminal panel).

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
| Settings Button | inline `<button>` (gear, `lucide-react` `Settings`) | `open-settings` | Opens the Settings Dialog via `store.openSettings()` |

**⚠ Naming note (Scope Context):** the `data-testid` is `scope-context` and the spec text calls it the
"location context". This reference adopts **Scope Context** as canonical; "location context" is an
alternative used in prose.

---

# Left Sidebar (Projects Rail)

The leftmost column. Lists projects and, expanded beneath each, its workspaces.

- **Canonical name:** Projects Rail (a.k.a. Left Nav / Left Sidebar).
- **Implementation:** `panels/ProjectTree.tsx` → `ProjectTree`, wrapped in an `<aside>` in `Shell`.
- **`data-testid`:** the `<aside>` wrapper is `left-nav`.
- **Parent:** App Shell (present in both body states — the left column of both layouts).
- **Position:** Left column, full height, resizable; `defaultSize=18%`, `minSize=12%`.
- **Responsibility:** open a repo, select a project (a "project home" gesture that deselects any active
  workspace), close a project, expand/collapse to reveal workspaces, create/select/remove workspaces, and
  open a workspace in an external editor / file manager.

**⚠ Naming note (Projects Rail):** three names co-exist — the component is `ProjectTree`, the wrapper's
`data-testid` is `left-nav`, and specs say "the projects rail". Canonical = **Projects Rail**;
alternatives = "Project Tree" (component), "Left Nav" (testid).

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
| — Diff-Stat Badge | `panels/DiffStatBadge.tsx` → `DiffStatBadge` | — | `+N −M` per-worktree change counts |
| — Workspace Actions Menu | `MoreVertical` Dropdown Menu | `workspace-menu` / `workspace-actions` | Open in (`workspace-open-in`) / Copy path / Reveal / Remove workspace |
| — Remove-Workspace Item | menu item in the actions menu | `workspace-remove` | Opens a Confirm Dialog; not shown on the Default workspace |

The **Default Workspace** row (`kind === "default"` — the project folder itself) is pinned first, uses a
`House` icon in place of the `GitBranch` glyph, and has no Remove item — but it gets the same Open in /
Copy path / Reveal menu as any worktree.

---

# Welcome Screen

Shown in the Welcome Layout's right column when no workspace is active (fresh install, or after archiving
the last workspace). Mutually exclusive with the Center/Right/Terminal surface.

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

# Center Tabbed Area

The middle column — a tab strip over a pane that shows the active tab's body. Present only in the
Active-Workspace Layout.

- **Canonical name:** Center Tabs (a.k.a. Center Tabbed Area / Editor Area).
- **Implementation:** `panels/CenterTabs.tsx` → `CenterTabs`, wrapped in a `<main>` in `Shell`.
- **`data-testid`:** the `<main>` wrapper is `center-tabs`.
- **Parent:** App Shell (Active-Workspace Layout, `id="center"`; `defaultSize=52%`, `minSize=28%`).
- **Position:** Center column, full height.
- **Responsibility:** hosts a mix of **File tabs**, **Chat tabs**, **Diff tabs**, and ephemeral **Doc
  tabs**; owns the preview-vs-keep tab model; auto-opens/hydrates chats on workspace entry.

**⚠ Naming note (tab element):** every tab in the strip carries `data-testid="editor-tab"` regardless of
its kind (file / chat / diff / doc). This reference calls the strip element a **Tab** and distinguishes
kinds by the store's tab types (`FileTab` / `chat` / `DiffTab` / `DocTab`). "Editor tab" is the testid,
not the kind.

Children:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Tab Strip | inline row in `CenterTabs` | — | The row of tabs + actions |
| Tab | inline button in `CenterTabs` | `editor-tab` (`data-preview`) | One open tab; italic label = preview slot |
| — Tab Close | inline "×" | `editor-tab-close` | Close a tab |
| New-Chat Button | inline `MessageSquarePlus` action | `new-chat` | Open a fresh chat tab |
| Chat-History Menu | `ChatHistoryMenu` (inside `CenterTabs`) | `chat-history` | Dropdown of recently-closed / disk-only chats |
| — Closed-Chat Item | inline row | `closed-chat-item` | Reopen a closed chat |
| Editor Pane | inline body in `CenterTabs` | `editor-pane` | The active tab's body |
| Workspace-Ready Receipt | inline empty state in `CenterTabs` | `workspace-ready` | Persistent creation/orientation receipt when no tab is open |
| — Start-Chat Action | inline action | `start-chat` | New chat from the empty receipt |

Tab-body components (the four tab kinds):

| Canonical name | Implementation | Tab kind | Responsibility |
|---|---|---|---|
| File Pane | `panels/FilePane.tsx` → `FilePane` | `FileTab` | File viewer; markdown gets a Preview\|Source toggle |
| — Code Editor | `panels/MonacoEditor.tsx` → `MonacoEditor` (lazy) | — | Read-only Monaco source view |
| — Markdown Preview | `panels/MarkdownPreview.tsx` → `MarkdownPreview` (lazy) | — | Rendered markdown (document skin) |
| Diff Pane | `panels/DiffPane.tsx` → `DiffPane` | `DiffTab` | File diff; Split\|Inline or Source\|Rendered toggle |
| — Monaco Diff | `panels/MonacoDiff.tsx` → `MonacoDiff` (lazy) | — | Read-only two-side diff |
| — Rendered Diff | `panels/RenderedDiff.tsx` → `RenderedDiff` (lazy) | — | Rich markdown diff (`<ins>`/`<del>`) |
| Chat View | `chat/ChatView.tsx` → `ChatView` (lazy) | `chat` | The agent conversation (its own section below) |
| Doc Pane | `DocPane` (inside `CenterTabs`) | `DocTab` | Ephemeral rendered markdown, no file on disk |

---

# Chat View

The agent conversation, rendered inside a Chat tab in the Center Tabbed Area.

- **Canonical name:** Chat View.
- **Implementation:** `chat/ChatView.tsx` → `ChatView` (the only app-integration piece; wires store +
  transport). All the renderers below it are presentational/props-driven.
- **Parent:** Center Tabs (a `chat` tab body).
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
  - **Skills Button** — `chat/SkillsButton.tsx` → `SkillsButton` (`data-testid="open-skills"`); opens the
    **Skills Dialog** (`chat/SkillsDialog.tsx` → `SkillsDialog`).

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
| — Artifact Chip | `ArtifactChip` | `turn-divider-<id>` | — | "N specs" / "N files changed" deep-link/disclosure |
| — Artifact List | `ArtifactList` | `<testid>-list` / `-list-item` | — | Expanded per-path list |
| Stream Indicator | `chat/StreamIndicator.tsx` → `StreamIndicator` | — | — | Live streaming status |

## Tool Call

- **Canonical name:** Tool Card (the frame); Tool Renderer (the body).
- **Implementation:** `chat/ToolCard.tsx` → `ToolCard` (the collapsible frame), bodies registered via
  `chat/toolRegistry.tsx` → `registerToolRenderer`. Unregistered tools fall back to
  `DefaultToolRenderer`.
- **Parent:** Message List (a `tool` row), or an Activity Group step row (routine tools).
- **Responsibility:** render one tool call; "card" chrome uses `ToolCard`, "bare" chrome owns its own
  frame.

Built-in tool renderers (in `chat/tools/`):

| Canonical name | Implementation | Prominence | Responsibility |
|---|---|---|---|
| Bash Card | `BashCard.tsx` → `BashCard` | routine | Terminal command block |
| Read Card | `ReadCard.tsx` → `ReadCard` | routine | File read (path + highlighted file) |
| Write Card | `ReadCard.tsx` → `WriteCard` | routine | File write |
| Edit Card | `EditCard.tsx` → `EditCard` | routine | Edit (removed/added line diff) |
| Ask-User-Question Card | `AskUserQuestionCard.tsx` → `AskUserQuestionCard` | primary, "bare" | Inline questionnaire |
| Visualization Card | `tools/visualize/` → `VisualizationCard` | primary, expanded | Mermaid diagram / comparison cards |
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
  right-panel Todo tab — the plan lives in the conversation.

---

# Right Rail

The right column. A tab bar over one of three feature panels, stacked above the Terminal Panel. Present
only in the Active-Workspace Layout.

- **Canonical name:** Right Rail (a.k.a. Right Panel).
- **Implementation:** `panels/RightPanel.tsx` → `RightPanel`.
- **`data-testid`:** the wrapper `div` is `right-panel`.
- **Parent:** App Shell (Active-Workspace Layout, `id="right"`; `defaultSize=30%`, `minSize=16%`). The
  right column is itself a vertical `ResizablePanelGroup` (`autoSaveId="thinkrail-right"`): Right Rail on
  top (`right-files`, 60%), Terminal Panel below (`right-terminals`, 40%).
- **Position:** Right column, upper section.
- **Responsibility:** browse the active worktree — Specs, All files, and Changes.

**⚠ Naming note (Right Rail vs Right Panel):** the component and testid are `RightPanel`/`right-panel`,
but the shell reserves the `id="right"` column for the rail-over-terminals stack. Canonical =
**Right Rail** for the tabbed browse section; alternative = "Right Panel" (component name).

## Right Rail Tab Bar

- **Implementation:** inline tab row in `RightPanel` (`TabButton`).
- **Parent:** Right Rail.
- **Position:** Slim top bar of the Right Rail.
- **Tabs (order fixed; Specs is leftmost and the default):**

| Canonical name | `data-testid` | Panel shown |
|---|---|---|
| Specs tab | `tab-specs` | Specs Panel |
| All-files tab | `tab-files` | All Files Panel |
| Changes tab | `tab-changes` | Changes Panel |
| Specs Refresh | `specs-refresh` | (Specs only) re-reads the spec graph |

## Specs Panel

- **Canonical name:** Specs Panel.
- **Implementation:** `panels/SpecsPanel.tsx` → `SpecsPanel` (read-only spec-graph tree). The `spec.graph`
  read is owned by `RightPanel` via `panels/useWorkspaceSpecs.ts`.
- **Parent:** Right Rail (Specs tab).
- **Children:** Spec Node rows (`spec-node`, with `spec-toggle` chevron + `spec-role` trailing label).
- **Empty / error states:** "No specs" empty state, and a distinct error hint (`specs-error`).
- **Responsibility:** read-only `parent`-tree viewer of the project's specs; single-click previews,
  double-click keeps.

## All Files Panel

- **Canonical name:** All Files Panel (a.k.a. File Tree).
- **Implementation:** `panels/FileTree.tsx` → `FileTree`.
- **Parent:** Right Rail (All-files tab).
- **Children:** Tree Rows (`panels/TreeRow.tsx` → `TreeRow`, shared with the Changes Tree).
- **Responsibility:** the worktree file tree; live-refreshes on fs changes; single-click previews,
  double-click keeps a file tab.

## Changes Panel

- **Canonical name:** Changes Panel.
- **Implementation:** `panels/ChangesPanel.tsx` → `ChangesPanel`.
- **Parent:** Right Rail (Changes tab).
- **Position:** Right Rail body under a **Changes Header** (the scope pill + target-branch pill +
  List\|Tree toggle).
- **Responsibility:** the git diff of the active worktree vs a target branch/scope; clicking a file opens
  its diff as a Center Diff tab.

Children:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Changes Scope Menu | `panels/ChangesScopeMenu.tsx` → `ChangesScopeMenu` | — | Scope pill (All changes / Uncommitted / a commit) |
| Branch Picker | `panels/BranchPicker.tsx` → `BranchPicker` | — | Target-branch combobox (shared with New Workspace Dialog) |
| Changes View Toggle | `panels/ToggleSegment.tsx` → `ToggleSegment` | `changes-view-toggle` | List \| Tree |
| Changes List | inline flat list in `ChangesPanel` | `change-item` (`change-path-dir`/`-base`) | Flat changed-files list |
| Changes Tree | `panels/ChangesTree.tsx` → `ChangesTree` | — | Folder tree of changed files (shared `TreeRow`) |
| — Diff-Stat Badge | `panels/DiffStatBadge.tsx` → `DiffStatBadge` | — | Per-file / per-folder `+N −M` |
| Change-Row Actions | `panels/ChangeRowActions.tsx` → `ChangeRowActions` | — | Per-row `⌄` + right-click menu (View / Copy path) |
| Empty state | inline | `changes-empty` | "No changes in this scope." |
| Error state | inline | `changes-error` (+ `changes-retry`) | Failed read + Retry |

**⚠ Naming note (Changes Header):** there is no `ChangesHeader` component — the header controls (scope
menu, branch picker, view toggle) live inline in `ChangesPanel`. This reference calls that row the
**Changes Header**; it has no single implementation name.

---

# Terminal Panel

The lower-right section — a tab strip of shell terminals for the active worktree.

- **Canonical name:** Terminal Panel.
- **Implementation:** `panels/TerminalsPanel.tsx` → `TerminalsPanel`; each terminal instance is
  `panels/TerminalInstance.tsx` → `TerminalInstance` (lazy, xterm).
- **`data-testid`:** the wrapper is `terminal-panel`.
- **Parent:** App Shell (Active-Workspace Layout, right column, `id="right-terminals"`).
- **Position:** Right column, lower section (below the Right Rail).
- **Responsibility:** host one or more terminals scoped to the active worktree; all instances stay
  mounted, only the active one is shown; landing on a terminal-less workspace opens one automatically.

Children:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Terminal Label | inline `<span>` ("Terminal") | — | The eyebrow label |
| Terminal Tab | `TerminalTabButton` (inside `TerminalsPanel`) | — | One terminal tab |
| Add-Terminal Button | inline "+" | `terminal-add` | New terminal |
| Terminal Instance | `TerminalInstance` | — | The xterm terminal surface |
| Empty state | inline | `terminals-empty` | "No terminals yet — press + to open one." |

**⚠ Naming note (Terminal Panel vs Bottom Terminal):** the request's example calls this a "Bottom Terminal
Area"/"Bottom Terminal". In ThinkRail it is **right-lower**, not bottom, so the canonical name is
**Terminal Panel** (matching `TerminalsPanel`/`terminal-panel`). It is not a global bottom bar.

**⚠ Naming note (Status Bar):** ThinkRail has **no dedicated status bar** component. The closest surfaces
are the Top Bar's Connection Status pill and the Chat Header's Session Stats Bar. There is no bottom
status bar; do not use "Status Bar" as a region name.

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
| Templates | `panels/TemplatesSettings.tsx` → `TemplatesSettings` | Global / project prompt templates (`template-row`, `template-starters`) |
| Privacy | `panels/PrivacySettings.tsx` → `PrivacySettings` | Anonymous-usage-analytics toggle |
| General | dimmed nav item | "Soon" placeholder |

---

# Shared UI Primitives

The reusable building blocks (shadcn/ui, Radix), owned under `apps/web/src/components/ui/` and themed with
ThinkRail tokens. Imported per-file (no barrel).

| Canonical name | Implementation | Notes |
|---|---|---|
| Button | `components/ui/button.tsx` | `default` / `destructive` / `outline` / `ghost` |
| Dialog (Modal) | `components/ui/dialog.tsx` | The **Modal** primitive; optional `hideClose` |
| Dropdown Menu | `components/ui/dropdown-menu.tsx` | Height-bounded, scrollable menu; submenu via `DropdownMenuSub*` |
| Context Menu | `components/ui/context-menu.tsx` | Right-click menu; shares `menu-styles.ts` with Dropdown Menu |
| Popover | `components/ui/popover.tsx` | Optional `container` portal target |
| Command | `components/ui/command.tsx` | cmdk combobox body |
| Textarea | `components/ui/textarea.tsx` | |
| Tooltip | `components/ui/tooltip.tsx` | |
| Resizable | `components/ui/resizable.tsx` | `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle` |
| Toast | `components/ui/toast.tsx` | Presentational; the store owns the queue |
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
- **Context Menu** — two shapes co-exist. The **Context Menu** primitive (`components/ui/context-menu.tsx`,
  Radix) backs the Project Row's right-click menu; older right-click surfaces (the Change-Row Actions menu)
  are still the **Dropdown Menu** primitive plus a shared right-click handler — call that one the
  "Row Actions Menu". Both wear the same look via `components/ui/menu-styles.ts`.
- **Drawer** — there is **no drawer** primitive or component. The mobile single-view shell is designed
  but not built; do not use "Drawer" for any current region.
- **Toolbar** — there is no `Toolbar` component; the slim per-panel control rows (Changes Header, the
  Diff Pane header, the view toggles) are inline. Use **Panel Header** / **Panel Toolbar** descriptively,
  not as component names.

---

# Glossary — Canonical Names

Use these terms in design discussions. Where multiple names exist, the **canonical** term is listed with
its alternatives in parentheses.

**Top-level layout**

- **App Shell** — the root frame (`Shell`).
- **Top Bar** — the app-wide header (no component name; inline `<header>`).
- **Active-Workspace Layout** / **Welcome Layout** — the two body states.
- **Toaster** — the app-wide toast host.

**Top Bar**

- **Wordmark** — the ThinkRail brand mark.
- **Scope Context** (alt: location context) — the persistent location breadcrumb.
- **Connection Status** — the connected/connecting/disconnected pill.
- **Settings Button** — opens the Settings Dialog.

**Left**

- **Projects Rail** (alts: Project Tree, Left Nav) — the projects → workspaces column.
- **Project Row**, **Workspace Row**, **Default Workspace** — rail rows.
- **Add-Project Menu**, **Add-Workspace Button**, **Remove-Workspace Button**.
- **Diff-Stat Badge** — the `+N −M` badge.

**Welcome**

- **Welcome Panel** (alt: Welcome Screen) — the no-workspace surface.
- **Welcome Heading**, **Primary Card (CTA)**, **Action Card**.
- **Provider Warning Banner**, **Project Skills Notice**.

**Center**

- **Center Tabs** (alts: Center Tabbed Area, Editor Area).
- **Tab Strip**, **Tab** (testid `editor-tab`), **Tab Close**.
- Tab kinds: **File tab**, **Chat tab**, **Diff tab**, **Doc tab**.
- **Editor Pane**, **Workspace-Ready Receipt**.
- **File Pane** (**Code Editor** / **Markdown Preview**), **Diff Pane** (**Monaco Diff** /
  **Rendered Diff**), **Doc Pane**.
- **Chat-History Menu**, **New-Chat Button**.

**Chat**

- **Chat View** — the whole conversation surface.
- **Chat Header** — its top bar. **Plan Strip**, **Session Stats Bar**, **Skills Button**.
- **Message List** (alt: Transcript). Units: **Turn** (pi message), **Row** (derived render unit).
- Row renderers: **User Message**, **Assistant Markdown**, **System Notice**, **Error Turn**,
  **Retry Indicator**, **Tool Card**, **Activity Group**, **Turn Divider** (with **Artifact Chip** /
  **Artifact List**), **Stream Indicator**.
- **Tool Card** (frame) / **Tool Renderer** (body): **Bash Card**, **Read Card**, **Write Card**,
  **Edit Card**, **Ask-User-Question Card**, **Visualization Card**, **Web Card**, **Default Tool
  Renderer**.
- **Composer** — the prompt input. **Model Selector**, **Thinking Selector**, **Slash-Command Menu**,
  **Send Button**, **History-Open Button**, **Slot Hint Chip**.
- **History Overlay** — **Results List**, **Preview Pane**, **Scope Picker**, **Jump Action**,
  **Save-as-Template Action**.
- **Chat Plan** — **Plan Strip** + **Plan Popover** + **Todo List**.

**Right**

- **Right Rail** (alt: Right Panel) — the tabbed browse column.
- **Right Rail Tab Bar** — **Specs tab**, **All-files tab**, **Changes tab**.
- **Specs Panel**, **All Files Panel** (alt: File Tree), **Changes Panel**.
- **Changes Header** (no component): **Changes Scope Menu**, **Branch Picker**, **Changes View Toggle**.
- **Changes List** / **Changes Tree**, **Change-Row Actions**, **Tree Row**, **Diff-Stat Badge**.

**Terminal**

- **Terminal Panel** (not "bottom terminal" — it is right-lower). **Terminal Tab**, **Terminal
  Instance**, **Add-Terminal Button**.

**Settings**

- **Settings Dialog** with sections: **Providers**, **GitHub**, **Appearance**, **Templates**,
  **Privacy**, **General**.

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
- **Bottom Terminal** — the terminals are the right-lower **Terminal Panel**.
