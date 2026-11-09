---
id: module-remote-client
type: module-design
status: active
parent: architecture
depends-on: [module-contracts]
title: Remote client (device-side remote access)
---

## Responsibility

The browser/device half of remote "open a project (or its sessions) by link": the WebRTC data path, the wire
client over it, the pairing/reconnect connector, the locally-stored paired-host registry, and the multi-host
session aggregator. Used by both shells of `apps/web`: the IDE (open a remote project in the full UI) and the phone
shell (the lightweight "sessions on your phone" client that `apps/mobile` wraps). Framework-agnostic:
uses only platform APIs (`WebSocket`, `RTCPeerConnection`, `crypto.subtle`, `localStorage`), no UI.

## Boundary

- **Owns:**
  - `deviceChannel.ts` — `DeviceChannel` + `toDeviceChannel` (native `RTCDataChannel` adapter; contracts'
    channel framing both ways, binary frames read as `ArrayBuffer` so chunks keep their order).
  - `deviceWireClient.ts` — the reconnect-safe wire client (request/response + pushes, replay on `attach`;
    the snapshot push `server.welcome` is kept and replayed to a later subscriber, because the host sends it
    once as the channel opens — before any screen subscribes).
  - `deviceConnector.ts` — `connectRemoteProject` (first pairing, link + token) and `connectSavedHost`
    (token-less `resume`), sharing one WebRTC + auto-reconnect machinery; persistent device key. The relay is
    untrusted: `hello` sends only the token's SHA-256 id, the proof adds the token HMAC, the offer is applied
    only when the host key from the link signed it (bound to this attempt's nonce and challenge), and the
    answer is signed with the device key. TURN servers in the relay's `ready` join the public STUN set. Every
    attempt, reconnects included, races the host's relay addresses (`relayPicker.ts`'s `openFirstRelay`: the
    first socket to open wins, the rest close; none within 6s is a `RelayUnreachableError`, code
    `relay_unreachable`), so a phone moving between the host's Wi‑Fi and Tailscale takes whichever route
    works. The peer gathers through contracts' `PUBLIC_STUN_URLS`. A failed attempt rejects with a
    `RemoteConnectError` (`connectError.ts`) whose code names the cause — the relay's `no host available` /
    `host busy`, the host's coded `rejected` (read by reason from a host too old to send a code), a host key
    mismatch, a dropped relay — and an attempt with no open data channel after `CONNECT_TIMEOUT_MS` (20s) fails
    as `host_silent` when the host never answered, else `no_direct_route`, so the app never waits forever.
    A closed data channel counts as a drop like a failed peer, so a phone the computer revoked reconnects,
    and a reconnect refused for good (`unknown_device`, `identity_mismatch`, `app_outdated`) stops retrying,
    closes the connection and fires `onLost`; `remoteSessions` then drops that host and tells its `onLost`
    listeners.
  - `hostRegistry.ts` — the locally-stored set of paired hosts over an injected `KeyValueStore`; a host keeps
    every advertised `relayUrls` (older entries only the one `relayUrl`).
  - `remoteSessions.ts` — one wire client per host, aggregating live sessions into one list, plus each host's
    welcome (`welcomeFor`: protocol version and config) and what it lets this phone do (`accessFor`, `write` until a
    `remote.deviceAccess` push says `read`); `disconnect` closes and drops one host.
- **Public surface:** the `index.ts` barrel.
- **Allowed deps:** `contracts` (broker + signaling + pairing + session types), platform browser APIs. Never
  `server`, `pi`, `web`, or any UI package.
- **Forbidden:** value-importing `pi`/`server`; a WebRTC or crypto library (use the platform); any UI.

## Invariants

- No UI and no framework: a React shell (web or Capacitor) renders over this, never the other way.
- Reconnect-safe: a dropped channel does not fail in-flight requests; `attach` replays them. The device key
  persists so a reconnect re-authorizes the same registered device via `resume`.
- No offer is applied before its host signature verifies against the key the device paired with.
- The pure logic (registry, session aggregation) is unit-tested against injected storage/connectors.
