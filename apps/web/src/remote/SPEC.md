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
  - `remoteConnection.ts` — `createRemoteConnectionController`: the "add a project by link" lifecycle
    (validate link → connecting → connected | error), with the connector injected so it is unit-tested
    without a browser. The UI surface subscribes to it.
- **Allowed deps:** `contracts` (the shared broker + signaling + pairing-URI protocol), browser APIs. Never
  `server`, `pi`, or any server-only package.
- **Forbidden:** value-importing `pi` or `server`; a WebRTC/crypto library (use the platform).

The UI entry is `panels/ConnectByLinkDialog.tsx` (reached from the `AddProjectMenu` "Open a project by link"
item): it drives the controller and, on connect, calls `mountRemoteSession` so the remote host's projects and
sessions render in the normal UI via the shared channel→store wiring.

## Not yet here

- `/files` and `/blob` byte URLs over the data channel (markdown images, diff blobs) — `RemoteTransport.httpBase`
  returns empty until that tunnel lands.
- A deployed relay (+coturn) and the real cross-device run: end-to-end pairing is verifiable only with a
  deployed relay, a host, and a second device — not in this repo's test environment.
