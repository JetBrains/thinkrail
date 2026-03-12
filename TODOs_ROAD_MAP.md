* Global bottom status bar

    - [~] "**45** sessions need attention" —- counter has to be up-to-date
    - [ ] "1 need attention" should be clickable -> choose ...
    - [~] count money (globally spend on the project) on the fly

* Chat
    - [x] History search
    - [x] Bug/Missing feature: Doesn't display user prompts
    - [x] When ask multiple askUserQuestions in one use inlined tabs or something similar
    - [ ] Colours and AskUserQuestions are hard to see (small and violet on black)
    - [ ] Visualize plan and display progress
    - [~] Re-visualise normally answers on AskUserQuestions
    - [x] AskUserQuestion should always have "other" field
    - [x] AskUserQuestion/approval requests can "slip upwards" when agent does things simultaneously — should be pinned/focused (like claude code)
    - [x] Subagent blocks collapsed by default (expandable on click)
    - [x] Fix input draft store sync — drafts now survive history select, skill insert, formatting, voice input, and session switching
    - [ ] Group tool calls and tasks somehow
    - [ ] add "don't ask approval again for ..." — "Allow for Session" button on ApprovalCard that uses SDK's `PermissionUpdate(type="addRules", destination="session")` via `PermissionResultAllow.updated_permissions` to auto-allow matching tools for the rest of the session (SDK enforces it natively, no custom state needed)
    - [~] send message should always be active?
    - [x] add interrupt
    - [x] on approval "denied" agent stuck
    - [x] add something like "agent is thinking..." which tracks that agent is not stuck and displays user that "work is in progress"
    - [ ] for each tool show the directory it is being executed from
    - [x] "plan mode exit" should be separately handled — PlanApprovalCard now shows actual plan content from file (not raw JSON blob)

* Project memory/state
    - [~] sessions do not restore after restart
    - [~] save and restore sessions
* Session status bar
    - [~] money is not counted on the fly
    - [x] no context size and opacity
    - [x] Display current mode (plan, accept edits, spec, ...) in status bar in sessions tabs (right below chat box); should be clickable to quick switch modes (a-la `⏸️ plan mode on (shift+tab to cycle)`)
    - [x] Display current model (opus 4.5 1m, opus 4.5, ...) in status bar in sessions tabs (right below chat box); should be clickable to quick switch models
* Notifications
    - [~] Needs something like timeout (when active usage)
    - [ ] Should "focus on problem on click"
* Left panel
    - [ ] add context menu on click for files (ex. delete, open in ...)
    - [x] files tab doesn't display directory
    - [x] files tab doesn't have scrolling
    - [x] Get rid of left panel max width limit and arrow side button when hidden
    - [ ] Reqs tab displays nothing (mock) — needs real requirements data
    - [x] Tree-view (files tab) always appears fully unfolded — not nice
    - [x] Single-click in SpecTree/FileTree should open a preview tab (like VS Code) — temporary tab that gets replaced by the next preview click. Double-click to pin as a permanent tab.
* Right panel (Context Panel)
    - [x] Get rid of right panel max width limit and arrow side button when hidden
    - [x] Replace tab-based right panel with context-aware ContextPanel (auto-switches: Spec/Agent/Code/Dashboard modes)
    - [ ] Implement real data for ContextPanel sections (currently placeholders except ConnectedSpecs/GraphView):
        * [ ] Spec Context: LinkedTasks — fetch tasks linked to current spec from registry
        * [ ] Spec Context: CoveredFiles — show files from registry `covers` field with mod times
        * [ ] Spec Context: SpecHealth — show status, staleness, lint warnings
        * [ ] Agent Context: TaskSpecPreview — show task spec content driving the session
        * [ ] Agent Context: FilesModified — track files from agent tool call events (live)
        * [ ] Agent Context: RelatedSpecs — show specs from session's specIds + graph neighbors
        * [ ] Agent Context: ComplianceHints — heuristic matching agent actions vs spec requirements
        * [ ] Code Context: CoveringSpecs — find specs whose `covers` includes current file
        * [ ] Code Context: RelatedTasks — tasks linked to covering specs
        * [ ] Code Context: SpecHealth — staleness: compare file mod time vs spec update time
        * ~~Project Dashboard removed — replaced by empty welcome state~~
    - [ ] ConnectedSpecs: replace full GraphView with filtered mini-subgraph (parent/children/siblings only)
    - [ ] Update graph implementation for context panel (fix layout, node sizing, interaction within 380px width)
    - [x] files tab doesn't have scrolling

