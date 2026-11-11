---
id: submodule-server-remote-transport
type: submodule-design
status: active
parent: module-server
depends-on: []
title: remote-transport — signaling + WebRTC channel
---

## Responsibility

How a remote device reaches a host over an **end-to-end encrypted WebRTC** DataChannel for the "add project
by QR" mode: the host-side authorization handshake carried over signaling
*before* any media negotiation, and the transport-agnostic channel interface the existing wire protocol runs
over. The signaling frames (`DeviceMessage` / `HostMessage`, `parseDeviceMessage`) are `contracts`'. The sibling [[submodule-server-remote]] owns *who may connect* (identity, pairing tokens, device
registry); this module owns *how the connection is brokered and secured in transit*.

Transport decision (fixed): **WebRTC DataChannels + self-hosted coturn**. The channel is E2E (DTLS) and NAT
traversal is ICE/STUN with coturn as the ciphertext-only relay fallback, so the crypto for the data path is
the protocol's, not hand-rolled. Signaling has two interchangeable carriers for the same frames: a relay
broker (the host's own for Wi‑Fi/Tailscale, or a hosted one) and public Nostr relays
([[module-nostr-signaling]]) for a phone on any other network with no ThinkRail server. Host-side WebRTC is expected to use a **pure-TS** implementation
(`werift`) to stay Bun- and compiled-binary-safe; native bindings would need binary-seam handling.

## Boundary

- **Owns:**
  - `signalingSession.ts` — `createHostHandshake`, the pure host-side authorization state machine
    (`hello` → `challenge` → `proof` → `accepted`/`rejected`), dependency-injected over the `remote`
    module's token consume / proof + MAC verify / device registry, so an unauthorized peer never reaches
    SDP/ICE exchange. `hello` names the QR token by its id and a first pairing's `proof` must carry the
    token HMAC. A **`resume`** frame re-authorizes an already-paired device by its registered key
    (`findDevice`) with no token — the path a reconnect takes, since the QR token is one-time. Both carry
    the device's fresh `nonce`; an accepted step returns it with the challenge.
  - `channel.ts` — `RemoteChannel`, the byte-channel interface the wire protocol runs over.
  - `weriftRemoteChannel.ts` — `toRemoteChannel`, adapting a werift `RTCDataChannel` to `RemoteChannel`;
    every send and receive goes through contracts' channel framing, so a large result is chunked.
    werift (pure TS) is **validated under Bun** (offer/answer, ICE, DataChannel, byte transfer via a
    loopback test), so the host needs no native WebRTC binding.
  - `localRelay.ts` — `startLocalRelay`, the signaling relay run **inside the host** when no external relay
    is configured: `@thinkrail/relay`'s broker on all interfaces at port 24243 (fixed, so a phone's saved
    addresses survive a restart; a free port when it is taken), the host connecting over loopback. Its
    `addresses` (`relayAddresses`) are this machine's private-LAN IPv4 addresses, then its Tailscale ones
    (100.64.0.0/10), then any public one on an interface — what a phone on the same Wi‑Fi, the same tailnet, or
    the internet (a VPS) can reach, with no server deployed. Addresses are read **live** from the interfaces,
    so Tailscale starting later or a Wi‑Fi change lands in the next link; each change of that set re-runs the
    public check (`publicCheck`: `interface` for a public IP on this machine, else `publicAddress.ts`'s
    `reachable` / `closed` / `offline`), and only a `reachable` one is advertised. `ready` settles once the
    current check has, so `--remote`'s first QR carries what it finds.
    Exposing the broker on the LAN is safe by the relay's zero-knowledge design: it sees routing only, and
    pairing stays a host-verified one-time token plus device key.
  - `publicAddress.ts` — `discoverPublicAddress`, the public side of a host behind 1:1 NAT (a cloud VM
    whose interface holds only a private IP): the STUN server-reflexive address from a werift gather, kept
    only when the relay's `/health` answers there. That self-probe is what tells a VPS from a home router,
    which does not forward the port, so a laptop never advertises its router's address.
  - `werift.ts` — the one door to werift. Its certificate code (`@peculiar/x509` → `tsyringe`) throws at import
    unless `reflect-metadata` ran first; `reflectMetadata.ts` loads that CommonJS polyfill with `require`, because
    the compiled binary hoists ES module bodies above CommonJS ones and an `import` there would run too late (the
    binary died at startup). Nothing else imports `werift` directly.
  - `hostPeer.ts` — `createWeriftHostPeer`, the host as WebRTC **offerer** (creates the DataChannel + offer,
    emits local SDP/ICE, consumes the device's answer/candidates, surfaces a `RemoteChannel`) over the public
    STUN servers only, behind a `HostPeer` interface so the orchestrator is testable with a fake. werift
    gathers every candidate before it emits the offer, so an unreachable TURN would stall it; TURN is the
    device's (see [[module-relay]]). It gathers through contracts'
    `PUBLIC_STUN_URLS` (tests pass none), so a phone off the host's network can still connect peer-to-peer;
    there is no TURN until one is deployed.
    Given a `PortMapper`, each private-IPv4 UDP host candidate's port is mapped on the router and its public
    address signalled as one more `srflx` candidate; the leases are released when the peer closes or fails.
    STUN alone fails when the phone sits behind a carrier's symmetric NAT (CGNAT) and the home router filters
    by port: the phone's checks arrive from a port the host never wrote to. A mapped port takes them from
    anyone, so that pair connects with no relay (observed: an Odido phone against a home router).
  - `natPmp.ts` — `createNatPmpMapper`, NAT-PMP (RFC 6886) against the OS default gateway (`defaultGateway`:
    macOS `route`, Linux `/proc/net/route`, Windows `route print`): the router's public address, then a UDP
    mapping asked for 10 minutes and renewed at half the granted lifetime while held, deleted on `release`.
    A router that does not answer is skipped for a minute, so a network without NAT-PMP (office, hotel,
    UPnP-only) costs one ~750 ms wait per minute; such a pair still needs TURN. `startRemoteAccess` shares one
    mapper across its sessions (`portMapper: null` turns it off).
  - `hostSession.ts` — `createHostSession`, one device session's orchestration: runs the handshake, and only
    after `accepted` starts the peer. It signs the offer with the host identity key over
    `offerTranscript(nonce, challenge, sdp)` and accepts only an answer the paired device key signed over
    `answerTranscript(challenge, sdp)` — a spliced answer rejects and closes the session — then hands out the
    open `RemoteChannel` with its `PairedDevice`. An end-to-end in-process test drives a real werift device
    through the handshake + signed SDPs + WebRTC to a byte-moving channel.
  - `hostBrokerClient.ts` — `createHostBrokerClient` (and the `connectHostBroker` WebSocket wrapper): the
    host's outbound broker client. It registers by public key and answers the relay's challenge with a
    signature, maps each brokered session to a `HostSession`, and relays
    signaling payloads in and out, speaking the shared broker protocol from `contracts` rather than importing
    the relay service. `connectHostBroker` reconnects with capped exponential backoff and re-registers when
    the relay restarts or the network drops; a dropped connection closes the sessions it brokered (their
    devices re-dial). A test runs it against a real relay over loopback.
  - `nostrHostSignaling.ts` — `connectNostrHost`, the host on its Nostr key (the identity's `nostrSecret`)
    across the given relays, and `createNostrHostRouter`, its pure core: with no broker to open sessions, a
    device's per-attempt Nostr key names its `HostSession` (fed the same parsed frames, the unparseable ones
    to `receiveUnreadable`). Each session is dropped after a 60s signaling window — closed if its channel never
    opened (`HostSession.opened`), only forgotten if it did — and bounded: 32 live sessions (an unknown sender
    past it is ignored and times out) and 64 frames each (past it the sender stays blocked until its window
    ends). Frames created before this run started (less 2s of clock skew) are ignored: a relay replaying the
    last minute to a restarted host would otherwise open a fresh handshake for a phone's live attempt and
    answer it a second `challenge` and a `rejected`.
  - `remoteAccess.ts` — `startRemoteAccess`, the composition root: loads identity, connects to the broker
    and, given `nostrRelays`, to Nostr, both feeding one session factory; runs each device's handshake +
    WebRTC, and mints one-time pairing links (`issueLink`) carrying every `advertised` relay address
    (default: the connect URL), the Nostr route (key + relays) and the computer's name, with their expiry.
    `nostr` reports the route and how many of its relays are live; `routes()` is the same route set the
    link carries, read now.
  - `remoteAccessControl.ts` — `createRemoteAccessControl`, the runtime switch the host owns: `setEnabled`
    starts the relay (the host's own via `startLocalRelay` unless a `relayUrl` is configured) plus
    `startRemoteAccess` with the Nostr route on (`DEFAULT_NOSTR_RELAYS` unless `nostrRelays` is given; `[]`
    turns it off), and stopping tears both down, which closes every live device channel; the choice
    persists through the `remote` module's setting (`restore` brings it back at startup) unless the caller
    passes `persist: false` for a one-run `--remote`. `issueLink` refuses while off; `routes()` is null while off. It owns the live device
    channels, so `state()` marks each paired device `connected` and `revokeDevice` drops the registry entry and
    closes that device's open channels itself; `renameDevice` / `setDeviceAccess` update the registry, the
    latter telling the host (`onAccessChanged`) so the device's live channels hear their new access;
    `mayRequest(deviceId, method)` re-reads the registry on every call — `allowed`, `readOnly` or `revoked` —
    so a change on the computer applies to the next request without reconnecting; `state().relay` reports the built-in relay's port and public
    check, or the configured URL, for Settings' network check. `onPaired` hands the host the device with its
    resolved access. `onStatus` hears the whole `state()` whenever it changes, coalesced over 100 ms and
    deduplicated against the last one heard: switch, restore, revoke, rename, access change and a device
    channel opening or closing announce themselves; the relay's addresses and public check and the Nostr
    live count are read rather than announced, so while on the control also samples every 2 s (and once when
    the relay's check settles) and speaks only on a difference. The host publishes it on
    `remote.statusChanged` to its own sockets only — never through the device bridges. Access is **off by
    default** — nothing listens for a phone until Settings or `--remote` turns it on.
  - `remoteWireBridge.ts` — `bridgeRemoteWire`, which runs the host wire protocol over a `RemoteChannel`:
    it decodes request frames, dispatches them through the host's `handleRequest` (injected), replies with
    the WS's `{ id, ok, result | error }` framing, and `push`es `{ channel, data }` events (`pushFramed` sends
    a host broadcast's JSON as is, with no re-parse). Given `replay` (the host binds the same
    `RequestReplayCache` the WS uses, under `remote:<deviceId>`), a device that sent `resume` has every request
    run through it, so a request re-sent after a reconnect answers from its first run; `ack` drops a read
    response and `resume` keeps only the ids still awaited. An app too old to send `resume` is served without
    it, so its unacknowledged responses never fill the cache. Failures go to `onError` (Error Tracking), and
    the device's client state is reaped like a closed WS once its last channel closes.
- **Public surface:** the `index.ts` barrel — `createRemoteAccessControl` (+ `RemoteAccessControl`,
  `RemoteAccessState`) and `bridgeRemoteWire` (+ `RemoteWireBridge`), the only names `host` consumes.
- **Allowed deps:** `remote` (types + the injected pairing primitives), `contracts` (the shared broker and signaling
  frames and public STUN servers), `@thinkrail/relay` (only `startBroker`, for the local relay),
  `@thinkrail/nostr-signaling` (the Nostr carrier and its default relays), `werift` (host-side WebRTC),
  `node:crypto`, `node:os`; later the `host` wire protocol behind
  `RemoteChannel`. Never the browser.
- **Forbidden:** importing `host` today, browser bundling, hand-rolled transport crypto.

## Invariants

- **Authorize before negotiate:** the handshake must reach `accepted` before any `offer`/`answer`/`candidate`
  is relayed; a rejected or out-of-order handshake is terminal.
- **Never leave a device waiting:** every refusal is a `rejected` frame with a `RejectCode` (`invalid_code`,
  `unknown_device`, `denied`), and a device frame that does not parse — an app older than the host — is
  answered `outdated_app` and ends the session instead of being dropped silently.
- **A closed wire ends the peer:** the host peer closes its WebRTC connection once its data channel closes
  (Revoke closes a device's channels), so the device sees the connection end and its `resume` is refused.
- **The relay is untrusted:** nothing it carries is a bearer secret (token id + HMAC, never the token), and
  both SDPs are signed, so a malicious or compromised relay cannot pair its own key, impersonate the host,
  or sit in the middle of the DTLS channel. It can only refuse service.
- Device frames are always validated by `parseDeviceMessage`; the host never trusts raw signaling input.
- The pure core (protocol + handshake) carries no network or WebRTC dependency and is unit-tested in full;
  the WebRTC adapter and the signaling server are separate, later slices.

## Not yet here (next slices)

- The second channel tunnelling `/files` and `/blob`. (coturn credentials and the deploy recipe live in
  [[module-relay]].)
