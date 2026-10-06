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

- **Owns:** `utils.ts` → `stripFrontmatter()` (drop a leading YAML `---`
  block so a rendered document doesn't show spec metadata as a heading) + `cssColorToHex()` (canonicalize
  a CSS color to hex — minified CSS serves `#fff`/`gray`-style equivalents, which strict consumers like
  Monaco and xterm reject; `""` when unparseable). Plus the primitives that more than one module needs and
  none should re-state: **`normalizePath()`** / **`isAbsolutePath()`** (a path from a pi tool call or the
  host may use either separator and may be relative or absolute — every path predicate in the app starts
  from these, so `chat`'s display helpers and `store`'s worktree matcher share one definition),
  **`viewport.ts`** → `isPhoneViewport()` plus the live `usePhoneViewport()` projection (coarse pointer
  or a viewport below 768px is phone-class; both media queries are observed), and **`shallowEqualArrays()`** (element-wise `Object.is` — the "did this really change?" test behind the
  store's snapshot-identity guard and `ErrorBoundary`'s reset keys), **`userText()`** (a user
  message's plain text — shared by `chat`'s transcript hydration/renderer and `store`'s live event
  fold, so "same message" means the same thing everywhere; it lives here because `store`'s edge to
  `chat/` is type-only), **`parseSkillInvocation()`** + **`matchesSkillInvocationCommand()`** (the
  anchored browser-side mirror of Pi's canonical expanded `<skill>` user-message grammar, shared by
  `chat`'s compact renderer and `store`'s optimistic-echo reconciliation; malformed/quoted blocks fail
  closed),
  **`relativeTime(ms, now)`** (`just now` / `5m ago` / `2d ago` against an explicit `now`, never `Date.now`
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
  **`DOUBLE_CLICK_SETTLE_MS`** (the one click→double-click arbitration window shared by cached and
  host-read tab opens), and the
  **`LayoutAttention`** device-local overlay shared by store, shell, and the headless layout child, with
  own-property-safe `readLayoutSelection()` / `readLayoutNavigationClock()`
  accessors for untrusted tuple-keyed maps and the key-order-independent `sameLayoutAttention()` equality
  that lets a no-op attention write be dropped before it reaches the store. Optional terminal recall is workspace-local history, not a second
  selected-tab authority; the layout owner validates it against current membership. Also the shared
  Shiki highlighter, **kept out of the barrel** so the eager `@/lib` import stays shiki-free:
  `highlighter.ts` owns the curated grammar/id/file-association catalog shared by chat and the desktop
  Monaco renderer, plus `createChatHighlighter(engine)`: `themes`' one generic CSS-variable registration
  and each chat grammar loaded on first use. Chat code is highlighted off the main thread:
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
  `@/lib/highlightCode`)
  from lazy chunks only; theme
  identity/palettes never live in `lib`. Collision-safe browser identity composition lives here too:
  **`tupleKey()`** length-prefixes independent strings, **`parseTupleKey()`** reads only its requested
  namespace, and **`layoutResourceIdentity()`** gives every frontend-local placement/cache alias one
  semantic resource key, so delimiters and stable noncanonical placement ids cannot split or alias identities.
- **Public surface (barrel):** `stripFrontmatter`, `cssColorToHex`, `isPhoneViewport`,
  `usePhoneViewport`, `normalizePath`, `isAbsolutePath`, `projectRelativePath` (canonical worktree-relative POSIX identity;
  collapses in-root `.`/`..` aliases but preserves an attempted leading escape for host rejection; Windows
  drive-rooted containment compares path/root case-insensitively while preserving the candidate's casing),
  `shallowEqualArrays`, `userText`, `isShellInert` (a value made only of characters that stay literal in POSIX, PowerShell,
  and cmd, so it may be interpolated into a command a human copies and runs), `parseSkillInvocation`, `matchesSkillInvocationCommand`,
  `relativeTime`, `platformShortcutLabel`, `hasPlatformModifier`, `platformFamily`, `copyText`, `randomId`,
  `DOUBLE_CLICK_SETTLE_MS`, `tupleKey`, `parseTupleKey`, `layoutResourceIdentity`,
  `readLayoutSelection`, `readLayoutNavigationClock`, `sameLayoutAttention`, the `LayoutAttention`
  type, and the keyboard gate shared by the shell's chords and the panels' plain-letter review
  shortcuts: `MODAL_LAYER_SELECTOR` + `hasLayer` (an open modal/dialog/alertdialog owns the keyboard)
  and `isTextEntryTarget` (inputs, textareas, selects and contenteditable keep their letters) —
  duck-typed on the target so it holds in DOM-less tests.
- **Allowed deps:** React (the viewport subscription hook only);
  `@thinkrail/contracts` (types only for canonical messages; the layout-resource identity input is a local structural type); `shiki`/`@shikijs/*` (the per-file shiki modules only — never reachable
  through the barrel).
- **Forbidden:** every app-internal module — this is a leaf.