* Bugs and strange behaviours:
    - [x] Tree view is not updated automatically: check events
    - [~] Once agent decided to go to inspect other projects on disk
    - [x] Unexpected "session start" after turn complete — agent auto-restarts:
        ```
        Turn complete — $1.80 · 21 turns
        Session started — claude-opus-4-6
        ```
    - [~] Session stops by itself and doesn't resume (session renew issue)
    - [ ] **Graph view** has to be fixed
    - [ ] Progress tab definitely shows something wrong
    - [ ] Markdown preview doesn't support "follow links" (for example, for table of contents)
    - [~] Sessions working dir: `ls -la .../aiir/` instead of `.../aiir/demo/`
    - [x] Session: AskUserQuestion validation error when agent sends >4 options:
        ```
        AskUserQuestion[object Object]✕ error
        InputValidationError: Too big: expected array to have <=4 items
        ```
    - [ ] **Visualization cards — diagram type broken**:
        * [ ] Sequence diagrams render blank — LLM sends `{entities, steps}` but component only handles `{nodes, edges}`
        * [ ] Flow diagram node `group`/`style` fields ignored — no visual distinction between node types
        * [ ] Multiline node labels (`\n`) render on single line — needs `white-space: pre-wrap`
        * [ ] `layout` prop defined in types but never implemented in renderer
        * [ ] Edges render as flat text list below nodes — no spatial connection to nodes
    - [ ] **Visualization cards — status-list `detail` field silently dropped**: LLM sends `detail` but type only has `meta` — descriptions invisible

* Other
    - [x] add ~~somewhere~~ in main (session) tabs window file/code preview
    - [x] Support preview for markdowns and mermaid
    - [x] Support file editing and simple IDE features (monaco editor, open in IDE/Vim)
    - [x] IntelliJ Idea-style theme for `files` tab and code
    - [x] Different (global) themes support
    - [x] keybindings for non-mac
    - [ ] Better mermaid scrolling, focusing, etc
    - [x] Add working-dir and project selection with autocomplete during project path typing
    - [ ] Add preview for html-s
    - [ ] For spec files in preview add clickable links — connections to other specs

* Features:
    - [ ] Bind tools, sessions, conversations, and/with tasks (at least like a link or folder)
    - [x] Session manager: manage and history of sessions, as well as ability to restore and continue
    - [ ] Skill a-la "let's reason and discuss something"
    - [ ] Support scenarios-driven (like AI-CI-CD-pipeline) development
    - [ ] Search (Ctrl+k): fix
    - [ ] Show skill progress with on-the-fly visualization on side of chat (partially addressed by Agent Context mode ComplianceHints)
    - [ ] Support "output view modes" like ctrl+o ctrl+t in claude
    - [~] Support effort --- done but limitation: need to restart session
    - [ ] `Compact`: how to influence, manage, and when to call
    - [ ] Support: discuss --separate session and chat--> create plan --> return to `parent` session
    - [ ] skill creator
    - [ ] brainstorming
    - [ ] plugins and mcp support
    - [ ] something like `ultrathink` support
    - [x] support voice input — InputArea has mic button with Web Speech API + Whisper fallback
    - [ ] support `simplify`
    - [ ] support remote control
    - [ ] memory management
    - [x] markdown input mode — InputArea has md toolbar (bold/italic/code/link/headings/lists/blockquote/codeblock) + split preview pane

* Bonsai workflow:
    - [?] Should tasks (current tasks) be modifiable or append only? 
    - [?] Seems like structure in tasks is missing (like binding them to specs/specs changes) 
    - [?] Skills implement, revise, and others for different cases?
