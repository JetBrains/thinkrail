---
id: module-extension-api
type: module-design
status: draft
title: Host extension contracts and pure renderer helpers
parent: architecture
depends-on: [module-contracts, module-locales]
references: [module-thinkrail-extensions]
---

## Responsibility

The source-only host extension contract, independent of presentation components and host state. The
browser and server descriptors compose capabilities without importing either application's internals.
The host retains registration, lifecycle and ordering; `define*` helpers preserve the supplied descriptor.

## Boundary

- `./web` exposes `ToolStatus`, `ToolRenderProps`, `ToolRenderer`, `ToolSummary`, `ToolChrome`,
  `ToolProminence`, `ToolWidth`, `ComposerSuggestionsReader`, `ToolRegistrationOptions`, `ToolInteraction`,
  `ToolInteractionState`, `ToolPlacement`, `WebExtension`, `GlobalOverlayProps`, `ExtensionCommand`,
  `ExtensionChord`, `ExtensionShortcut`, `ExtensionShortcutKey`, `defineWebExtension`, the panel contract
  (`PanelDeclaration`, `PanelChatAction`, `PanelRail`, `PanelProps`, `PanelHost`, `PanelChatTarget`,
  `PanelChatAnchor`, `PanelToolCall`, `PanelHostScope`, `PanelScope`), and the pure argument/result readers from `toolHelpers` and
  `toolResultContent`.
- **Images are references.** `parseToolResultContent(result).images` returns `contracts`' `WireImage`s,
  in block order.
  - A host reference (`ref` plus optional `width`/`height`) is accepted when its `ref` lies under
    `IMAGES_ROUTE`.
  - An inline block is accepted when its `data` is non-empty.
  - Either kind must have one of `ACCEPTED_IMAGE_TYPES`.
  - Extension renderers never load image bytes themselves: the chat's common result layer renders every
    image (#1180).
- **Interactive tools.** A tool whose `execute` waits for the person's response is *interactive*. The
  contract is tool-agnostic on both sides and keyed by `toolCallId`; the host learns a tool's name only
  from the two declarations below:
  - server: `ServerExtension.interactiveTools?: Record<toolName, InteractiveTool>` names the tools whose
    calls wait, so the host can repair a call left dangling by a restart (it writes the pending marker,
    not an error) and derive needs-input from a transcript it is not live on.
    `InteractiveTool.describeResponse?(args, response)` returns the model-facing text for a response
    delivered **after a host restart** (the only path where the tool's own `execute` is gone); `undefined`
    or no hook ⇒ the host writes a generic preface plus the response as JSON. Live responses never pass
    through it: the tool formats its own result.
  - web: `ToolRegistrationOptions.interactive: true` asks the host to fill `ToolRenderProps.interaction`
    for that renderer; `dock: true` (meaningful only with `interactive`) also asks the chat to render a
    call the host awaits in its interaction dock above the composer rather than in the transcript. Docking
    is opt-in because only the extension knows its renderer can live in a height-capped panel.
  - **Pending marker.** A result whose `details` is `{ kind: "ack" }` on an interactive call means "the
    response is still pending": the host writes it on restart repair, and a tool returns it (with
    `terminate: true`) when `awaitToolResponse` resolves `deferred`. It is the one shape both sides read
    (`contracts`: `isToolResponsePending`); a tool must not use it for a real result.
- **Artifact tools.** `ServerExtension.artifactTools?: Record<toolName, ArtifactTool>` tells the host which
  files a successful call put in front of the person (`presented(args, details)`), which of them the
  person chose (`picked(args, details)`) and which the agent published as its deliverables
  (`published(args, details)`, [[module-ext-outputs]]), as raw path strings the host resolves. The host feeds them to
  its artifact index and never learns a tool's argument shape itself; a failed call counts for nothing.
- `ToolRegistrationOptions.composerSuggestions` (`ComposerSuggestionsReader`, `(args, result) =>
  readonly string[]`) marks a tool whose call carries **next messages for the user**. The reader is pure:
  it pulls the strings out of a call's arguments and result, distinct and best first (the chat keys chips
  by text and shows at most nine, one per key). When such a call ends a finished turn, the
  chat shows the strings as one-click chips above the composer. The decision of *when* is the chat's
  ([[submodule-web-chat]]). Like `interactive`, the host learns which tools qualify only from this
  declaration. First consumer: [[module-ext-next-steps]].
