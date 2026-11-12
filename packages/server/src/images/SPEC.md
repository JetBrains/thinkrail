---
id: submodule-server-images
type: submodule-design
status: draft
title: images — image bytes off the WebSocket
parent: module-server
depends-on: [module-contracts]
tags: [public-surface-checked]
---

## Responsibility

Keep pi's base64 image bytes off the host→page WebSocket (#1180). Each host→page payload carries a
`WireImage` reference instead of the bytes, and the page fetches them over `GET /images/<sessionId>/<sha>`.
pi still owns the bytes in its messages and session files. This module owns only:

- the projection;
- a bounded cache of references to pi's strings;
- the route.

*Why:* a screenshot from `read` used to travel 4–5 times per run (`tool_execution_end`,
`message_start`/`message_end`, `turn_end.toolResults`, `agent_end.messages`), and again on every
transcript reload. A 39 MB chat (36.6 MB of screenshots) kept the socket past Bun's outbound buffer and
looped reconnects; see the host SPEC's outbound-limit bullet.

## Boundary

- **Owns:**
  - **`projectImages(value, sessionId)`** walks a value structurally. It copies only along the paths
    that hold an image, so pi's objects are never mutated and unchanged subtrees keep their identity.
    - It swaps each `{type:"image", data, mimeType}` with non-empty `data` for
      `{type:"image", mimeType, ref, width?, height?}`.
    - `ref` is `IMAGES_ROUTE + <sessionId>/<sha256(mimeType NUL data)>`. Hashing the MIME type too
      means equal bytes declared as different types never share a URL.
    - The hash and the header-sniffed `width`/`height` (`imageDimensions`) are memoized per block
      object, and re-validated against its `data` and `mimeType` when the block is seen again. pi
      reuses one block object through every echo and into its entries, so a live image is hashed once.
      A fresh parse, such as a child transcript poll, hashes again at about 0.4 ms/MB.
    - Every projected image is **registered**. That is how a just-published image is servable before
      pi has an entry for it.
  - **Cache.** An LRU of registered `{data, mimeType}`, bounded at 256 MiB of base64. It holds
    references to pi's strings, not copies.
    - **The cache is only a cache.** An injected source seam (`setImageSource`) answers misses from
      the live session, and says whether a session is still servable.
    - `forgetImageSession(sessionId)` drops a deleted chat's entries.
    - `resetImages()` clears everything when the server stops. Its `cacheLimitChars` option exists for
      tests.
    - `imageRefHash(block)` exposes the memoized hash, which the source's live lookup compares against.
  - **`serveImage(pathname)`** behaves as follows:
    - It validates a pi-session-id-shaped segment and a 64-hex sha, and ignores the query string
      (Retry's cache-buster).
    - On every request, hit or miss, and again after a miss resolves, it checks that the session is
      still servable.
    - It serves only `ACCEPTED_IMAGE_TYPES` (PNG, JPEG, GIF, WebP) and refuses anything else with 404,
      so a block that declares `text/html` never becomes a host-origin document.
    - Success sets `Content-Type`, `Content-Length`, `Cache-Control: no-store`, `nosniff` and the
      sandbox CSP. A miss is a `no-store` 404.
    - `no-store` is the user's decision: screenshots never persist in the browser's disk cache, and
      deleting a chat stops every later fetch. Images a page has already decoded stay in that page
      until it reloads.
  - **`imageDimensions(base64)`** reads the PNG/JPEG/GIF/WebP header from at most 256 KiB. The
    oversized-image guard in `agent` shares it.
- **Public surface (barrel):** `projectImages`, `imageDimensions`, `Dimensions`, `setImageSource`,
  `ImageSource`, `ImageBlock`, `imageRefHash`, `forgetImageSession`, `resetImages`, `serveImage`.
- **Allowed deps:** `contracts` (`IMAGES_ROUTE`, `ACCEPTED_IMAGE_TYPES`, `WireImage`), `log`, and Node
  `crypto`.
- **Forbidden:**
  - `host`, `agent` and every other feature. `agent` imports this module, and `host` injects the source.
  - Any persistent image store, and any disk read.

## Get right

- **The source scope is the owning chat.**
  - A subagent's images are registered under the **parent** chat's id, so deleting that chat retires
    them too.
  - After an eviction or a host restart, a child's image waits for the next transcript poll or
    reopen. There is no disk tier: no workspace is in the URL, and `SessionManager.open` may rewrite a
    file.
  - After a host restart, a page's resync re-reads every mounted transcript, and that re-registers it.
    The page's tile retries only after that resync (chat SPEC), never on the raw reconnect.
- **Composer-bound replies stay inline.** Queue restore (`clearQueue`, `removeQueued`,
  `abort{restoreQueue}`) and `workspace.dismissCreation` hand images back to the composer, which
  re-sends them. They are not projected, and the host's 256 MiB outbound limit still covers them.
- **A hash is an identifier, not a secret.** The host has no auth ([[architecture]] Decision 7). The
  route's protections are its type allow-list and its servable check, not URL secrecy.
