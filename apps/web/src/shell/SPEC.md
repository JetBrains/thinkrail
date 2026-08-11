---
id: submodule-web-shell
type: submodule-design
status: active
title: shell — responsive frame
parent: module-web
tags: [v1, ui]
---

## Responsibility

The responsive frame and UI composition root: arranges panels into the 3-column desktop layout (and,
later, the mobile single-view-with-switcher).

## Boundary

- **Owns:** `Shell.tsx` — the topbar (the full supplied ThinkRail vector logo, rendered through the
  semantic `text-primary` colour so it remains legible in every theme; a compact store-derived
  **location context**; the connection-status pill; and a Settings gear that opens the store-driven
  `panels/SettingsDialog` via
  `store.openSettings()` — open state lives in the store, not local, so other surfaces (the Welcome
  provider warning) can open it too) over a body that branches on whether a workspace is active. The
  location context makes scope persistent rather than rail-dependent: an **active workspace** renders two
  lines — `project / workspace display name`, then the git `branch · from baseBranch` metadata line
  (proportional `tr-text-metadata text-text-subtle` per [[web-typography]]); a selected
  project with no active workspace renders `project / Project home`; no project leaves the logo alone.
  It follows the existing workspace lifecycle snapshots, so auto-renames update live. Responsive
  degradation drops the connection label to its still-labelled status dot below `sm`, then drops the
  base and project prefix before it drops active workspace/branch identity; the full logo stays visible.
  **Active workspace**
  → the resizable 3 columns (projects | center | right-over-terminals). **No active workspace**
  (`activeWorkspaceId == null` — fresh install / after archiving the last one) → the projects rail (kept
  resizable, `resize-left` preserved) beside the `panels/WelcomePanel`; the center/right/terminal surface
  is not mounted. The welcome-state group uses its own `autoSaveId` so it doesn't clobber the 3-column
  layout's saved sizes. Mounts the `panels/Toaster` once (outside both layout branches) so notifications
  show over either state. **Owns the theme DOM side-effect** — the single place that applies the store's
  (host-owned) opaque `theme` id: a `useEffect` on `store.theme` calls the `themes` module's atomic
  `applyTheme(theme)` + `writeThemeHint(theme)` (the localStorage first-paint cache). The value flows
  store ← transport (welcome /
  `settings.changed`); the shell just performs the swap, so no other component touches `[data-theme]`.
  **Owns the app-wide keyboard chords** — `useGlobalHotkeys.ts`, mounted once by `Shell`. See
  "Global chords" below.
- **Public surface:** `Shell`.
- **Allowed deps:** `panels`, `store` (status + theme + project/workspace context + the active-chat
  selector and `requestHistoryOpen`), `transport` (`ConnectionStatus` type), `components/ui`
  (resizable), `components/ErrorBoundary`, `constants` (branding), `themes` (`applyTheme`/`writeThemeHint`).
- **Forbidden:** `server`/`shared`/`pi`; being imported by `panels`/`store`/`transport`.

## Error resilience (why panels can't blank the app)

Panels render (and lazily import) untrusted-shaped data; a throw during render or a failed lazy chunk
(e.g. a stale Vite dep → 504) would otherwise propagate to the React root and unmount the **whole**
tree, leaving the bare gray `--bg-dark` background. So the shell wraps each independently-mounted
region — **center (`CenterTabs`)**, **right (`RightPanel`)**, **terminals (`TerminalsPanel`)** — in its
own `components/ErrorBoundary`, keyed with `resetKeys={[activeWorkspaceId]}` so switching workspace
clears a stuck error. A **last-resort boundary wraps `<Shell />` in `main.tsx`**. `CenterTabs` adds a
per-tab boundary (`resetKeys={[active.id]}`) so one bad tab keeps the tab strip usable. The boundary
detects failed dynamic imports (`isChunkLoadError`) and steers those to a page **reload** (re-fetches
the chunk) rather than an in-place retry. Each region degrades independently — never the whole app.

## Global chords (why a key handler lives this high up)

A chord that must work "wherever the user is" cannot be an element's `onKeyDown` — that only fires while
that element holds focus, and outside it the *browser* gets the keystroke. `useGlobalHotkeys` is the one
place that owns such chords: a single window listener in the **capture** phase, so it sees the keystroke
before any component does and can both `preventDefault` (deny the browser) and `stopPropagation` (deny
duplicate handling downstream).

Today that's **`Ctrl+R` → chat history search**. Previously handled only on the composer textarea, so
with focus anywhere else — the file tree, Monaco, a diff, the transcript, bare `<body>` — the browser
reloaded the app instead. It is deliberately *not* a browser-reserved chord (unlike `Ctrl+T`/`Ctrl+W`/
`Ctrl+N`), so swallowing it works. Routing goes through the store (`selectHistoryTarget` →
`requestHistoryOpen`), never a ref: the chord fires far outside the chat subtree entirely.

Because `CenterTabs` mounts one tab body at a time, "which chat" and "is it even mounted" are the same
question. `selectHistoryTarget` answers it: the active tab when that's a chat, else the workspace's most
recently opened one — and `requestHistoryOpen` **activates that tab atomically with the request**, so the
`ChatView` that mounts is the one that consumes it. Resolving to "no target" over a file/diff tab would
have been worse than the bug: the chord is swallowed there too, so it would silently do *nothing* over
Monaco, a diff, or the file tree — the very places this handler exists for. Only a workspace with **no**
chat tab at all has nothing to open; there the chord is purely swallowed (still never a reload).

**Matched by the physical key (`e.code`), never the produced character (`e.key`).** `e.key` depends on the
active layout — on a Cyrillic layout the R key produces `к` — so a `key`-based guard bailed out before
`preventDefault()` and the browser reloaded the app, defeating the whole point of the hook. `e.code` is
layout-independent, and it agrees with the terminal one layer down: xterm resolves its own chords through
`keyCode`, which browsers derive from the US layout. The same rule binds every letter chord in the app —
today that's this one plus the history overlay's `Cmd/Ctrl+S`.

Two carve-outs, both load-bearing:
- **Terminals.** A keydown from inside `.xterm` passes straight through — `Ctrl+R` there is the shell's
  reverse-i-search and belongs to the PTY. (`.xterm` is xterm's own root class, not a hook of ours.)
- **Reload stays reachable.** `Ctrl+Shift+R` (hard reload), `Cmd+R` (macOS), `F5` and the browser's own
  reload button are all untouched. Swallowing a reload chord is only acceptable while another one works.

The shell is the natural owner: it is the composition root, mounted exactly once for the app's lifetime,
and it already owns the other app-scoped DOM side-effect (the theme).
