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
  **`claimAndTrashFile(path, claim, recovery, expected)`** is the one claim-then-trash path for a worktree
  entry that a live writer (the agent) may recreate: it synchronously renames `path` to the caller-named
  hidden `claim` before awaiting the trash move, so a recreation lands on the real path and is never the
  object trashed. `expected` (`ClaimedEntry`: the validated real `parent` plus the leaf's `dev`/`ino`) is
  what the caller checked in the same synchronous pass; before awaiting anything, the claim must still be
  that inode and its folder must still resolve to that parent, or the claim is put back and
  `CodedError("ENTRY_CHANGED")` is thrown — so a folder swapped for a link between the caller's check and
  the rename never gets an entry outside the worktree trashed. When the trash (or that check) fails it
  restores the claim without overwriting — a hard link for a file, a recreated link for a symlink, a
  `rename` for a folder (which only replaces an *empty* folder) — and, if a concurrent recreation still
  wins, preserves the claim at `recovery` and names that path in the thrown error. Callers choose the
  names (`changes` keeps its ULID receipt names, `fs` uses a UUID).
- **Public surface (barrel):** `trashFile`, `claimAndTrashFile`, `ClaimedEntry`, `setBundledTrashHelpers`,
  `setTrashImplementationForTests`, `TrashImplementation`, `BundledTrashHelpers`.
- **Allowed deps:** `trash` + `@stroncium/procfs` (external — its deep imports name their `.js` files,
  since Node ESM, which hosts the workflow harness, rejects directory and extensionless specifiers);
  `shared` (`CodedError`); Node `child_process`/`fs`/`path`/`util`.
- **Forbidden:** `host`; sibling features; any permanent-`unlink` fallback.

## Consumers

Four features need "remove this, recoverably", which is why this is a module of its own rather than
a helper inside any of them:

- `agent` — a chat's delete moves pi's transcript to the trash and rolls its tombstone back when that
  fails, and deleting a chat without a project moves its delegated conversations' store there too (see
  [[submodule-server-agent]]).
- `changes` — a whole-file revert of an added/untracked file trashes the worktree file and records
  where, so the most likely destructive mistake in review stays recoverable even after the host's own
  undo receipt is gone (see [[submodule-server-changes]]).
- `fs` — the Files tree's Delete claims and trashes a worktree file, folder or symlink through
  `claimAndTrashFile`, the same path `changes` uses (see [[submodule-server-fs]]).
- `host` — deleting a chat without a project trashes the chat's whole folder after the agent trashed its
  transcripts, so the files the agent wrote there survive a mistaken delete (see
  [[submodule-server-host]]); `workspaces` itself never trashes, the host composes it.
