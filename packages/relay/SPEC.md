---
id: module-relay
type: module-design
status: active
parent: architecture
depends-on: []
title: Relay (signaling broker)
---

## Responsibility

A standalone, **zero-knowledge** signaling broker for the remote "add project by QR/link" mode. It pairs a
device to the host it names (by the host's public key) and relays opaque signaling frames between them so the
two can establish an **end-to-end-encrypted WebRTC DataChannel**. It is a separate deployable process, not
part of the engine host.

It never decrypts anything: the DataChannel it helps set up is E2E (DTLS), and the pairing challenge/proof it
relays are host-enforced (Ed25519), so the broker sees neither session content nor secrets — only routing
metadata (host public key, session ids, frame sizes). Self-hostable; the free hosted instance is no less
private because it carries only ciphertext and non-secret signaling.

See the home-directory plan and [[submodule-server-remote-transport]] (the host side of the same handshake).

## Boundary

- **Owns:**
  - `broker.ts` — the pure routing core (`createBroker`): a host registers by public key; a device
    `connect`s to that key; the broker opens a per-session pipe and relays `frame`s both ways, multiplexed
    so one host serves many concurrent devices. Lifecycle: device/host disconnect closes the affected
    sessions and notifies the peer. Socket I/O is abstracted (`BrokerSocket`) so the core is unit-tested
    without a network.
  - `server.ts` — `startBroker`, the thin Bun WebSocket wrapper over the core; `main.ts` the process entry.
- **Public surface:** the `index.ts` barrel.
- **Allowed deps:** `contracts` (the shared broker-frame protocol — `ClientToBroker` / `BrokerToClient`,
  `parseClientMessage`, `encodeBrokerFrame`; shared so the host can speak the same wire without importing this
  service), `node:crypto`, Bun. The broker stays content-agnostic: it must not depend on `server` or any
  domain type beyond the broker frames.
- **Forbidden:** parsing or persisting signaling `data`; terminating the E2E channel; any dependency that
  would let it see session content.

## Invariants

- **Zero-knowledge:** `data` is never parsed, logged, or stored. The broker's knowledge is limited to host
  keys, session ids, and byte counts.
- **Untrusted input:** every client frame passes `parseClientMessage`; a malformed frame closes the socket.
- A session is strictly two-party (one host, one device); a host serves many sessions concurrently.
- The pure core carries no I/O; the WebSocket server is a thin, replaceable shell.
