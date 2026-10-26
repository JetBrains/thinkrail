---
id: submodule-web-commands
type: submodule-design
status: active
title: commands — the app command contract
parent: module-web
references: [submodule-web-search, submodule-web-shell]
tags: [ui, commands, public-surface-checked]
---

## Responsibility

The typed contract every invocable app action is described with, so the search palette (and later a
keybinding editor or other surfaces) can list, gate and run the same actions the menus and chords run.
It owns no handlers: a command's `run` is supplied by whoever composes the catalog, today `shell`.

## Boundary

- **Public surface:** `Command`, `CommandContext`, `CommandGroup`, `CommandShortcut`,
  `COMMAND_GROUP_LABELS`, `isCommandVisible`, `isCommandEnabled`, `visibleCommands`, `shortcutKeys`,
  `shortcutLabel`.
- **Allowed deps:** `lib` (platform family), `@thinkrail/locales` (the group-label `MessageKey`s), `@remixicon/react` types.
- **Forbidden:** importing `store`, `transport`, `panels`, `chat`, `shell` or `search`; binding keys. A
  command's `shortcut` is display-only — the chord keeps its single owner (`useGlobalHotkeys`,
  `shortcutCommands`, the native menu, or a feature's own key map) and the palette calls the same
  handler.

## Contract

- `when(context)` decides visibility (a command that cannot apply is not listed); `mutates` marks a host
  mutation, which `isCommandEnabled` refuses while `context.online` is false — the transport replays
  pending requests on reconnect, so a mutation is never issued blind. `disabledReason` (already
  translated) lists a command that applies but cannot run right now, with the reason its owning surface
  shows; the offline reason wins over it.
- `title` is already in the user's language: the composer builds the catalog with `useT()`'s translator
  (so the palette matches what the user reads), and `COMMAND_GROUP_LABELS` carries the group keys it
  translates the same way.
- `shortcutKeys` renders macOS glyphs in the system order (`⌃⌥⇧⌘`) and `Ctrl`/`Alt`/`Shift` elsewhere.

## Coverage

Every existing action, where it lives, and when the palette runs it. "Row UI" marks actions that keep
their current surface because they need a selection, an inline editor, or a confirmation the palette
does not reproduce yet.

| Command | Handler | Context / gate | Palette |
| --- | --- | --- | --- |
| `workspace.new` New workspace… (`Mod+N`) | shell `NewWorkspaceDialog` | context project | PR1 |
| `workspace.openDefault` Work in project folder | `panels/defaultWorkspace.enterDefaultWorkspace` | context project | PR1 |
| `chat.new` New chat | `panels/openChat.startChatInTab` | active workspace, online | PR1 |
| `project.open` Open project… | `panels/useOpenProject.pickAndOpen` (dialogs mounted by shell) | online | PR1 |
| `project.openPath` Open a path on the host… | `panels/useOpenProject.enterHostPath` | online | PR1 |
| `project.create` Start a new project… | `panels/useOpenProject.startNewProject` (`CreateProjectDialog`; a setup intent starts the setup chat) | a host serving `project.create` (v94), online | PR1 |
| Reopen a recent project | `AddProjectMenu` recents | a recent path | Row UI |
| `chat.history` Search chat history (`Ctrl+R`) | `store.requestHistoryOpen` | a chat tab | PR1 |
| `view.show.{specs,files,review,plan}` (every `LayoutToolId` but `projects`) | `store.requestToolView` | active workspace | PR1 |
| `view.toggleLeft/Right/Bottom` (`Mod+B`/`Mod+J`/`Mod+Shift+J`) | layout intents; Project Home pane toggle | right/bottom need a workspace | PR1 |
| `settings.open` and every Settings section (incl. Keyboard's double-Shift row, Extensions, MCP servers) | `store.openSettings(section)`; the native menu's `Mod+,` is shown where it exists | protocol-gated sections only | PR1 |
| Theme, extension and MCP server switches | their Settings sections — the palette opens them, never flips them in place | — | Settings |
| `workspace.markRead` / `markUnread` | `panels/workspaceActions` | `supportsWorkspaceReadState` + `selectWorkspaceReadAction` | PR1 |
| `workspace.settle` / `unsettle` | `panels/workspaceActions` | `canSettleWorkspace`; Settle disabled while an agent works or a chat needs you, as in the tree | PR1 |
| `workspace.reveal`, `workspace.copyPath`, `workspace.openIn.<editor>` | `panels/workspaceActions`, `lib.copyText` | active workspace | PR1 |
| `terminal.new` New terminal | `store.addTerminal` | active workspace, online (placement reserves on the host) | PR1 |
| Start work from typed text (the Start work row, `⌘↵` from any row) | the shell's Create-workspace dialog, opened prefilled through the palette's `PaletteStart.openDialog` — nothing starts without the dialog | context project | PR3 |
| Chat without a project | `chat.create` | — | PR4 |
| `files.findInFiles` Find in files… (`Mod+Shift+F`) | `findInFiles.openFindInFiles` (the shell binds the chord, `FindInFilesHost` composes the window) | `supportsTextSearch` + a context project or active workspace | PR6 |
| Continue in workspace | `chat.continue` | a projectless chat | PR5 |
| Remove workspace, close project, stop trusting, layout apply/reset, clear review, MCP approve/remove, stop all subagents, delete template | their confirm dialogs | confirmation | Row UI |
| Publish / push / open, mark ready, merge, reopen a pull request, delete the remote branch, hand checks or a diverged branch to the agent | `shell/locationBar` topbar review card | branch status + GitHub facts | Row UI |
| Rename workspace/project/chat | inline editors | an argument page | Row UI |
| Split/move/fold tabs and groups, focus adjacent group | Workbench internals | a tab or group | Row UI |
| `/compact`, `/model`, effort, Stop, resources inspector, PR flows, plan review, review fixes | lazy `ChatView`, `PlanPane`, `ChangesReviewPane` | a mounted surface | Row UI |
| Open/revert a file or hunk, review comment actions | selection surfaces | a selection | Row UI |
