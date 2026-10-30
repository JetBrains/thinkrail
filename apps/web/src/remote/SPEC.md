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
    `{ channel, data }` pushes to subscribers. Transport-agnostic over `DeviceChannel`, unit-tested with an
    in-memory channel.
  - `deviceConnector.ts` — `connectRemoteProject(link)`: parses the `thinkrail://pair` link, connects to the
    relay as the device, signs the challenge with `crypto.subtle` Ed25519 through the handshake, negotiates a
    browser `RTCPeerConnection` **answerer**, and resolves a wire client once the DataChannel opens. Uses the
    shared broker + signaling protocol from `contracts`; browser-only glue (no library bundled).
- **Allowed deps:** `contracts` (the shared broker + signaling + pairing-URI protocol), browser APIs. Never
  `server`, `pi`, or any server-only package.
- **Forbidden:** value-importing `pi` or `server`; a WebRTC/crypto library (use the platform).

## Not yet here (next slice)

- Wiring the client into the store/transport so a remote project opens in the normal UI, and the
  "add project by link" surface. End-to-end pairing is verifiable only with a deployed relay + a host and a
  second device.
