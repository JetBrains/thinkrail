---
id: submodule-web-remote
type: submodule-design
status: active
title: remote — device-side remote client
parent: module-web
depends-on: [module-contracts]
---

## Responsibility

The browser (device) side of the remote "open a project by link" flow: the wire client that runs the host
protocol over a WebRTC DataChannel, and the channel adapter over the native `RTCDataChannel`. It mirrors the
host's `remote-transport`/`remoteWireBridge`, but in browser-native terms — the browser needs no WebRTC or
crypto library, it has `RTCPeerConnection`, `WebSocket`, and `crypto.subtle` built in.

## Boundary

- **Owns:**
  - `deviceChannel.ts` — the `DeviceChannel` string interface and `toDeviceChannel`, adapting a native
    `RTCDataChannel` (decoding string / ArrayBuffer / Blob frames the host may send).
  - `deviceWireClient.ts` — `createDeviceWireClient`: sends `{ id, method, params }` requests, matches
    `{ id, ok, result | error }` replies by id (as promises, with `RemoteRequestError`), and fans
    `{ channel, data }` pushes to subscribers. **Reconnect-safe**: `attach` points it at a fresh channel and
    replays in-flight requests; a dropped channel does not fail them, only `close` does. Unit-tested with an
    in-memory channel.
  - `deviceConnector.ts` — `connectRemoteProject(link)`: parses the `thinkrail://pair` link, connects to the
    relay as the device, signs the challenge with `crypto.subtle` Ed25519 through the handshake, negotiates a
    browser `RTCPeerConnection` **answerer**, and attaches the opened DataChannel to the wire client. Holds a
    **persistent per-browser device key** (localStorage) and an **auto-reconnect loop** (backoff): the first
    attempt pairs with the token, reconnects re-authorize with `resume`. Uses the shared broker + signaling
    protocol from `contracts`; browser-only glue (no library bundled).
  - `remoteConnection.ts` — `createRemoteConnectionController`: the "add a project by link" lifecycle
    (validate link → connecting → connected | error), with the connector injected so it is unit-tested
    without a browser. The UI surface subscribes to it.
- **Allowed deps:** `contracts` (the shared broker + signaling + pairing-URI protocol), browser APIs. Never
  `server`, `pi`, or any server-only package.
- **Forbidden:** value-importing `pi` or `server`; a WebRTC/crypto library (use the platform).

The UI entry is `panels/ConnectByLinkDialog.tsx` (reached from the `AddProjectMenu` "Open a project by link"
item): it drives the controller and, on connect, calls `mountRemoteSession` so the remote host's projects and
sessions render in the normal UI via the shared channel→store wiring.

### Lightweight multi-host core (for a mobile "sessions pulled onto your phone" client)

A phone wants a *thin* view — the live sessions across several hosts (laptop, server), not the full IDE. These
framework-agnostic, unit-tested pieces are that core (a future `apps/mobile` Capacitor shell renders over them):

- `connectSavedHost` (in `deviceConnector.ts`) — reconnect to an already-paired host with no token, via
  `resume`. The first pairing still uses `connectRemoteProject` (link + token); `openRemote` is their shared
  machinery.
- `hostRegistry.ts` — the locally-stored set of paired hosts (`{ hostKey, relayUrl, label }`), over an
  injected `KeyValueStore` (web localStorage / Capacitor Preferences). No cloud account — the device pairs each
  host by link and remembers it.
- `remoteSessions.ts` — one wire client per host, aggregating their live `sessionState` into one list for the
  mobile session view. Connector injected for tests.

## Not yet here

- `/files` and `/blob` byte URLs over the data channel (markdown images, diff blobs) — `RemoteTransport.httpBase`
  returns empty until that tunnel lands.
- A deployed relay (+coturn) and the real cross-device run: end-to-end pairing is verifiable only with a
  deployed relay, a host, and a second device — not in this repo's test environment.
