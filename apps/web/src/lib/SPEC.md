---
id: submodule-web-lib
type: submodule-design
status: active
title: lib — UI helpers
parent: module-web
---

## Responsibility

Tiny app helpers shared across components. Class merging (`cn`) belongs to `@thinkrail/ui/utils`,
not this module; the theme-aware highlighter remains app-local.

## Boundary

- **Owns:** `utils.ts` → `cssColorToHex()` (canonicalize
  a CSS color to hex — minified CSS serves `#fff`/`gray`-style equivalents, which strict consumers like
  Monaco and xterm reject; `""` when unparseable). Plus the primitives that more than one module needs and
  none should re-state: **`normalizePath()`** / **`isAbsolutePath()`** / **`fileName()`** (a path from a pi tool call or the
  host may use either separator and may be relative or absolute — every path predicate in the app starts
  from these, so `chat`'s display helpers and `store`'s worktree matcher share one definition;
  **`ancestorPaths()`** (a `/` path's parent folders, outermost first — the Files tree's folder marks
  and its auto-reveal expand the same set) and **`isRecord()`** (a non-array object check for untrusted
  JSON);
  `@thinkrail/resource-renderers` keeps its own `canonicalWorkspacePath` for `describeResource` and
  `ResourcePreview` because a package cannot import the app's `lib`; `panels/pathIdentity.test.ts` pins it to
  `projectRelativePath` for workspace-relative paths),
  **`viewport.ts`** → `isPhoneViewport()` plus the live `usePhoneViewport()` projection (coarse pointer
  or a viewport below 768px is phone-class; both media queries are observed), and **`shallowEqualArrays()`** (element-wise `Object.is` — the "did this really change?" test behind the
  store's snapshot-identity guard and `ErrorBoundary`'s reset keys), **`userText()`** (a user
  message's plain text — shared by `chat`'s transcript hydration/renderer and `store`'s live event
  fold, so "same message" means the same thing everywhere; it lives here because `store`'s edge to
  `chat/` is type-only), **`parseSkillInvocation()`** + **`matchesSkillInvocationCommand()`** (the
  anchored browser-side mirror of Pi's canonical expanded `<skill>` user-message grammar, shared by
  `chat`'s compact renderer and `store`'s optimistic-echo reconciliation; malformed/quoted blocks fail
  closed),
  **`relativeTime(t, ms, now)`** (`just now` / `5m ago` / `2d ago` against an explicit `now`, never `Date.now`
  — shared by chat history, the tab strip's closed chats, and the Changes scope menu's commit rows; it lives
  here because `chat/` may not import from `panels/`, which is what let three private twins of it
  accumulate), **`platformShortcutLabel()`** +
  **`hasPlatformModifier()`** + **`platformFamily()`** (one Apple-vs-other definition for shortcut chrome and
  global handlers, plus the `apple` / `windows` / `linux` / `other` family for per-OS shortcut tables; all
  default to the browser-reported platform but accept an explicit platform string so non-browser callers and
  tests never inherit a host runtime's synthetic `navigator` accidentally; the label optionally renders the
  Alt variant — `⌥⌘N` / `Ctrl+Alt+N` — so shortcut chrome never composes modifier glyphs itself), and
  **`copyText()`**
  (clipboard write reporting whether it landed — one place for the *degradation*: an insecure context
  (plain-http remote access) or a denied permission has no clipboard, and every caller's answer is the same
  — do nothing loud, the text stays visible/selectable), **`randomId()`** (16 random bytes through
  `getRandomValues`, which remains available to a plain-HTTP remote client),
  **`DOUBLE_CLICK_SETTLE_MS`** (the click→double-click window, used only where a single click would
  commit something a double click contradicts: a single click (or keyboard activation) on the active
  preview tab, so a double click is not read as two keeps, the Changes review-tab preview, and the Review
  reveal through `doubleClickPendingMs()`),
  **`whenIdle(task, { timeout, fallbackDelay })`** (runs a task on `requestIdleCallback` with a timeout, or
  after `fallbackDelay` where the API is missing — Safari and the macOS WKWebView — and returns a cancel),
  **`whenPageActive(schedule, task)`** (schedules `task` through `schedule` once the page is visible and
  online, and checks again when the scheduled run fires: a page that went hidden or offline meanwhile waits
  for `visibilitychange`/`online` and schedules anew; the page reader is injectable for tests),
  **`firstClickOnly()`** (wraps a browse row's preview open so it runs on a first click or keyboard
  activation, `detail <= 1`, and skips a double click's second click) with **`doubleClickPendingMs()`**
  (how long a double click on the last such row could still arrive; the Review reveal waits it out so it
  does not unmount the row first). Both take an optional clock (`performance.now()` by default), so tests
  pin the window without sleeping or inheriting another test's click,
  **`mcpState.ts`** (the MCP server-state vocabulary — `MCP_STATE_KEY` / `mcpStateLabel(t, state)`,
  `mcpStateTone` (a connected server reporting zero tools warns), `mcpStatusLabel` / `mcpToolCountLabel`
  (the text helpers here take the caller's translator first, so render output follows a language change),
  and the `isMcpAttentionState` (needs sign-in, failed, pending approval) / `isMcpActiveState` (connected,
  starting) predicates — shared by `store`'s selectors, Settings, and the props-only chat Resources rows,
  which may import nothing else in common), and the
  **`LayoutAttention`** device-local overlay shared by store, shell, and the headless layout child, with
  own-property-safe `readLayoutSelection()` / `readLayoutNavigationClock()`
  accessors for untrusted tuple-keyed maps and the key-order-independent `sameLayoutAttention()` equality
  that lets a no-op attention write be dropped before it reaches the store. Optional terminal recall is workspace-local history, not a second
  selected-tab authority; the layout owner validates it against current membership. Also the shared
  Shiki highlighter, **kept out of the barrel** so the eager `@/lib` import stays shiki-free:
  `highlighter.ts` owns the curated grammar/id/file-association catalog shared by chat and the desktop
  Monaco renderer (both load a grammar on its language's first use), plus
  `createChatHighlighter(engine)`: `themes`' one generic CSS-variable registration and each chat grammar
  loaded on first use. Chat code is highlighted off the main thread:
  `highlightCode.ts` resolves the language alias (unknown and `mermaid` answer `null` with no worker),
  then posts to one lazy `highlighter.worker.ts` per page, which uses the Oniguruma WASM engine. Per
  caller key at most one request is in flight; a newer call replaces the waiting one, which resolves
  `null`. If no `Worker` exists, the constructor throws, the worker fires `error`/`messageerror` (the
  host's SPA fallback serves HTML for a chunk deleted by an update), or it cannot build its highlighter
  (WASM load failed), the client switches for good to in-thread highlighting with the JS regex engine
  (on WebKit, the desktop webview, ~1 s on a first TS fence) and re-runs pending requests there; these
  failures never answer `null`. A failed grammar load answers `null` (plain text) for that call and
  retries on the next. Results live in a bounded LRU (256 entries / 4M chars of code + HTML; a result over
  a quarter of that is not cached) that answers `cachedHighlight()` synchronously; a key owns one entry,
  so a streaming fence does not fill it. `useHighlightedCode()` is the one component hook: it reads the
  cache on the client only (static renders, such as the rendered diff, stay plain), applies replies in
  request order, and shows the last highlight plus the newer streamed text as plain until the worker
  catches up. Both files stay out of the barrel and are imported per-file (`@/lib/highlighter`,
  `@/lib/highlightCode`). Chat's markdown imports `highlightCode` statically and `shell/AppResourceHost` hands
  the catalog to the resource renderers, so `@shikijs/core` is in the entry graph while every grammar and the
  worker still load on first use; theme
  identity/palettes never live in `lib`. Collision-safe browser identity composition lives here too:
  **`tupleKey()`** length-prefixes independent strings, **`parseTupleKey()`** reads only its requested
  namespace, and **`layoutResourceIdentity()`** gives every frontend-local placement/cache alias one
  semantic resource key, so delimiters and stable noncanonical placement ids cannot split or alias identities.
- **Public surface (barrel):** `cssColorToHex`, `isPhoneViewport`,
  `usePhoneViewport`, `normalizePath`, `isAbsolutePath`, `fileName`, `projectRelativePath` (canonical worktree-relative POSIX identity;
  collapses in-root `.`/`..` aliases but preserves an attempted leading escape for host rejection; Windows
  drive-rooted containment compares path/root case-insensitively while preserving the candidate's casing),
  `shallowEqualArrays`, `userText`, `firstNonBlankLine` (first trimmed non-empty line, `undefined` when
  the text is blank — shared by chat's thinking-heading extraction and history prompt rows), `isShellInert` (a value made only of characters that stay literal in POSIX, PowerShell,
  and cmd, so it may be interpolated into a command a human copies and runs), `parseSkillInvocation`, `matchesSkillInvocationCommand`,
  `relativeTime`, `compactAge`, the render-time default names `chatName` / `terminalName` (+ the
  language-neutral `defaultTerminalTitle` / `defaultTerminalIndex`) / `changesTabName` / `diffTabName` /
  `turnTimeLabel` / `planDocumentName` (stored tab names carry no translated text; these word them for the
  caller's translator), **`fallbackChatTitle(firstPrompt)`** / **`chatDisplayName(t, name, firstPrompt)`** (the
  one derivation of an unnamed chat's label: a real name wins; else the first prompt's head cut at a word
  boundary at 48 characters with `…`; else `chatName`'s generic label — every surface that shows a chat
  title calls it, so the agent's or user's title replaces the label everywhere at once), `platformShortcutLabel`, `hasPlatformModifier`, `platformFamily`, `copyText`, `randomId`,
  `MCP_STATE_KEY`, `mcpStateLabel`, `mcpStateTone`, `mcpStatusLabel`, `mcpToolCountLabel`, `isMcpAttentionState`,
  `isMcpActiveState`, the `McpStateTone` type,
  `DOUBLE_CLICK_SETTLE_MS`, `firstClickOnly`, `doubleClickPendingMs`, `tupleKey`, `parseTupleKey`, `layoutResourceIdentity`,
  `readLayoutSelection`, `readLayoutNavigationClock`, `sameLayoutAttention`, the `LayoutAttention`
  type, and the keyboard gate shared by the shell's chords and the panels' plain-letter review
  shortcuts: `MODAL_LAYER_SELECTOR` + `hasLayer` (an open modal/dialog/alertdialog owns the keyboard)
  and `isTextEntryTarget` (inputs, textareas, selects and contenteditable keep their letters) —
  duck-typed on the target so it holds in DOM-less tests.
- **Allowed deps:** React (the viewport subscription hook only); `@thinkrail/locales` (the relative-time,
  compact-age and MCP state labels, resolved in the active locale at call time);
  `@thinkrail/contracts` (types only for canonical messages, `McpServerState`, and the `GitDiffScope` the
  default tab names read; the layout-resource identity input is a local structural type); `shiki`/`@shikijs/*` (the per-file shiki modules only — never reachable
  through the barrel).
- **Forbidden:** every app-internal module — this is a leaf.
