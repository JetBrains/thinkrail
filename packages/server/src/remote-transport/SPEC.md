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
by QR" mode: the signaling message protocol, the host-side authorization handshake carried over signaling
*before* any media negotiation, and the transport-agnostic channel interface the existing wire protocol runs
over. The sibling [[submodule-server-remote]] owns *who may connect* (identity, pairing tokens, device
registry); this module owns *how the connection is brokered and secured in transit*.

Transport decision (fixed): **WebRTC DataChannels + self-hosted coturn**. The channel is E2E (DTLS) and NAT
traversal is ICE/STUN with coturn as the ciphertext-only relay fallback, so the crypto for the data path is
the protocol's, not hand-rolled. Host-side WebRTC is expected to use a **pure-TS** implementation
(`werift`) to stay Bun- and compiled-binary-safe; native bindings would need binary-seam handling.

See the home-directory plan `thinkrail-remote-project-qr-spec.md` for rationale and roadmap.

## Boundary

- **Owns:**
  - `signalingProtocol.ts` — the `DeviceMessage` / `HostMessage` frames and `parseDeviceMessage` (device
    input is untrusted: every frame is shape-, type- and bound-checked; the label is trimmed and capped).
  - `signalingSession.ts` — `createHostHandshake`, the pure host-side authorization state machine
    (`hello` → `challenge` → `proof` → `accepted`/`rejected`), dependency-injected over the `remote`
    module's token consume / proof verify / device registry, so an unauthorized peer never reaches
    SDP/ICE exchange. A **`resume`** frame re-authorizes an already-paired device by its registered key
    (`findDevice`) with no token — the path a reconnect takes, since the QR token is one-time.
  - `channel.ts` — `RemoteChannel`, the byte-channel interface the wire protocol runs over.
  - `weriftRemoteChannel.ts` — `toRemoteChannel`, adapting a werift `RTCDataChannel` to `RemoteChannel`;
    every send and receive goes through contracts' channel framing, so a large result is chunked.
    werift (pure TS) is **validated under Bun** (offer/answer, ICE, DataChannel, byte transfer via a
    loopback test), so the host needs no native WebRTC binding.
  - `localRelay.ts` — `startLocalRelay`, the signaling relay run **inside the host** when no external relay
    is configured: `@thinkrail/relay`'s broker on all interfaces at port 24243 (fixed, so a phone's saved
    addresses survive a restart; a free port when it is taken), the host connecting over loopback. Its
    `addresses` (`relayAddresses`) are this machine's private-LAN IPv4 addresses, then its Tailscale ones
    (100.64.0.0/10) — what a phone on the same Wi‑Fi or the same tailnet can reach, with no server deployed.
    Exposing the broker on the LAN is safe by the relay's zero-knowledge design: it sees routing only, and
    pairing stays a host-verified one-time token plus device key.
  - `hostPeer.ts` — `createWeriftHostPeer`, the host as WebRTC **offerer** (creates the DataChannel + offer,
    emits local SDP/ICE, consumes the device's answer/candidates, surfaces a `RemoteChannel`), behind a
    `HostPeer` interface so the orchestrator is testable with a fake. It gathers through contracts'
    `PUBLIC_STUN_URLS` (tests pass none), so a phone off the host's network can still connect peer-to-peer;
    there is no TURN until one is deployed.
  - `hostSession.ts` — `createHostSession`, one device session's orchestration: runs the handshake, and only
    after `accepted` starts the peer and relays the device's answer/candidates into it, handing out the open
    `RemoteChannel` with its `PairedDevice`. An end-to-end in-process test drives a real werift device
    through the handshake + WebRTC to a byte-moving channel.
  - `hostBrokerClient.ts` — `createHostBrokerClient` (and the `connectHostBroker` WebSocket wrapper): the
    host's outbound broker client. It registers by public key, maps each brokered session to a
    `HostSession`, and relays signaling payloads in and out, speaking the shared broker protocol from
    `contracts` rather than importing the relay service.
  - `remoteAccess.ts` — `startRemoteAccess`, the composition root: loads identity, connects to the broker,
    runs each device's handshake + WebRTC, and mints one-time pairing links (`issueLink`) carrying every
    `advertised` relay address (default: the connect URL) and the computer's name. The host's `remote`
    option starts the local relay when it names no `relayUrl`. On the server
    public surface for the CLI.
  - `remoteWireBridge.ts` — `bridgeRemoteWire`, which runs the host wire protocol over a `RemoteChannel`:
    it decodes request frames, dispatches them through the host's `handleRequest` (injected), replies with
    the WS's `{ id, ok, result | error }` framing, and `push`es `{ channel, data }` events. Replay/ack is
    omitted (the DataChannel has no mid-stream reconnect to replay).
- **Public surface:** the `index.ts` barrel.
- **Allowed deps:** `remote` (types + the injected pairing primitives), `contracts` (the shared broker-frame
  protocol), `@thinkrail/relay` (only `startBroker`, for the local relay), `werift` (host-side WebRTC),
  `node:crypto`, `node:os`; later the `host` wire protocol behind
  `RemoteChannel`. Never the browser.
- **Forbidden:** importing `host` today, browser bundling, hand-rolled transport crypto.

## Invariants

- **Authorize before negotiate:** the handshake must reach `accepted` before any `offer`/`answer`/`candidate`
  is relayed; a rejected or out-of-order handshake is terminal.
- Device frames are always validated by `parseDeviceMessage`; the host never trusts raw signaling input.
- The pure core (protocol + handshake) carries no network or WebRTC dependency and is unit-tested in full;
  the WebRTC adapter and the signaling server are separate, later slices.

## Not yet here (next slices)

- **Host integration in `createServer`:** move `startRemoteAccess` into the host composition so each paired
  channel is bridged with the real `handleRequest`, and mirror every `server.publish` fan-out to the set of
  live `RemoteWireBridge`s (today pushes reach only Bun sockets). `bridgeRemoteWire` is the adapter for this;
  the wiring is invasive (one wrapper over ~20 publish sites) and only verifiable with the full stack.
- The web "add project by link" flow (device side: native WebRTC + the wire client over the channel).
- coturn deployment/config and the second channel tunnelling `/files` and `/blob`.
