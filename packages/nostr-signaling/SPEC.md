---
id: module-nostr-signaling
type: module-design
status: active
parent: architecture
depends-on: []
title: Nostr signaling (remote access over public relays)
---

## Responsibility

The internet route for remote access with no ThinkRail server: a message channel addressed by public key,
carried as NIP-44 encrypted **ephemeral** events (kind `25051`, NIP-01 range 20000–29999: relays forward
them and store nothing) over a set of public Nostr relays. It carries only the opaque signaling frames the
host and device already exchange through a relay broker (handshake, signed SDPs, ICE); the session itself
stays on the end-to-end WebRTC DataChannel. Used by the host
([[submodule-server-remote-transport]]) and the device ([[module-remote-client]]) alike, so both ends share
one envelope, ordering rule and relay list.

## Boundary

- **Owns:**
  - `envelope.ts` — `SIGNALING_KIND`, the `{ s: seq, d: data }` plaintext envelope and its untrusted-input
    parser (bounded seq and size), and `createInOrder`: frames reach a subscriber over several relays, so
    each sender's frames are re-ordered by seq before delivery (an ICE candidate must not overtake the
    answer it depends on).
  - `nostrSignal.ts` — `openNostrSignal`: subscribes on every relay to its own key (`#p`, a short `since`
    window), deduplicates by event id, drops stale events, decrypts, orders and delivers per sender; `send`
    publishes to all relays and resolves once one accepted; `ready` settles on the first live subscription
    (EOSE without a close — the pool reports a failed connection as EOSE then close) and rejects with
    `NostrUnreachableError` when none answers in time; a dropped subscription re-opens with backoff;
    `connectedRelays()` for status. Key helpers `generateNostrSecret` / `nostrPublicKey`.
  - `relays.ts` — `DEFAULT_NOSTR_RELAYS` and `normalizeRelays` (distinct `wss://`, loopback `ws://` for
    tests only, capped).
  - `testing.ts` (`./testing` export) — `startTestNostrRelay`, a minimal in-process NIP-01 relay for tests
    on either side.
- **Public surface:** the `index.ts` barrel; `./testing` for tests only.
- **Allowed deps:** `nostr-tools` (pure JS over `@noble`; only the `pure`, `nip44` and `pool` subpaths),
  platform `WebSocket`. Runs unchanged in Bun and the browser/WebView.
- **Forbidden:** any workspace package (it knows nothing of ThinkRail frames); parsing or logging the frames
  it carries; persisting anything.

## Invariants

- The relays are untrusted and see only ciphertext plus routing metadata (keys, timing, sizes, client IPs).
  Nothing they carry is a bearer secret: the handshake above sends the token's hash and HMAC and both SDPs are
  signed by the endpoints' Ed25519 keys, so a relay can withhold or delay frames but not pair, impersonate or
  splice a connection.
- Every frame goes to every relay; any one live relay suffices, and a dead or slow one costs nothing.
- Each sender's frames are delivered once and in send order.

## Decisions

- **Ephemeral events, not DMs.** NIP-17/59 gift wraps are stored by relays; signaling is useless seconds
  later and must not linger, so it uses the ephemeral range and NIP-44 directly.
- **The relay list travels in the pairing link.** The device dials the host's relays, so changing
  `DEFAULT_NOSTR_RELAYS` never strands a paired phone. The defaults were chosen by probing public relays for
  forwarding ephemeral events from unknown keys (some drop them silently, block the kind, or require a web of
  trust or payment).
- **A dependency for the crypto the platform lacks.** NIP-44 needs secp256k1 Schnorr and ChaCha20, which
  WebCrypto does not offer; `nostr-tools` brings audited `@noble` implementations. This package is the one
  place that dependency enters the device side.

## Not yet here

- TURN credentials over this route: the broker attaches them to `ready`, Nostr has no equivalent, so a phone
  reached this way has public STUN only and fails where both ends sit behind symmetric NAT or CGNAT.
- A per-host setting for the relay list (own or paid relays); the host takes it as an option today.
