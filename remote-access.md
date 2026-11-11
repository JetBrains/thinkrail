---
id: remote-access
type: architecture-design
status: active
title: Remote access — how a phone reaches a ThinkRail host
parent: architecture
references: [module-relay, module-nostr-signaling, module-remote-client, submodule-server-remote, submodule-server-remote-transport, submodule-web-phone, submodule-web-remote, app-mobile, module-contracts]
tags: [architecture, remote]
---

## Goal

A phone (or another computer) drives a ThinkRail host from any network with no ThinkRail account and no
server to deploy. The data path is end-to-end encrypted peer-to-peer; everything in between only routes
ciphertext and can refuse service but never read, impersonate or pair. This spec is the end-to-end story;
each step's mechanics and invariants live in the module spec it links.

## Pieces

```
 phone (apps/mobile → apps/web/src/phone)            host (packages/server)
 ┌──────────────────────────────┐                     ┌──────────────────────────────────┐
 │ remote-client                │  signaling frames   │ remote-transport                 │
 │  hostRegistry  (saved hosts) │◀── relay broker ───▶│  localRelay (built-in broker)    │
 │  remoteSessions (per host)   │◀── Nostr relays ───▶│  nostrHostSignaling              │
 │  deviceConnector (attempts)  │                     │  hostSession + handshake         │
 │  deviceWireClient            │══ WebRTC DTLS ═════▶│  hostPeer (werift) + NAT-PMP     │
 └──────────────────────────────┘   DataChannel       │  remoteWireBridge → handleRequest│
                                                       │ remote: identity, tokens, devices│
                                                       └──────────────────────────────────┘
```

- **Identity** ([[submodule-server-remote]]): the host has one Ed25519 key in `~/.thinkrail`; its Nostr key is
  derived from it, so one QR names both. Each phone has its own Ed25519 key, generated on first use.
- **Signaling** carries only the handshake and SDP/ICE, over either of two carriers with identical frames
  ([[submodule-server-remote-transport]]): the host's **built-in relay** (port 24243 on every interface,
  reachable on the same Wi‑Fi or tailnet; [[module-relay]] can also be hosted) and **public Nostr relays**
  (NIP-44 encrypted ephemeral events, [[module-nostr-signaling]]) for every other network.
- **Data** is the unchanged host wire protocol over a WebRTC DataChannel, framed and chunked by
  [[module-contracts]], dispatched by the host into the same `handleRequest` the browser uses.

## Pairing (once per phone)

1. The user turns Phone access on (Settings, the top-bar panel, or `thinkrail --remote`). The host starts its
   relay and Nostr listener and mints a **one-time token** (2 minutes).
2. The QR is a `thinkrail://pair?…` link: every reachable relay address (LAN, then Tailscale, then a public
   one only if a self-probe proves it reachable), the Nostr route (host Nostr key + relays), the host public
   key, the token and the computer's name.
3. The phone sends `hello` with the token **id** (never the token), its public key and a nonce. The host
   answers a `challenge`; the phone returns a `proof` — its signature over the challenge plus an HMAC of the
   token. Only then is the device registered, with an access level (`write` or `read`).

## Connecting (every time)

1. **Route race.** The phone opens every relay address and the Nostr route at once. A relay that answers
   within 1.5 s wins (it is the host on a shared network); otherwise the first live Nostr route does.
2. **Handshake.** `resume` (device key + nonce) → `challenge` → `proof` → `accepted`. No SDP is exchanged
   before `accepted`; an unknown key gets `rejected unknown_device`.
3. **Signed SDP.** The host offers, signing the offer over the phone's nonce and the challenge; the phone
   checks it against the host key it paired with and answers, signing over the challenge. A relay that
   splices either side breaks a signature and the attempt ends `identity_mismatch`.
4. **ICE.** Both sides gather through public STUN. The host also asks its router for a **NAT-PMP** mapping of
   each private UDP port and signals the public address as an extra candidate. This is what connects a phone
   behind carrier CGNAT (symmetric NAT) to a home router that filters by port; plain STUN cannot.
5. **Open.** The DataChannel opens, the wire client attaches, queued requests flush. A Nostr signaling route
   is closed then; a relay route stays open, because the host ties the peer to its broker session.

One attempt is bounded at **20 s** from its start, signaling included, and ends with a named reason:
unreachable (no route got ready — `RelayUnreachableError`), `host_silent` (the host never answered), `no_direct_route`
(signaling worked, ICE did not), or the host's rejection.

## Staying connected

- **Reconnect loop** ([[module-remote-client]]): a dropped channel or failed attempt retries with doubling
  backoff; only `unknown_device`, `identity_mismatch` and `app_outdated` stop it. The app shows Connecting
  while retrying and the last failure's reason once a retry failed.
- **Resume and network change:** the app coming to the foreground or the network returning calls
  `reconnectNow`: a connection that only looks open (peer not `connected` or channel not `open`, as after iOS
  suspended the app) is dropped and redialled at once.
- **Late frames are ignored.** Once the channel is open only the peer or the channel can end the connection;
  host signaling frames, a lost signaling route or a replayed `challenge` cannot.
- **No request runs twice.** Requests still waiting are re-sent on the new channel, and the host answers a
  repeated id from its first run (the same replay cache the browser's WS uses), so a prompt or a worktree
  whose reply was lost is not run again.
- **Routes follow the host.** On every connect the host pushes its current routes (`remote.hostRoutes`), and
  the phone updates the saved host, so a new Wi‑Fi address or relay list needs no new QR.
- **Host restarts.** The host ignores Nostr frames created before it started, so a relay replaying the last
  minute cannot open a stale handshake against a phone's live attempt.

## Security model

- The relay and Nostr relays see routing metadata only; every secret is either never sent (the token) or
  bound to a fresh challenge. A compromised relay can deny service, nothing else.
- Each Nostr attempt uses a fresh phone key, so relays cannot link one phone's attempts.
- The host re-reads a device's access on every request; revoking closes its live channels at once.
- Phone access is **off by default**; nothing listens until the user turns it on.

## Known gaps

- **No TURN yet.** A pair where neither STUN nor NAT-PMP works (office or hotel NAT, a router without
  NAT-PMP) cannot connect off-LAN. Planned: TURN credentials from a hosted relay.
- **No PCP / UPnP IGD**, only NAT-PMP.
- **iOS keeps nothing alive in the background**; the connection is re-made on resume.

## Diagnosing a phone that will not connect

- The phone's banner names the failure code above; `host_silent` means signaling never reached the host,
  `no_direct_route` means it did and ICE failed.
- Holding the host identity, the Nostr signaling can be decrypted to see exactly which step a phone reached
  and which candidates each side offered (look for the host's `srflx` candidate from NAT-PMP).
