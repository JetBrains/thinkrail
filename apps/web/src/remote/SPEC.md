---
id: submodule-web-remote
type: submodule-design
status: active
title: remote — "open a project by link" lifecycle
parent: module-web
depends-on: [module-contracts, module-remote-client, module-locales]
---

## Responsibility

The web app's side of the remote "open a project by link" flow. The device-side engine — the WebRTC data
path, the wire client over it, pairing/reconnect, the paired-host registry and the multi-host session
aggregator — lives in [[module-remote-client]]; this sub-module only drives it for the full UI.

## Boundary

- **Owns:** `remoteConnection.ts` — `createRemoteConnectionController`: the "add a project by link" lifecycle
  (validate link → connecting → connected | error), with the connector injected so it is unit-tested
  without a browser. A newer `connect` or `reset` supersedes one in flight: its late connection is closed and
  its late failure dropped; a failure is kept as its `HostFailure` (code), never as raw text. The UI surface
  subscribes to it. `mountRemoteHost` mounts a connected connection with the transport owning it (closed
  when the app moves to another host), and `reportRemoteHostLost` — the controller's default `onLost` — turns
  a mounted host lost for good into `disconnected` plus an error toast whose action returns to this
  computer's own host (`initTransport`); a host already left is ignored.
  `connectFailure.ts` — `failureOf` (an error → `network` / a `RemoteConnectError` code / unexpected) and
  `failureKey` over a shell's `FailureTexts`, shared with the phone shell's `hostStatus.ts`;
  `connectFailureText` is the IDE's wording, which never shows the raw detail (English, and it names addresses).
- **Allowed deps:** `contracts`, `remote-client`, `locales`, `store` (status, toasts, the mounted host key),
  `transport` (`mountRemoteSession`, `initTransport`). Imported by `panels/ConnectByLinkDialog.tsx` and
  `phone/hostStatus.ts`. Never `server`, `pi`, or any server-only package.
- **Forbidden:** reimplementing any part of the remote protocol (it lives in `remote-client`).

The UI entry is `panels/ConnectByLinkDialog.tsx` (reached from the `AddProjectMenu` "Open a project by link"
item): it drives the controller and, on connect, calls `mountRemoteHost` so the remote host's projects and
sessions render in the normal UI via the shared channel→store wiring.

## Not yet here

- `/files` and `/blob` byte URLs over the data channel (markdown images, diff blobs) — `RemoteTransport.httpBase`
  returns empty until that tunnel lands.
