---
id: module-relay
type: module-design
status: active
parent: architecture
depends-on: []
title: Relay (signaling broker)
---

## Responsibility

A standalone, **zero-knowledge** signaling broker for remote access (a phone or browser driving a host). It
pairs a device to the host it names (by the host's public key) and relays opaque signaling frames between them
so the two can establish an **end-to-end-encrypted WebRTC DataChannel**, and it hands out short-lived TURN
credentials when it runs alongside a TURN server. It is a separate deployable process: the host runs it
in-process for LAN/Tailscale use (`startLocalRelay`), and the same code ships as a container image for a
hosted or self-hosted public relay.

It never decrypts anything: the DataChannel is E2E (DTLS), both SDPs are signed by the endpoints' Ed25519
keys, and the QR token crosses it only as a hash and an HMAC, so the broker — or anyone running one — sees
neither session content nor secrets and cannot splice itself into a connection. It knows only routing
metadata (host public keys, session ids, byte counts, client addresses for rate limiting) and keeps it in
memory only.

See [[submodule-server-remote-transport]] (the host side of the same handshake) and
[[module-remote-client]] (the device side).

## Boundary

- **Owns:**
  - `broker.ts` — the pure routing core (`createBroker`). A host `register`s by public key and must answer
    the broker's `challenge` nonce with an Ed25519 signature over `registerTranscript` (`prove`) before it is
    addressable, so no one can take over or knock off another host's address; a valid re-registration
    replaces the previous connection. A device `connect`s to a key; the broker opens a per-session pipe
    (capped per host) and relays `frame`s both ways, multiplexed so one host serves many devices, attaching
    `iceFor()` TURN credentials to the device's `ready` only: one side's relay candidate crosses any NAT
    (TURN permissions are per IP), and the host's WebRTC stack would stall on an unreachable TURN. Disconnects close the affected sessions and
    notify the peer. Socket I/O is abstracted (`BrokerSocket`) so the core is unit-tested without a network.
  - `server.ts` — `startBroker`, the thin Bun WebSocket wrapper: `/health`, connections per client address
    (`X-Forwarded-For` only when `trustProxy`), a per-connection token-bucket message rate, the payload cap,
    and a deadline for a connection to register or connect.
  - `config.ts` — `configFromEnv`, the process configuration (`PORT`, `HOST`, `TRUST_PROXY`, limits,
    `TURN_URLS` + `TURN_SECRET` + `TURN_TTL_SECONDS`); a malformed value throws rather than defaulting.
  - `limits.ts` — the connection and rate limiters. `turnCredentials.ts` — coturn REST-API credentials
    (expiry username, HMAC-SHA1 password under the shared secret), so coturn needs no callback.
  - `main.ts` — the process entry. `Dockerfile` — the image over the `bun run build` bundle
    (`dist/relay.js`, which inlines `contracts`). `deploy/` — the self-host recipe: relay + Caddy (TLS,
    access log discarded) + coturn (private peer ranges denied).
- **Public surface:** the `index.ts` barrel.
- **Allowed deps:** `contracts` (the shared broker-frame protocol, `IceServer`, `registerTranscript`),
  `node:crypto`, Bun. The broker stays content-agnostic: it must not depend on `server` or any domain type
  beyond the broker frames.
- **Forbidden:** parsing, logging or persisting signaling `data`; terminating the E2E channel; any
  dependency that would let it see session content; secrets in the repository (deploy files carry
  placeholders, real values live in the deployment's environment).

## Invariants

- **Zero-knowledge:** `data` is never parsed, logged, or stored. Nothing is written to disk.
- **Untrusted input:** every client frame passes `parseClientMessage`; a malformed frame, a failed host proof,
  an over-rate or oversized message closes the socket.
- A host is addressable only after proving its key; a session is strictly two-party (one host, one device).
- The pure core carries no I/O; the WebSocket server is a thin, replaceable shell.
- Restart-safe: all state is in memory and rebuilt as hosts reconnect (they retry with backoff) and devices
  re-dial.

## Decisions

- **Relay data path stays WebRTC.** The relay brokers signaling and TURN; it does not carry session bytes
  over its WebSocket. Tunnelling the wire through the relay would need its own end-to-end encryption layer
  in place of DTLS, which the remote modules forbid hand-rolling.
- **Not required for the internet route.** A phone off the host's network signals through public Nostr
  relays ([[module-nostr-signaling]]), so this relay is the host's own for Wi‑Fi/Tailscale and the hosted
  or self-hosted option for operators who want their own rendezvous and TURN.
- **One image, many operators.** The public repository owns the relay code, its image and the self-host
  recipe; a hosted deployment's infrastructure and secrets live outside it and pull a pinned image version.

## Not yet here

- TURN over TLS on 443 (needs certificates shared with coturn) for networks that block UDP and 3478.
- Horizontal scaling: one process holds the host map, so several relays need routing by host key.
- A content-less push "wake" for paired phones.
