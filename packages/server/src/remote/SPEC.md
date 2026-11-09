---
id: submodule-server-remote
type: submodule-design
status: active
parent: module-server
depends-on: []
title: remote — identity, pairing, device registry
---

## Responsibility

The transport-agnostic core of remote "add project by QR" access: the host's long-term identity, the
one-time pairing tokens a QR carries, the `thinkrail://pair` URI format, verification of a device's
proof-of-key, and the persisted registry of paired devices. It owns *who may connect and how a connection
is authorized*, never *how bytes travel* — the signaling/relay transport (WebRTC + coturn) and its wiring
into the WS surface are a later phase and a separate module.

See the home-directory plan `thinkrail-remote-project-qr-spec.md` for the product rationale and roadmap.

## Boundary

- **Owns:**
  - `identity.ts` — the host's long-term **Ed25519** keypair (`node:crypto`), loaded or created and
    persisted `0600` under the data dir as `remote-identity.json`; exposes the base64url raw public key
    (what the QR carries), a short fingerprint, `sign`, and `verifySignature` / `publicKeyFromRaw` for
    checking a device's key.
  - `pairingToken.ts` — an **in-memory**, single-use, short-TTL store of pending QR pairings
    (`createPairingTokens`), keyed by `pairingTokenId` (base64url SHA-256 of the token), because the relay
    carries `hello` and must never see the token itself. A leaked QR cannot be replayed and nothing survives a
    restart.
  - `pairingUri.ts` — build/parse the `thinkrail://pair?v=1&s=…&t=…&k=…&p=…[&n=…]` URI: one `s` per relay
    address the host is reachable at (Wi‑Fi/LAN, Tailscale — the device races them), the one-time token, host
    public key, project ref, and optionally the computer's name. A link with a single `s` stays valid.
  - `pairing.ts` — `newChallenge()`, `verifyPairingProof()` (a device signs the host challenge to prove it
    holds its key), `pairingTokenId()`, and `pairingMac` / `verifyPairingMac` — the HMAC-SHA256 under the QR
    token over `pairingMacInput(devicePublicKey, challenge)` that proves a first-pairing device read the QR
    and binds that to its own key, so a relay that saw the `hello` cannot pair a key of its own.
  - `accessSetting.ts` — whether the user left phone access on (`remote-access.json`, `0600`); off when
    never set or unreadable.
  - `deviceRegistry.ts` — the persisted list of paired devices (`remote-devices.json`, `0600`): add
    (re-pairing a key replaces its entry), revoke, look up by key, `updateDevice` (rename, access). Each device
    has an `access` (`accessOf`: absent on one paired before access modes, which keeps `write`).
  - `deviceAccess.ts` — `deviceMayRequest(access, method)`: a `write` device may make any request, a `read` one
    only those in `READ_ONLY_METHODS` (project / workspace / session lists, a chat's transcript, stats,
    commands and resources, a worktree's skills, the model catalog, branches). It is an allow-list, so a method added later is a write until it
    is listed here.
- **Public surface:** the `index.ts` barrel.
- **Allowed deps:** `persistence` (`dataDir`), `contracts` (the pairing URI and `pairingAuth` transcripts),
  `node:crypto`, `node:fs`, `node:path`; never `host` or any other sibling feature.
- **Forbidden:** importing a transport/relay/WebRTC concern, `host`, or browser code; being bundled into
  the browser.

## Invariants

- Crypto is **`node:crypto` only** (Ed25519) — no hand-rolled crypto, no third-party remote-control
  project reused; libraries, if any, stay primitives.
- Identity and device files are written `0600`; a corrupt identity file is regenerated rather than fatal.
- Pairing tokens are one-time and expire; `consume` removes the token whether or not it was still valid.
- The module is **transport-agnostic** and side-effect-light: persistence takes an explicit dir (default
  `dataDir()`) so it is unit-tested against a temp dir.
