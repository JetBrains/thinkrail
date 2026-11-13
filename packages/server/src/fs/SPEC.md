---
id: submodule-server-fs
type: submodule-design
status: active
title: fs — contained worktree reads, copy, move and delete
parent: module-server
depends-on: [module-contracts, submodule-server-trash]
tags: [public-surface-checked]
---

## Responsibility

Read directories and files inside a workspace's worktree, path-contained; carry out the user-initiated
mutations of the Files tree and the Artifacts tool — **copy** an entry into a worktree folder, **rename**
or **move** one, and **delete** one to the OS trash —
under the same containment; and decide **what a resource's bytes are** — the one byte-level
classification every content read in the host shares. Agent and review writes are not this module's:
`changes` owns review reverts and pi writes through its own tools.

## Boundary

- **Owns:** `readDir`/`readFile(workspaceId, path)` — every path resolved + contained to the worktree
  root; `.git` hidden; directories sorted first; a symlink lists as `dir` only when its target is a
  directory inside the worktree, otherwise as `file`. `readDir` reports worktree-relative paths with `/`
  separators on every OS — the same form git status and watch events use — so a browser can match a
  listed node to a changed path (Windows' `relative()` would otherwise yield `src\auth`). (`.thinkrail/` is **not** hidden — it is shown like any
  other dir, so future host-managed content there stays visible; its ephemeral `context/` is kept out of
  git, not out of the tree.) `readFile` answers **`{ content, meta }`**: a file is read as bytes and
  decoded only when it is text; with `{ maxBytes }` it opens the file once and reads it in 64 KiB chunks,
  at most `maxBytes + 1` bytes in all, refusing a larger file with `CodedError("FILE_TOO_LARGE")` before
  classifying — whatever the file grows to meanwhile, and without allocating the cap up front (`maxBytes`
  must be a non-negative integer), so `content` is `""` for a byte-only resource and the client fetches
  those bytes over the host's `/files` route instead of receiving mojibake.
  **`resolveWorktreeFile(workspaceId, path)`** returns the
  contained absolute path for the host to stream a file's raw bytes over HTTP (the `/files/…` route
  serving relative images in the markdown viewer, the `/blob` route's containment check) and for the
  `changes` module's atomic writes. Lexical escapes, `.git`, and an existing symlink chain whose resolved
  target leaves the worktree are refused; missing leaf paths are allowed so a deleted file can be
  restored. **`resolveWorktreeEntry(workspaceId, path)`** validates an entry itself rather than what it
  points at: containment runs through the parent, so the caller's own `lstat` can reject even an escaping
  leaf symlink without following it, and it also answers that parent's validated real path — what a
  trash claim is verified against (`changes` uses it for its writes and claims). **`readableFileSize(root,
  path)`** applies the same rule under a root without a workspace lookup: the byte size of the regular
  file `readFile` would serve, `"missing"` for anything it would refuse or cannot read as a file (an
  escape, `.git`, a directory, a gone, dangling or looping path), `null` when the stat failed otherwise
  (a permission error) — `host` injects it into the search palette's file hits so none leads to a read
  that fails. This module owns the path safety; its callers own the streaming and the writing. **`workspaceRelativePath(root, path)`** is the one
  conversion from a native or absolute path to the wire's worktree-relative POSIX form (architecture
  Decision 22): resolved against the root, `null` when outside (a name such as `..env` is inside), `""` for
  the root itself. `reviews` normalizes anchors through it. It keeps host
  semantics, so a backslash on POSIX stays part of a file name; callers that hold model-written paths turn
  `\` into `/` themselves.
  **`copyWorktreeEntry({ sourceWorkspaceId, sourcePath, destinationWorkspaceId, destinationDirectory })`**
  (`mutations.ts`) copies a file, folder or symlink into a folder of the same or another workspace — a
  copy, never a move. The source resolves through its contained parent without following its leaf, the
  destination folder through the full chain; `.git`, escapes and the worktree root itself (it has no
  contained parent) are refused. The first free name among `name`, `name copy`, `name copy 2`, …
  (` copy N` goes before a file's extension, never inside a folder's name) is claimed with an exclusive
  create (`O_CREAT | O_EXCL | O_NOFOLLOW`, non-recursive `mkdir`, `symlink`), so a copy never overwrites
  anything, including an entry another writer creates meanwhile. A folder is planned before anything is
  written — an iterative walk that never follows a symlink, skips nested `.git`, refuses
  sockets/FIFOs/devices and stops with `CodedError("COPY_TOO_LARGE")` past `MAX_COPY_ENTRIES` (10,000) —
  so pasting a folder into itself copies a finite snapshot and an oversized tree writes nothing. Entries
  are then created in plan order (parents first); a symlink is recreated verbatim, never dereferenced, and
  a file's bytes stream between two descriptors with its permission bits carried over. A failure mid-copy
  leaves the partial copy in place and throws — this module never hard-deletes, not even its own output.
  It answers the copy's worktree-relative path plus every path it wrote, for the host's invalidation.
  **`deleteWorktreeEntry(workspaceId, path)`** moves a file, folder or symlink to the OS trash through
  `trash.claimAndTrashFile` — the same claim-then-trash path `changes` uses: renamed to a hidden
  `.thinkrail-delete-<uuid>` sibling before the awaited trash move, so a path the agent recreates
  meanwhile is never the object trashed, and restored (or preserved as `.thinkrail-recovery-<uuid>`) when
  the trash fails. The leaf is not followed, so deleting a symlink removes the link, never its target;
  `.git`, escapes and the worktree root are refused. It reports whether the entry was a folder, whose
  unlisted contents the host's invalidation must treat as unknown.
  **`renameWorktreeEntry(workspaceId, path, name)`** renames an entry in its folder (no `/`, `\`, NUL,
  `.`, `..` or `.git` in the name) and **`moveWorktreeEntry`** (`copyWorktreeEntry`'s params) moves one into
  a folder of the same or another workspace — the Files tree's and Artifacts' Rename and Cut-and-Paste.
  Both resolve like the delete (source leaf not followed, destination folder fully resolved), never
  replace another entry (`CodedError("ENTRY_EXISTS")`, though a case-only rename of the same inode is
  allowed), refuse a folder moved into itself, and treat pasting into the entry's own folder as a no-op.
  The free-name check and the `rename` run in one synchronous pass; Node has no `renameat2`
  `RENAME_NOREPLACE`, so a writer creating that exact name between those two syscalls is the residual
  window. A move across filesystems (`EXDEV`) falls back to a copy followed by the claimed delete-to-trash
  of the source. Each answers `{ from, path, directory, written }` for the host's invalidation.
  None of these mutations checks whether an
  agent is running — the user's explicit action wins, and the web says so before a delete.
  **Every mutation races a live agent, so no check is trusted across an `await`** (the per-workspace
  change lock serializes host mutations, not the agent's own writes). A delete validates containment,
  `lstat`s the leaf and renames it into its claim in one synchronous pass, and the claim is accepted only
  when it still carries the validated `dev`/`ino` inside the validated real parent. A copy records the
  `dev`/`ino` of every folder it lists or creates and of every entry it plans; each operation then runs as
  one synchronous check-and-act step — the parent folder's real path re-resolved, re-checked for
  containment and matched against its recorded identity, then the `mkdir`/`symlink`/exclusive `open` (or,
  on the source side, the `lstat`+`readlink` of a link and the `O_NOFOLLOW` `open` of a file whose
  `fstat` must match the plan) under that real path, and a created entry is kept only if the parent still
  verifies afterwards (a created file must also be the inode its descriptor holds). Only the byte
  streaming between the two descriptors — both pinned to verified inodes — is awaited, and the loop
  yields between entries, so no single step blocks the event loop for more than one folder's listing.
  Any mismatch — a folder turned into a link, an entry replaced, moved out of the worktree or gone —
  stops the copy with `CodedError("ENTRY_CHANGED")`, keeping what was already written; a delete restores
  the claim and throws the same code. **Residual window:** Node has no `openat`/`renameat`, so the path
  is still re-walked between the check and the act of one synchronous step. A process swapping a folder
  within those few consecutive syscalls can make the act land elsewhere, but the follow-up identity check
  refuses it: a delete puts the claim back (or, if the swap was already undone, leaves the stranger
  under its hidden claim name, untrashed), and a copy stops before writing into anything it did not
  verify — at worst leaving one empty file, folder or link where the swapped path pointed, or one copied
  link carrying the text of the link the swap put in its source's place.
  **Content classification** (`content.ts`, pure, no dependency): `CONTENT_SNIFF_BYTES` names the shared
  8 KiB bounded-head size; `classifyBytes(bytes)` → `{ text, mime? }` — **mime** is what the *bytes*
  prove (magic numbers for png/jpeg/gif/webp/avif/bmp/ico/pdf/zip/gzip/woff/woff2; AVIF accepts `avif` or
  `avis` in the initial `ftyp` box's major or compatible brands, bounded by that box and the sniff head;
  BMP needs its `BM` signature **and** a known DIB header size (12/40/52/56/64/108/124) at offset 14 —
  two printable letters prove nothing, so prose starting with "BM" stays text;
  plus `image/svg+xml` for
  text whose first element is `<svg>` or `<svg/>`, after any XML declarations, comments, processing
  instructions or doctype in the bounded head — a nested or quoted `<svg>` does not establish the root,
  and `application/vnd.git-lfs` for a text file of at most 1 KiB that is exactly the three-line pointer
  `git lfs` itself writes — `version`, `oid sha256:`, `size`, in that order, nothing else, so no prose
  that merely quotes a pointer can be mistaken for one — so a `.png` whose content is a pointer is
  reported as the pointer it is, not as an image that failed to decode); **text** is "no recognized binary magic number, no NUL byte in the first 8 KiB, and a strict
  UTF-8 decode" (a BOM is text; an SVG is text because `image/svg+xml` is inferred from text, never
  from a magic number). A magic number wins over decodability: an uncompressed PDF is valid ASCII, yet
  it is a document the PDF renderer owns, not source the code renderer may claim; `hashBytes(bytes)` → the sha-256 hex that **is** a
  resource's identity on the wire (`ResourceMeta.hash`, `ReviewAnchor.contentHash`, the `change.*`
  compare-and-swap); `decodeText(bytes)` → the one UTF-8 decode (BOM retained, because the BOM is part
  of the bytes the hash covers); `mimeFromPath(path)` owns the filename fallback no byte inspection can
  give (markdown/json/csv/yaml/html/xhtml/plain); `resourceMeta(bytes, path)` → the wire's **`ResourceMeta`**, adding that
  fallback and treating
  `null` bytes as absence (`hash`/`byteLength` null, `text: true` — nothing to decode, and the empty
  string it pairs with is valid text).
- **Public surface (barrel):** `readDir`, `readFile`, `readableFileSize`, `resolveWorktreeFile`,
  `resolveWorktreeEntry`, `workspaceRelativePath`,
  `copyWorktreeEntry`, `deleteWorktreeEntry`, `renameWorktreeEntry`, `moveWorktreeEntry`,
  `classifyBytes`, `CONTENT_SNIFF_BYTES`, `mimeFromPath`,
  `hashBytes`, `decodeText`, `resourceMeta`.
- **Allowed deps:** `persistence` (workspace lookup); `trash` (`claimAndTrashFile`, the delete);
  `contracts` (`FileNode`, `ResourceMeta`); `shared` (`CodedError`); Node
  `fs`/`path`/`crypto`/`stream`/`timers`.
- **Forbidden:** `host`; sibling features.

## Get right

- **One classification, one hash.** Textness, media type and the sha-256 of a resource are decided here
  and nowhere else: `reviews` captures anchors with them, `git` stamps both diff sides with them, and
  `changes` guards its writes with them. Two implementations would let a comment's `contentHash` and a
  revert's `expect` hash disagree about the same bytes.
- **A mutation never overwrites and never hard-deletes.** Every create is exclusive, and the only removal
  is the OS trash; that is what makes a mistaken paste or delete recoverable without an undo of its own.
- **Extension never beats the bytes.** A `.md` file whose content is a PNG reports `image/png`; the
  filename is consulted only when the bytes say nothing, so a mislabelled resource cannot talk a
  renderer into parsing it as text.
