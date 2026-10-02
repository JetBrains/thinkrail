---
id: submodule-server-trash
type: submodule-design
status: active
title: trash — move a path to the OS trash
parent: module-server
tags: [public-surface-checked]
---

## Responsibility

Move a path to the operating system's trash, through the launcher-staged helpers when the host runs as a
compiled artifact. The one way anything in the host destroys a user's file.

## Boundary

- **Owns:** `trashFile(path, implementation?)` — one path, globbing disabled, **allowed to throw**: a
  caller that cannot recover the file must learn that the move failed instead of inheriting a silent
  permanent delete. `setBundledTrashHelpers` is the launcher seam (staged `macos-trash` /
  `windows-trash.exe` executables, because the `trash` package's own `new URL(…, import.meta.url)`
  points inside `/$bunfs/` after compilation); source mode and Linux delegate to `trash` itself, whose
  Linux path also needs the statically installed `@stroncium/procfs` `processMountinfo` parser that a
  compiled bundle cannot reach through a template-literal `require`. `setTrashImplementationForTests`
  swaps the whole implementation for tests that must not touch a real recycle bin.
- **Public surface (barrel):** `trashFile`, `setBundledTrashHelpers`, `setTrashImplementationForTests`,
  `TrashImplementation`, `BundledTrashHelpers`.
- **Allowed deps:** `trash` + `@stroncium/procfs` (external); Node `child_process`/`util`.
- **Forbidden:** `host`; sibling features; any permanent-`unlink` fallback.

## Consumers

Two features need "remove this file, recoverably", which is why this is a module of its own rather than
a helper inside either of them:

- `agent` — a chat's delete moves pi's transcript to the trash and rolls its tombstone back when that
  fails (see [[submodule-server-agent]]).
- `changes` — a whole-file revert of an added/untracked file trashes the worktree file and records
  where, so the most likely destructive mistake in review stays recoverable even after the host's own
  undo receipt is gone (see [[submodule-server-changes]]).
