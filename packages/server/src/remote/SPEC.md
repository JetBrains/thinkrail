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
    (`createPairingTokens`). A leaked QR cannot be replayed and nothing survives a restart.
  - `pairingUri.ts` — build/parse the `thinkrail://pair?v=1&s=…&t=…&k=…&p=…` URI (signaling URL,
    one-time token, host public key, project ref).
  - `pairing.ts` — `newChallenge()` and `verifyPairingProof()` (a device signs the host challenge to prove
    it holds its key); the challenge/signature travel over the transport the later phase provides.
  - `deviceRegistry.ts` — the persisted list of paired devices (`remote-devices.json`, `0600`): add
    (re-pairing a key replaces its entry), revoke, look up by key.
- **Public surface:** the `index.ts` barrel.
- **Allowed deps:** `persistence` (`dataDir`), `node:crypto`, `node:fs`, `node:path`. No `contracts` yet
  (no wire types until the transport phase), never `host` or any other sibling feature.
- **Forbidden:** importing a transport/relay/WebRTC concern, `host`, or browser code; being bundled into
  the browser.

## Invariants

- Crypto is **`node:crypto` only** (Ed25519) — no hand-rolled crypto, no third-party remote-control
  project reused; libraries, if any, stay primitives.
- Identity and device files are written `0600`; a corrupt identity file is regenerated rather than fatal.
- Pairing tokens are one-time and expire; `consume` removes the token whether or not it was still valid.
- The module is **transport-agnostic** and side-effect-light: persistence takes an explicit dir (default
  `dataDir()`) so it is unit-tested against a temp dir.
