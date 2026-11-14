---
id: module-remote-client
type: module-design
status: active
parent: architecture
depends-on: [module-contracts, module-nostr-signaling]
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
  - `deviceWireClient.ts` — the reconnect-safe wire client (request/response + pushes, replay on `attach`
    after a `resume` naming the ids still awaited, the responses read `ack`ed in one frame per microtask; ids are unique per client so the
    host's replay cache never mistakes a restarted app's request for an old one;
    the snapshot pushes `server.welcome` and `remote.hostRoutes` are kept and replayed to a later subscriber,
    because the host sends them once as the channel opens — before any screen subscribes).
  - `deviceConnector.ts` — `connectRemoteProject` (first pairing, link + token) and `connectSavedHost`
    (token-less `resume`), sharing one WebRTC + auto-reconnect machinery; persistent device key. A connection's
    `ConnectionEvents` (`onLost`, `onOpenChange`, `onRetryFailed`, `onRoutes`) are given when it is created, so
    none is missed or replayed. `connectSavedHost` returns at once and its reconnect loop makes every attempt,
    the first included: a host not reachable yet is retried like a dropped one. Pairing makes its own first
    attempt and rejects to the caller when it fails (a bad or expired code is reported, never retried); only
    then does the loop take over. The relay is
    untrusted: `hello` sends only the token's SHA-256 id, the proof adds the token HMAC, the offer is applied
    only when the host key from the link signed it (bound to this attempt's nonce and challenge), and the
    answer is signed with the device key. TURN servers in the relay's `ready` join the public STUN set. Every
    attempt, reconnects included, opens its signaling through `signalingRoute.ts`: the host's relay addresses
    race (`relayPicker.ts`'s `openFirstRelay`: the first socket to open wins, the rest close) alongside the
    host's Nostr route from the link (`createNostrPipe`, a fresh Nostr key per attempt), and
    `pickSignalingPipe` keeps a relay that is ready within `LOCAL_ROUTE_GRACE_MS` (it is the host itself on a
    shared network), else the ready Nostr route; both failing is the relay's own refusal when it gave one,
    else a `RelayUnreachableError` (code `relay_unreachable`) naming every address; the losing routes are closed, and an open relay socket that does not
    answer `connect` within `BROKER_READY_TIMEOUT_MS` (8s) fails as `relay_lost`. A phone moving between the
    host's Wi‑Fi, Tailscale and any other network takes whichever route works. The peer gathers through contracts' `PUBLIC_STUN_URLS`. A failed attempt rejects with a
    `RemoteConnectError` (`connectError.ts`) whose code names the cause — the relay's `no host available` /
    `host busy`, the host's coded `rejected` (read by reason from a host too old to send a code), a host key
    mismatch, a dropped relay — and an attempt with no open data channel `CONNECT_TIMEOUT_MS` (20s) after it began
    (signaling included) fails as `relay_unreachable` with no route ready, `host_silent` when the host never
    answered, else `no_direct_route`, so the app never waits forever; every exit (failure, timeout, `close`)
    closes that attempt's signaling and peer. Once the data channel opens, only the peer and the channel can end
    the connection: later host frames (a replayed `challenge`, a `rejected`) and a lost signaling route are
    ignored, a Nostr route is closed (the host does not tie the peer to it; a relay route stays, because the host
    closes its peer with the relay session), and a second `challenge` mid-handshake is not answered again.
    A closed data channel counts as a drop like a failed peer, so a phone the computer revoked reconnects,
    and a reconnect refused for good (`unknown_device`, `identity_mismatch`, `app_outdated`) stops retrying,
    closes the connection and fires `onLost`; `remoteSessions` then drops that host and tells its `onLost`
    listeners. The retry schedule is `reconnectLoop.ts`; `onOpenChange` reports the channel opening, going down
    and coming back, `onRetryFailed` each failed attempt meanwhile (so the app shows why), `reconnectNow` skips the wait and first drops a channel that looks open while its
    peer is not `connected` or the channel is not `open` (a phone woken from suspension). The host's `remote.hostRoutes` push replaces the routes later attempts
    dial and reaches `onRoutes`, so a phone paired before a route existed (Nostr) or before the computer's
    address changed follows the computer without a new QR.
  - `reconnectLoop.ts` — `createReconnectLoop`: one attempt at a time, doubling capped backoff reset on
    success, `now()` to retry at once, a terminal failure ending it (`isTerminalConnectError`); a drop reported
    while an attempt is still settling is retried rather than left open, and `stop()` silences a late result.
  - `signalingRoute.ts` — `SignalingPipe` (one route's frame exchange: `ready` with any TURN servers,
    `listen`, `send`, `close`), `createBrokerPipe`, `createNostrPipe`, `pickSignalingPipe` and
    `openSignaling`, the route choice above.
  - `hostRegistry.ts` — the locally-stored set of paired hosts over an injected `KeyValueStore`; a host keeps
    every advertised `relayUrls` (older entries only the one `relayUrl`) and its Nostr route; `update`
    replaces one in place (never re-adding a forgotten host), `withRoutes` merges the routes a host sent.
  - `remoteSessions.ts` — one connection per host, aggregating live sessions into one list, plus each host's
    welcome (`welcomeFor`: protocol version and config), what it lets this phone do (`accessFor`, `write` until a
    `remote.deviceAccess` push says `read`) and how its connection stands (`connected`, `connecting`, or
    `unreachable` with the last failure — recorded from its own `onOpenChange` / `onRetryFailed` / `onLost`, so
    the app keeps no failure state of its own). `snapshot()` is all of it as one immutable value, replaced on
    every notify, for `useSyncExternalStore`. `clientFor` stays null until a host's channel first opened. `connect`
    tracks a saved host at once (its connection retries on its own); for a tracked host it retries now and, when
    its channel is down, reads `connecting` again until that attempt lands or fails. `pair` tracks the connection
    that paired, so pairing is one handshake. `disconnect` closes and drops one host; a dropped connection's
    late reports are ignored. A host lost for good keeps its refusal as status until it is connected again or
    disconnected; `onRoutes` hands back the saved host merged with the routes it sent, and later retries dial
    them; `reconnectNow` retries every host now. `stop` closes everything, and a pairing landing after it is closed.
- **Public surface:** the `index.ts` barrel — the controller (`createRemoteSessions` and its types), the
  registry, `connectRemoteProject` (the IDE's open-by-link), `DeviceWireClient`, and the errors
  (`RemoteConnectError`, `RelayUnreachableError`, `RemoteRequestError`). The channel adapter, the wire client
  factory and `connectSavedHost` are internal.
- **Allowed deps:** `contracts` (broker + signaling + pairing + session types), `nostr-signaling` (the
  internet route), platform browser APIs. Never `server`, `pi`, `web`, or any UI package.
- **Forbidden:** value-importing `pi`/`server`; a WebRTC or crypto library of its own (use the platform; the
  secp256k1/ChaCha20 that NIP-44 needs stays inside `nostr-signaling`); any UI.

## Invariants

- No UI and no framework: a React shell (web or Capacitor) renders over this, never the other way.
- Reconnect-safe: a dropped channel does not fail in-flight requests; `attach` replays them. The device key
  persists so a reconnect re-authorizes the same registered device via `resume`.
- No offer is applied before its host signature verifies against the key the device paired with.
- The pure logic (registry, session aggregation, retry schedule) is unit-tested against injected
  storage/connectors/timers.
- A host never stays down for want of a tap: every failure but a terminal refusal is retried on its own.
