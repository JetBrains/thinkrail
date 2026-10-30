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
- **Allowed deps:** `contracts` (the shared broker + signaling protocol, once the link/pairing glue lands),
  browser APIs. Never `server`, `pi`, or any server-only package.
- **Forbidden:** value-importing `pi` or `server`; a WebRTC/crypto library (use the platform).

## Not yet here (next slice)

- The link/pairing/WebRTC connector: parse the `thinkrail://pair` link, connect to the relay as the device,
  sign the challenge (`crypto.subtle` Ed25519) through the handshake, negotiate a browser `RTCPeerConnection`
  answerer, and hand the opened channel to `createDeviceWireClient`. This needs the signaling + pairing
  protocol shared into `contracts` (today it lives in the server's `remote-transport`/`remote`).
- Wiring the client into the store/transport so a remote project opens in the normal UI, and the
  "add project by link" surface.
