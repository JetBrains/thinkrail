# Layout redesign — research synthesis

*Feeds the concept mockups in this folder. Three parallel research passes (July 2026): AI-coding-tool
layouts, UX/layout trends, IDE layout conventions. Full per-tool notes live in the session transcript;
this file keeps what shapes our decisions.*

## Who we surveyed

Cursor 2.x/3.0 (Agents Window), Windsurf/Cascade, Zed, VS Code + Copilot (incl. the new Agents
Window), JetBrains AI/Junie, Conductor, Devin, Replit Agent, Bolt.new/Lovable/v0, OpenAI Codex cloud,
Claude Code (CLI agent view · desktop · web) + Claude Desktop, Warp, Crystal/Nimbalyst, Sculptor,
Amp, Cline/Roo, Vibe Kanban, Omnara, Terragon, Google Jules, Firebase Studio, Happy — plus VS Code /
JetBrains / Zed / Eclipse layout docs, tmux/kitty/iTerm2 conventions, NN/g, Linear/Arc/Superhuman,
and the web docking libraries (Dockview, FlexLayout, Golden Layout, rc-dock, Lumino,
react-grid-layout).

## The eight dominant patterns (2026)

1. **Sessions sidebar with live status** — one left list of every agent/session (state icon, live
   one-line summary, needs-input first), demoting the project tree. Cursor 3 Agents Window, VS Code
   Agent Sessions, Zed Threads, Claude Code desktop/CLI, Conductor, Vibe Kanban, Warp (as a top-right
   popover), Fleet. *The* dominant pattern.
2. **Chat as a right panel beside the editor** (~400–640 px; Zed agent panel is 640) — VS Code
   Secondary Sidebar (Copilot default), JetBrains AI right stripe, Windsurf, Cline/Roo. Zed's
   experiment moving files off the left caused a user revolt (#54180); Cursor 2.0's forced side swap
   drew a megathread of backlash → **default files-left/chat-right, make every dock movable**.
3. **Three-pane manager: sessions | chat | changes+terminal** — Conductor, VS Code Agents Window,
   Vibe Kanban workspace view. The convergent shape for worktree-per-agent products (ThinkRail's
   category).
4. **Uniform draggable pane grid** — chat = terminal = diff = editor = plan, all one pane primitive:
   Claude Code desktop (8 pane types, free grid), Replit panes, Warp splits. The modern answer to
   "tabs should be interchangeable". Web engine of choice: **Dockview** (active, zero-dep, drag-to-
   edge splits, floating/popout, maximize, JSON layout persistence); FlexLayout if keyboard/ARIA
   docking matters.
5. **Chats side-by-side / grids** — Cursor Agent Tabs (side-by-side, stacked, grid), Claude desktop
   panes + ⌘; side-chat, VS Code chat-as-editor-tab (splits for free) with pinning + ⌘1–9.
   TradingView/OBS teach the ergonomics: **preset layouts (1 / 1×2 / 2×2 / 1+2) + maximize-one beat
   free-form docking** for "watch N things"; tiles must be status-first, full rendering only when
   zoomed.
6. **Task queue → diff-first review** — Codex cloud task rows (title · branch · +31 −1 · status),
   Jules, Vibe Kanban's Review column, Zed multibuffer/AgentDiffPane, Jules stacked diffs. The
   session row doubles as a review queue.
7. **Two shells over one session store** — Cursor IDE ⇄ Agents Window, VS Code ⇄ Agents Window,
   Firebase Prototyper ⇄ Code view, Cursor's 4 layout presets on ⌘⌥⇥. Mode switch, not more panels.
8. **Mobile = notification-driven remote** — Happy, Omnara, Nimbalyst iOS: phone gets the session
   list + push approvals + chat, never a shrunken IDE. Replit: bottom tab bar, 4–5 destinations.

## Direct answers to our six problems

1. **Dead top bar** → make it work: workspace switcher + ⌘K command center + layout presets + agent
   status ("2 need you") + model/status. Cursor made the repo name a file-tree dropdown; Warp parks
   the whole fleet popover top-right; VS Code merged menus/Command Center into the title bar.
2. **No side-by-side chats** → chat becomes a tab/pane like any other (VS Code chat-as-editor-tab,
   Claude desktop panes, Cursor Agent Tabs) + preset grid layouts with one-key maximize
   (TradingView grammar). Zed's dock-only chat is the documented anti-pattern (#50397).
3. **Fat projects panel** → merge projects into the workspace/session list as collapsible groups, or
   into a top-bar picker; the left column's real job is *sessions with status*. (Cursor: tree →
   dropdown; Zed: threads got the prime left slot; Conductor: workspace list *is* the nav.)
