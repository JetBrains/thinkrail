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
    SDP/ICE exchange.
  - `channel.ts` — `RemoteChannel`, the byte-channel interface the wire protocol runs over.
  - `weriftRemoteChannel.ts` — `toRemoteChannel`, adapting a werift `RTCDataChannel` to `RemoteChannel`.
    werift (pure TS) is **validated under Bun** (offer/answer, ICE, DataChannel, byte transfer via a
    loopback test), so the host needs no native WebRTC binding.
- **Public surface:** the `index.ts` barrel.
- **Allowed deps:** `remote` (types + the injected pairing primitives), `werift` (host-side WebRTC),
  `node:crypto`; later the `host` wire protocol behind `RemoteChannel`. Never the browser.
- **Forbidden:** importing `host` today, browser bundling, hand-rolled transport crypto.

## Invariants

- **Authorize before negotiate:** the handshake must reach `accepted` before any `offer`/`answer`/`candidate`
  is relayed; a rejected or out-of-order handshake is terminal.
- Device frames are always validated by `parseDeviceMessage`; the host never trusts raw signaling input.
- The pure core (protocol + handshake) carries no network or WebRTC dependency and is unit-tested in full;
  the WebRTC adapter and the signaling server are separate, later slices.

## Not yet here (next slices)

- Peer negotiation orchestration: driving an `RTCPeerConnection` as offerer, emitting local SDP/ICE to the
  signaling layer and consuming the remote's, resolving a `RemoteChannel` on open. (`toRemoteChannel`, the
  DataChannel→`RemoteChannel` adapter, has landed.)
- The signaling WS server brokering frames between host and device, and the host's outbound connection to it.
- Running the existing `host` wire protocol over a `RemoteChannel`.
- coturn deployment/config and the second channel tunnelling `/files` and `/blob`.
- The CLI command that boots the host for remote access and prints the pairing **link** (the
  `thinkrail://pair` URI as copyable text — no QR needed), and the web "add project by link" flow.
