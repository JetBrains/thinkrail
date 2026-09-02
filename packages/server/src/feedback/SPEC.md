---
id: submodule-server-feedback
type: submodule-design
status: active
title: feedback — host-scoped interview invitations
parent: module-server
tags: [v1, feedback, research]
depends-on: [module-contracts]
---

## Responsibility

Own the host-scoped lifecycle for automatic product-interview invitations. Count accepted user-authored messages from feature rollout onward, persist postponement/permanent dismissal, and offer one addressed invitation when due. The Settings booking link is independent and never mutates this lifecycle.

## Boundary

- **Owns:** validated `feedback.json` state (`acceptedMessages`, `nextInvitationAt`, `dismissed`); the fixed 10-message initial/retry interval; one memory-only claimant client; `recordAcceptedMessage(clientKey)`; `respondToInterview("book" | "postpone" | "never")`; `releaseInterview(clientKey)`; an injected addressed-invitation publisher; and reset seams for tests.
- **Public surface (barrel):** the lifecycle operations, reconnect redelivery seam, publisher installer, and test reset.
- **Allowed deps:** `persistence` (`dataDir` only); `contracts` (`InterviewResponse`, type-only); Node filesystem/path APIs.
- **Forbidden:** `host` or another feature sibling; analytics; transcripts/session files; browser/UI code; Google Calendar or any network access; exposing counters or client identity on the wire.

## Get right

- A missing or malformed file starts at `{ acceptedMessages: 0, nextInvitationAt: 10, dismissed: false }`; historical transcripts are never scanned. Non-negative safe integers and a boolean are the complete accepted schema. Every update writes a same-directory temporary file and atomically renames it over `feedback.json`, cleaning the temporary path on failure, so a partial write cannot erase a previously durable permanent dismissal.
- `host` calls `recordAcceptedMessage` only after `ackSend` accepts a non-control `prompt`, `steer`, or `follow_up`. The synchronous persist happens inside the replay-cached request execution, so request replay cannot double-count. A count persistence failure is swallowed without disturbing an existing claim; the increment remains cached in memory and is retried with the next accepted send, but no newly-due invitation is offered until that state is durable. A publication failure releases only the claim created for that delivery. Interview bookkeeping must never turn an already-accepted product message into a rejected send.
- Reaching `nextInvitationAt` claims at most one opaque client key and invokes the injected addressed publisher. While claimed, other clients do not receive the popup. Failed delivery or final client reap after the reconnect grace releases the memory-only claim; a transient reconnect re-delivers it to that same client after welcome, while restart releases it and welcome clears any stale browser projection while durable eligibility remains. Clients advertise their wire version in the socket handshake, and a client older than the invitation channel cannot retain a claim.
- `postpone` sets `nextInvitationAt = acceptedMessages + 10`; `book` and `never` set `dismissed = true`. Each response clears the claim after persistence. Once dismissed, later sends neither count nor offer.
- This state never depends on, emits to, or is disabled by anonymous analytics. Only a user's explicit browser navigation contacts the supplied Calendar URL.
