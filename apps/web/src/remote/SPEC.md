---
id: submodule-web-remote
type: submodule-design
status: active
title: remote — "open a project by link" lifecycle
parent: module-web
depends-on: [module-contracts, module-remote-client]
---

## Responsibility

The web app's side of the remote "open a project by link" flow. The device-side engine — the WebRTC data
path, the wire client over it, pairing/reconnect, the paired-host registry and the multi-host session
aggregator — lives in [[module-remote-client]]; this sub-module only drives it for the full UI.

## Boundary

- **Owns:** `remoteConnection.ts` — `createRemoteConnectionController`: the "add a project by link" lifecycle
  (validate link → connecting → connected | error), with the connector injected so it is unit-tested
  without a browser. A newer `connect` or `reset` supersedes one in flight: its late connection is closed and
  its late failure dropped. The UI surface subscribes to it.
- **Allowed deps:** `contracts`, `remote-client`. Never `server`, `pi`, or any server-only package.
- **Forbidden:** reimplementing any part of the remote protocol (it lives in `remote-client`).

The UI entry is `panels/ConnectByLinkDialog.tsx` (reached from the `AddProjectMenu` "Open a project by link"
item): it drives the controller and, on connect, calls `mountRemoteSession` so the remote host's projects and
sessions render in the normal UI via the shared channel→store wiring.

## Not yet here

- `/files` and `/blob` byte URLs over the data channel (markdown images, diff blobs) — `RemoteTransport.httpBase`
  returns empty until that tunnel lands.
