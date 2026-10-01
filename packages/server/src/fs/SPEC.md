---
id: submodule-server-fs
type: submodule-design
status: active
title: fs — worktree file reads
parent: module-server
depends-on: [module-contracts]
tags: [public-surface-checked]
---

## Responsibility

Read directories and files inside a workspace's worktree, path-contained, and decide **what a resource's
bytes are** — the one byte-level classification every content read in the host shares.

## Boundary

- **Owns:** `readDir`/`readFile(workspaceId, path)` — every path resolved + contained to the worktree
  root; `.git` hidden; directories sorted first. (`.thinkrail/` is **not** hidden — it is shown like any
  other dir, so future host-managed content there stays visible; its ephemeral `context/` is kept out of
  git, not out of the tree.) `readFile` answers **`{ content, meta }`**: a file is read as bytes and
  decoded only when it is text, so `content` is `""` for a byte-only resource and the client fetches
  those bytes over the host's `/files` route instead of receiving mojibake.
  **`resolveWorktreeFile(workspaceId, path)`** returns the
  contained absolute path for the host to stream a file's raw bytes over HTTP (the `/files/…` route
  serving relative images in the markdown viewer, the `/blob` route's containment check) and for the
  `changes` module's atomic writes. Lexical escapes, `.git`, and an existing symlink chain whose resolved
  target leaves the worktree are refused; missing leaf paths are allowed so a deleted file can be
  restored. `changes` passes `{ followLeaf: false }` so containment validates through the parent and its
  own `lstat` can reject even an escaping leaf symlink without following it. This module owns the path
  safety; its callers own the streaming and the writing.
  **Content classification** (`content.ts`, pure, no dependency): `CONTENT_SNIFF_BYTES` names the shared
  8 KiB bounded-head size; `classifyBytes(bytes)` → `{ text, mime? }` — **mime** is what the *bytes*
  prove (magic numbers for png/jpeg/gif/webp/avif/bmp/ico/pdf/zip/gzip/woff/woff2, plus `image/svg+xml` for
  text whose root element is `<svg>`, directly or behind an XML prolog — a prolog alone is not an
  image); **text** is "no recognized binary magic number, no NUL byte in the first 8 KiB, and a strict
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
- **Public surface (barrel):** `readDir`, `readFile`, `resolveWorktreeFile`, `classifyBytes`,
  `CONTENT_SNIFF_BYTES`, `mimeFromPath`, `hashBytes`, `decodeText`, `resourceMeta`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (`FileNode`, `ResourceMeta`); Node
  `fs`/`path`/`crypto`.
- **Forbidden:** `host`; sibling features.

## Get right

- **One classification, one hash.** Textness, media type and the sha-256 of a resource are decided here
  and nowhere else: `reviews` captures anchors with them, `git` stamps both diff sides with them, and
  `changes` guards its writes with them. Two implementations would let a comment's `contentHash` and a
  revert's `expect` hash disagree about the same bytes.
- **Extension never beats the bytes.** A `.md` file whose content is a PNG reports `image/png`; the
  filename is consulted only when the bytes say nothing, so a mislabelled resource cannot talk a
  renderer into parsing it as text.
