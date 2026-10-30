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
- **Public surface:** the `index.ts` barrel.
- **Allowed deps:** `remote` (types + the injected pairing primitives), `node:crypto`; later the WebRTC
  library + the `host` wire protocol behind `RemoteChannel`. Never the browser.
- **Forbidden:** importing `host` today, browser bundling, hand-rolled transport crypto.

## Invariants

- **Authorize before negotiate:** the handshake must reach `accepted` before any `offer`/`answer`/`candidate`
  is relayed; a rejected or out-of-order handshake is terminal.
- Device frames are always validated by `parseDeviceMessage`; the host never trusts raw signaling input.
- The pure core (protocol + handshake) carries no network or WebRTC dependency and is unit-tested in full;
  the WebRTC adapter and the signaling server are separate, later slices.

## Not yet here (next slices)

- The WebRTC adapter implementing `RemoteChannel` over an `RTCPeerConnection` DataChannel.
- The signaling WS server brokering frames between host and device, and the host's outbound connection to it.
- coturn deployment/config and the second channel tunnelling `/files` and `/blob`.