- `ToolRegistrationOptions.width` (`ToolWidth`) is `"column"` by default; `"content"` lets the chat grow
  the renderer's frame past its text column to the content's width, up to the pane, while the user fits
  chat to the pane. It is opt-in because only the extension knows its content reads better wide; the
  geometry is the chat's ([[submodule-web-chat]]).
- `ToolRenderProps.interaction` is optional. The host fills it for every renderer registered
  `interactive`. It carries:
  - `state`: a `response` (`unknown` — the response delivered outside the tool result after a host
    restart, or the final result's `details` when it is not the pending marker), plus `superseded`,
    `ended`, and `accepting` — whether the host is waiting for this call's response right now (a call the
    host is not waiting on, such as a same-name tool from another package, renders but cannot respond);
  - `respond(response)` — the value travels to the tool as is; the tool validates its shape;
  - the chat's `focusScope`, so the card claims attention focus once per chat mount, and
    `mayClaimFocus()`, bound to this call: false while it is the question a served composer-focus request
    (Mod+L) won over, so a remount never takes focus the user just asked for, while a later call still
    claims;
  - `prepareLayoutChange`, which keeps the reader's place when the card changes size;
  - `focusComposer()` and `focusTranscript()` — after a keyboard answer the composer, after a click this
    call's transcript row, focused without scrolling (the plan page focuses its live slot for both);
  - `landingChord` — the label of the key that lands on a waiting call's `[data-focus-claim]` (the resolved
    `region.next`, F6 by default), for "… to answer" copy;
  - `placement` (`ToolPlacement`) — `"dock"` for the live copy in the chat's interaction dock, `"stub"`
    for the transcript row while that copy is docked, absent anywhere else (the plan page, a call the
    chat does not dock);
  - `hostProtocol` — the connected host's protocol version, so a renderer can withhold an affordance an
    older host would not understand (the app's `supports*` gates, handed through tool-agnostically).

  Without it, a renderer shows the call read-only from `result`, as in a subagent transcript. The
  renderer stays props-driven: it never reaches the chat's contexts, store or transport. `state` and
  `respond` are the stable contract; the focus/layout members and `placement` are the chat's own services handed
  through and may change with the chat (a renderer must tolerate their absence). Its DOM-typed members
  are the reason the package's `lib` includes `DOM`; the package still never touches the DOM.
- `WebExtension` is `{ name, title?, description?, toolRenderers?, globalOverlay?, commands?, shortcuts?,
  panels? }`.
  Each tool-name entry carries a `renderer` and optional `ToolRegistrationOptions` under `options`;
  `toolRenderers` is optional because a web-only extension renders no tool. `title` / `description` are
  `MessageKey`s for the Settings row of an extension the server catalog lacks; `title` also names a
  bundled extension wherever the app shows it — its Settings → Extensions row (over the server's English
  `title`), its Settings → Keyboard area and cheatsheet section, and a pi package row it supersedes. `globalOverlay` is a
  `ComponentType<GlobalOverlayProps>` the host mounts once while the extension is enabled; its props are the
  host helpers an extension cannot import — `isTextEntry(target)`, `activeLayer()` (the topmost open modal
  dialog or menu, else the document), `platform`, and the command channel below — so the SDK stays
  type-only.
- **Commands** are the extension's rebindable keybindings: `ExtensionCommand` is `{ id, title, scope?, chords }`,
  each `ExtensionChord` a physical `code`, a display `key` (a `KeyboardEvent.key`-style value, capped like a
  catalog key) and `mod` / `ctrl` / `alt` / `shift` (`mod` is ⌘ on Apple, Ctrl elsewhere). A chord with no
  modifier (a plain key) is allowed and fires only outside text entry; such a command may be rebound to
  another plain key. The host lists the commands in the cheatsheet and Settings → Keyboard, resolves them
  under the user's overrides and ThinkRail's own chords ([[submodule-web-keybindings]]), and delivers a
  matched command id to `GlobalOverlayProps.onCommand(listener)` (returns the unsubscribe) only while the
  extension is enabled — except a command a panel's `rail` names, which opens that panel instead. **`claimKeyboard(active)`** tells the host the overlay owns the keyboard: while a
  claim is held the host dispatches no app chord and no command, and the overlay handles every key itself,
  asking **`matchCommand(event)`** whether a key is one of its own commands under the effective bindings.
  An overlay's own key listener must act only while it holds the claim; that is what makes the host's and
  the overlay's listeners order-independent.
- **A command with a `scope` is local**: it acts only while focus is inside the extension's own element,
  which carries `data-key-scope="<scope>"` and matches through `@thinkrail/ui/local-keys`
  (`useLocalKeys(scope, commands)` → `match(event)` gives the command id under the user's bindings,
  `caps` / `aria` show them); the host never delivers it through `onCommand`. Its id and scope must both
  start with `<extension name>.` (`ask-user-question.discuss` in `ask-user-question.card`) — the host
  drops any command, global or local, that does not, so an extension cannot shadow ThinkRail's commands
  or another element's keys. A local key may be a single plain letter, conflicts only with keys of its
  own scope, wins over a global chord inside its element (the host yields there; Settings → Keyboard
  warns), and is listed, rebound, exported (with its `scope`) and imported like any command. Navigation
  primitives (arrows, Enter, Esc, Tab, Space, Home/End, PgUp/PgDn, alone or with Shift) stay the
  element's own and are listed as `shortcuts`; a command's own primitive default (`Shift+Escape`) is
  allowed.
- `shortcuts` are display rows (`id`, `title` `MessageKey`, non-empty `keys` of `ExtensionShortcutKey` —
  the same fields as `ExtensionChord`) for keys the extension handles itself and the user cannot rebind
  (hint mode's in-mode keys); the cheatsheet lists them while the extension is enabled. `defineWebExtension` is a typed identity helper: it preserves the
  descriptor and its inferred keys without registration or default injection.
- **Panels are props-driven.** A `PanelDeclaration` is a `title` locale key, optional `keywords` (a
  locale key whose translated, space-separated words its entry points match too, so a user finds the
  panel by what it shows in their language), an icon, the `scopes` it opens from, optional entry points
  and a lazy `load()` of its component. **Entry points are declarations, not components**, and the shell
  offers each only while the panel is openable ([[submodule-web-shell]] § Extension panels):
  - `chatAction` (`PanelChatAction`) — the panel opens *for a chat*: `params(chat)` maps the chat (a
    `PanelChatTarget` without `at`) to the panel's params, `menuLabel` is the item every chat menu shows
    (the chat's tab, the Chats list row, the recently closed list) and the optional `label` the link the
    chat's header shows beside its usage figures (the panel's `title` where absent). Offered only for a
    chat that has a session file.
  - `rail` (`PanelRail`) — an icon (the panel's `icon`) in the left rail's footer, in a workspace and on
    Project Home, named by the optional `label` (else `title`). Its optional `command` is the id of one of
    the extension's own **global** `commands`: that command's chord opens the panel where the icon would
    and never reaches the overlay, so it is listed and rebound in Settings → Keyboard, shown in the
    cheatsheet's extension section, on the icon's tooltip and on the panel's palette row like any command.
    A separate shortcut shape was rejected: the command already carries the title, the chords and the
    prefix rule.

  The component receives `PanelProps { host, params }`
  (`params` a flat string map the tab persists) and never reaches host state. `PanelHost.query` calls
  `extension.query` for the panel's own extension only and rejects with the host's coded errors; an aborted
  signal rejects locally, since the wire has no cancel — the host still runs the query, so a cancelled
  write (an export) can still land. `openChat` navigates to a chat; with `at`
  (`PanelChatAnchor`: a display-projection `messageIndex` and `anchorText`, optionally a `toolCallId`,
  and `approximate` when it is the nearest shown ancestor) it reveals that place — the panel learns the
  anchor from its server half's `messageAnchor`, because the client transcript carries no pi entry ids.
  `openPanel(panel, params?, title?)` opens or focuses another panel of the same extension in `scope`'s
  workspace, the title naming the tab. `renderToolCall(call)` draws a recorded tool call
  (`PanelToolCall`: id, name, arguments, a `{ content, details }` result, `done` / `error`) through the
  chat's registered renderer, without chat chrome or interaction. `openFile(workspaceId, path, line?)`
  opens a workspace file (a workspace-relative `path`, never a home path) in a center tab, at `line` when
  given, entering that workspace first when it is another one. `openArtifacts?()` reveals the Artifacts
  tool of `scope`'s workspace (where an extension's writes through `ensureArtifactsDir` appear); it is
  optional so a panel offers the action only on a host that has one. `scope` is the workspace whose view
  holds the tab. `hostProtocol` and `hostApiVersion` (the server half's declared `apiVersion`) let a
  panel degrade against an older host or server half.
- `./server` exposes `ServerExtension` and `defineServerExtension`, with pi `ExtensionFactory` types
  only. Descriptors carry `name` (the identity — the Settings on/off switch and `disabledExtensions` key
  on it), optional display copy `title` / `description` for the Settings catalog, `extensions`, optional
  `sessionExtensions`, optional `interactiveTools`, optional `artifactTools`, optional `settings` (declared per-extension settings —
  today only `{ type: "boolean", default }`; the values live in the host's config keyed by extension name
  and the Settings copy is the app's locale keys), optional `childExtensions`, optional
  `skillPackages` specifiers and optional `supersedesPackages` (npm names of vanilla pi packages whose
  extensions the host leaves out of its sessions while this extension is on — a user's vanilla install of
  the same capability), plus optional `apiVersion` and `queries`. Its identity
  helper preserves factories, order and optional-field absence; loading and skill resolution remain host
  responsibilities.
- `queries(host: ExtensionHostServices)` returns `ExtensionQuery` methods by name — queries (reads, and
  writes only to the extension's own data folder or the workspace's Artifacts); the contract
  is in [[module-thinkrail-extensions]] § Shape. **A table lives while its extension is on**: `signal`
  (`AbortSignal`) aborts when the user switches the extension off, and the host drops the table then —
  the first query after a switch back on calls `queries` again with fresh services. On abort a table
  stops its background work at its next yield, writes nothing more, clears its timers and lets go of what
  it holds; a query still in flight may answer from what is left, and one that would still write (an
  export, a saved document) rejects with the signal's reason instead. A signal was chosen over a `dispose()`
  the table would return: the return shape stays a plain method map, and the one signal reaches every
  owner inside the table (an index, a builder, a timer) the way `fetch` and pi take one.
  **`ExtensionHostServices` carries file locations and host
  facts, never parsed pi data**: `dataDir` (absolute, extension-private and disposable —
  `<thinkrail data>/extensions/<name>/`, created by the extension on its first write), `log`
  (`ExtensionLog`), `sessionsRoot()` (pi's default sessions root, read live), `sessionScope(scope)` (an
  `ExtensionSessionView`: the open projects with their workspaces, and `locate(cwd)` placing a session
  cwd in an open or removed workspace or none, `null` when hidden or out of scope), `childTranscriptDirs`
  (the existing delegation directories of a parent session), `sessionStatus` (live, plus the last
  persisted run outcome) and `messageAnchor(sessionFile, entryId)` (`ExtensionMessageAnchor`: where an
  entry shows in the host's chat — its display-projection index and anchor text, plus `toolCallId` for a
  message without text (a tool result, a tool-call-only assistant message) — or its nearest shown
  ancestor with `exact: false`; `null` for a file outside `sessionsRoot()`) and `contextWindow(provider,
  model)` (a model's context window from the host's model catalog with its overrides, `null` when unknown)
  and `turnReceipts(sessionId)` (`ExtensionTurnReceipt[]`: the run change sets the host recorded for that
  session, oldest first — start, settle and each changed path, workspace-relative as git reports it, with
  its status and line counts; empty when it kept none) and `turnTree(sessionId, startedAt, limits)`
  (`ExtensionTurnTree`: the workspace as that receipt's run left it — its recorded tree's regular files as
  `ExtensionTreeFile`s, worktree-relative paths and bytes —, `tooLarge` with the counts past `limits`,
  `null` when the host no longer has the tree) and `ensureArtifactsDir(workspaceId)`
  (`ExtensionArtifactsDir`: an open workspace's artifacts folder, absolute and worktree-relative,
  recreated with its self-ignoring `.gitignore` when missing — the session-level `workspaceFiles` rule,
  addressed by workspace id since queries have no session; `null` for a workspace that is not open).
  A service is added with the consumer that needs it.
- `sessionExtensions(session: ExtensionSessionServices) => ExtensionFactory[]` is how an extension uses
  per-session state the host owns: the host calls it once per parent session with that session's
  services: `setting(key)` (the extension's own declared setting, read inside a factory body so a pi
  reload sees a changed value), `workspaceFiles` (`check(path, cwd)` — the host's rule for which workspace
  files the UI may show — `checkArtifacts(paths, cwd)` — the artifact index's own rule for which files the
  Artifacts tool lists, answering each path in order with the worktree-relative name it lists the file
  under or why not (`ArtifactCheck`), one batch so the host walks the folder once — `scratchDir`, the gitignored directory for mockups, and `artifactsDir`, the
  gitignored folder the Artifacts tool shows, where an extension saves what it produces for the user;
  both are worktree-relative with a trailing `/`, and empty where there is no workspace — and
  `ensureArtifactsDir(cwd)`, which an extension calls before writing there: it recreates the folder with
  its self-ignoring `.gitignore` if something removed it, so a save never leaves files git would stage), and the
  interactive-tool
  mailbox:
  - `expectToolResponse(toolCallId)` announces a call the extension will execute and await, from its
    `message_end` hook, before pi runs it. The host tracks only announced calls, so a switched-off
    extension or a same-name tool from another package never becomes a host-tracked interaction.
  - `awaitToolResponse(toolCallId, signal)` resolves a `ToolResponse`: `{kind: "response", value}`,
    `{kind: "deferred"}` or `{kind: "abandoned"}`.
- The root is browser-safe and exposes only the web contract; it never re-exports the server half.
- Workspace dependencies are `contracts` (types, now also `HistoryScope`, `SessionCompletion` and
  `Workspace` for the host services) and, type-only, `@thinkrail/locales`' `MessageKey` and
  `@thinkrail/locales/react`'s `Translator`.
  React and pi are type-only contract dependencies; there are no React components, registry, DOM access,
  host imports, or pi runtime values.
- `ToolSummary` is `(props, t) => string`: the host passes the render-time `Translator` from `useT()`
  (`getToolSummary(t, name, props)`), so a collapsed card or routine row recomputes its summary on a
  language change; a summary translates only through that `t`, never the global translator
  (`check:i18n` flags a `summary` that reads it — [[module-locales]]).

Canonical tool-result parsing remains shared by renderer text extraction and the host's common image
layer: accept only well-formed supported image blocks, preserve text-block order, and fall back to
readable values for noncanonical results. Props-driven renderers receive optional file navigation from
the host, never acquire it from a store or transport. Extension composition rules live in
[[module-thinkrail-extensions]].

## Verification

Package tests exercise descriptors through their public entries, pure argument/result helpers and
browser bundling of both the root and `./web`. Browser bundles permit only contracts at runtime and
reject React, pi, host and server imports; `./server` separately verifies its pi dependency is erased.
The app's registry and common-image-layer tests retain coverage of the host-owned rendering behavior.
