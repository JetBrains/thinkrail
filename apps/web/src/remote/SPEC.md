---
id: submodule-web-remote
type: submodule-design
status: active
title: remote — the IDE's saved servers
parent: module-web
depends-on: [module-contracts, module-remote-client, module-locales]
---

## Responsibility

The IDE's servers: other ThinkRail hosts (a VPS, a home server, another laptop) this computer paired with by
their `thinkrail://pair` link, listed in the project tree under the local projects. The device-side engine —
the WebRTC data path, pairing/reconnect, the paired-host registry and the multi-host controller — lives in
[[module-remote-client]]; this sub-module keeps the IDE's list of servers on top of it.

## Boundary

- **Owns:**
  - `servers.ts` — `createServers`: the saved servers (`HostRegistry`), one connection each through
    `remoteSessions` (which retries on its own), and each server's open projects (`ServerProjects`: loading,
    ready, failed). Projects are read with `project.list` when a server's channel opens and again after every
    reconnect, and follow its `project.updated` pushes; a re-read that fails keeps the list already shown, an
    answer from a client the server no longer uses is dropped. `add` pairs and saves, `reconnect` asks again
    (also a server refused for good), `forget` closes and drops it. Dependencies are injected, so it is
    unit-tested without a browser. `openProjects` / `withProject` are the list rules (no Chats container, no
    closed project, highest rank first).
  - `appServers.ts` — the app's one instance (`appServers`, created and connected the first time anything asks,
    retried when the network comes back), `useServers` for renderers, `serversSupported` (WebRTC and Ed25519
    signing; a webview without them offers no servers) and `computerLabel` (what this computer calls itself to
    a server: its platform). Saved servers and the device key live in the desktop's stable preference store
    when there is one (`clientPreferences`): the desktop webview's origin, and so its `localStorage`, changes
    between launches, and a new device key would make every server forget this computer.
  - `serverText.ts` — the words for a server's status and failures (`serverStatusText`, `serverFailureText`);
    the classification (`hostStatusOf`, `failureOf`, `recoveryOf`) is `remote-client`'s, shared with the phone.
- **Allowed deps:** `contracts`, `remote-client`, `locales`, `clientPreferences`, React. Never `server`, `pi`,
  the store or the transport.
- **Forbidden:** reimplementing any part of the remote protocol (it lives in `remote-client`).

The UI is `panels/ServerList.tsx` (below the local projects in `ProjectTree`: a row per server with its
status mark, a menu with Reconnect and Forget, the failure with the one action that fixes it, its projects)
and `panels/AddServerDialog.tsx` (the `AddProjectMenu` "Add server…" item, in the tree and on the Welcome
screen, only where `serversSupported`).

## Not yet here

- Opening a server's project: its chats, files and terminals as tabs next to the local ones. This needs a
  transport per host and a store that holds several hosts at once (today `mountRemoteSession` replaces the
  whole window's host, which only the phone uses).
- `/files`, `/blob` and `/images/` byte URLs over the data channel (`RemoteTransport.httpBase` is empty).