4. **Terminal too small** → bottom panel spanning full width, ~300–320 px default, one-key maximize
   (VS Code ⌘J + Toggle Maximized Panel, IntelliJ Ctrl+Shift+Quote, Zed bottom dock 320 + ToggleZoom),
   movable right, **promotable to a center tab/pane**; tmux/kitty users expect splits, zoom, named
   layouts, broadcast.
5. **Files expected left** → every major IDE defaults tree-left (240–260 px) and Zed's inversion
   caused a revolt — hold the convention in IDE-shaped layouts. In *agent-first* shells it's accepted
   to move Files/Changes right of the chat (VS Code Agents Window, Devin). Default left, movable.
6. **Tabs locked in place** → one tab/pane abstraction with typed content (chat/file/terminal/diff),
   drag-to-edge = split, drag-between-strips = move, 5-zone drop overlay (Dockview/Lumino
   vocabulary), plus named layout presets so drag-freedom doesn't become chaos.

## Ten rules any chosen layout must satisfy

1. Top bar earns its keep: switcher, ⌘K, presets, status — no branding-only rows.
2. Files tree defaults LEFT (240–260 px) behind an icon rail; Specs/Changes are sibling views.
3. Chat defaults RIGHT (~600 px) *and* opens as a center tab — never dock-only.
4. Terminal defaults BOTTOM full-width (~300 px), maximizable in one key, promotable to center.
5. Editor area = groups: drag-tab-to-edge splits, preset 2-col / 2×2 layouts, group locking.
6. Every panel relocatable (left/right/bottom/center/floating) + "Reset layout".
7. One keyboard toggle per region (⌘B / ⌘J / ⌘⌥B pattern); palette teaches shortcuts (Superhuman).
8. Status bar: left = workspace scope (branch, agents running, cost, connection), right = file scope.
9. Layouts persist per workspace; named presets opt-in; **never auto-switch the whole window**
   (Eclipse's sin) — at most auto-reveal a toast/panel.
10. Needs-input is the loudest signal on screen (Agent View / Fleet "N need you" strip); tiles are
    status-first, content-on-zoom.

## Sources (primary)

- VS Code custom layout / UX guidelines — code.visualstudio.com/docs/configure/custom-layout ·
  /api/ux-guidelines/overview · /docs/agents/agents-window
- JetBrains New UI + tool windows — jetbrains.com/help/idea/new-ui.html · /manipulating-the-tool-windows.html
- Zed panel system + parallel agents — zed.dev/blog/new-panel-system · zed.dev/blog/parallel-agents ·
  discussions #54180, #50397, #42381
- Cursor changelogs 2.3 / 3.0 — cursor.com/changelog
- Claude Code desktop redesign — claude.com/blog/claude-code-desktop-redesign · code.claude.com/docs/en/agent-view
- Conductor — conductor.build; Devin — docs.devin.ai; Vibe Kanban — vibekanban.com/docs/workspaces/interface
- Warp agent management — docs.warp.dev/agents/using-agents/managing-agents
- TradingView multi-chart — tradingview.com/support/solutions/43000629990 · OBS multiview
- Eclipse perspectives — eclipse.org/articles/using-perspectives/PerspectiveArticle.html
- NN/g zen-mode caveat — nngroup.com/articles/zen-mode
- Command palettes — blog.superhuman.com/how-to-build-a-remarkable-command-palette · maggieappleton.com/command-bar
- Docking libs — dockview.dev · github.com/caplin/FlexLayout · github.com/jupyterlab/lumino
- Tab overload (CHI 2021) — dl.acm.org/doi/10.1145/3411764.3445585
- Mobile projections — blog.replit.com/mobile-app · happy.engineering · blog.marcnuri.com/ai-coding-agent-dashboard
