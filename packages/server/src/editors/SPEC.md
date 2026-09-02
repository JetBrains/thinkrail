---
id: submodule-server-editors
type: submodule-design
status: active
title: editors — host editor/IDE integration
parent: module-server
tags: [v1, public-surface-checked]
---

## Responsibility

Detect which editors/IDEs the host actually has installed, launch one detached at a worktree, and reveal a
worktree in the host's file manager — the workspace row's "Open in" menu.

## Boundary

- **Owns:** `listAvailableEditors()` — probes a fixed candidate list via `Bun.which` (VS Code `code`, Emacs
  `emacs`, Vim `vim`, and a JetBrains priority list of per-product launcher shims — `idea`, `webstorm`,
  `pycharm`, `goland`, `rider`, `clion`, `phpstorm`, `rubymine` — Toolbox creates one of these on PATH per
  installed product; there is no single "jetbrains" binary, so the first one found becomes the menu's one
  `"jetbrains"` entry, labeled for whichever product it is). Never a fixed client-side list: an editor that
  isn't on PATH is simply absent from the result, so the menu can't offer a dead entry. `openEditor(id,
  worktreePath)` resolves the id back to its binary (re-checking PATH — cheap insurance against an
  uninstall between `list` and click) and spawns it detached (`Bun.spawn(...).unref()`, matching
  `apps/cli`'s `openBrowser`); throws when the id is unknown or no longer installed. `revealInFileManager
  (worktreePath)` opens the OS's own file manager there: `open` (macOS), `explorer` (Windows), `xdg-open`
  (Linux desktop default) — fire-and-forget, so `explorer`'s well-known nonzero-on-success exit is never
  inspected.
- **Vim is `kind: "terminal"`, not launched here.** It has no GUI window of its own — spawning it detached
  with no attached TTY would just print "Warning: Output is not to a terminal" and exit. The **client**
  handles that case itself: open/focus the clicked workspace's embedded terminal and run `vim .` there
  (see `apps/web/src/panels/SPEC.md`), never calling into this module for it.
- **`Bun.which(bin)` alone reads the PATH snapshotted at process start, not the live `process.env.PATH`**
  (the same trap `shared`'s jbcentral notes) — `resolveShellEnv()` re-resolves PATH at host boot, so every
  lookup here passes `{ PATH: process.env.PATH }` explicitly (`defaultWhich`), or the fixed-up PATH would
  never be seen and an installed-but-not-on-the-snapshotted-PATH editor would wrongly read as absent.
- **`WhichFn`/`SpawnFn` are injectable seams**, not mocks of `Bun.which`/`Bun.spawn`:
  `listAvailableEditors`/`openEditor` take an optional `which`, and `openEditor`/`revealInFileManager` an
  optional `spawn` (both default to the real `Bun`-backed implementation) — so unit tests can fake which
  binaries "exist" and assert what would launch, without depending on what's installed on the machine
  running the tests or actually spawning a process. `revealInFileManager` also takes an optional
  `platform` (default `process.platform`), the same testable-parameter pattern `dialog`'s `pickersFor`
  uses, so its darwin/win32/linux branches are each asserted directly rather than only on whichever OS
  runs the test.
- **Public surface (barrel):** `listAvailableEditors`, `openEditor`, `revealInFileManager`, `WhichFn`,
  `SpawnFn`.
- **Allowed deps:** Bun (`Bun.which`, `Bun.spawn`), `process.env`/`process.platform`, `contracts` (the
  `EditorInfo` wire type).
- **Forbidden:** `host`; sibling features (`workspaces` resolves `worktreePath` before calling in — this
  module never looks up a workspace itself).
