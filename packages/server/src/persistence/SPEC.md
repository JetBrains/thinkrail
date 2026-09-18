---
id: submodule-server-persistence
type: submodule-design
status: active
title: persistence — JSON app state
parent: module-server
depends-on: [module-contracts]
---

## Responsibility

Durable host state—projects, workspaces, cross-frontend app config, terminal catalogs, session completion receipts/purpose metadata, installation identity, and server-only acquisition state—as JSON under the data dir. Current workbench frame and workspace placement are frontend-local and have no host persistence.

## Boundary

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`); project/workspace/config load-save operations and fieldwise validation over `DEFAULT_CONFIG` while preserving unknown top-level extension fields; versioned atomic `session-receipts.json` (first-install baseline complete + session→handled completion id); separate `session-purpose.json` (internal-session ids and explicit-cancel run ids—non-derivable lifecycle metadata, never read receipts); server-only `installation.json` (`{ id, appInstalled?: true }`) and campaign-only `attribution.json`. The non-rotating install UUID never crosses the wire.
- **Public surface (barrel):** `dataDir`, project/workspace/config and terminal-catalog load-save operations, session receipt/purpose load-save operations, `ensureInstallation()` returning only `{ id }`, narrow install/browser claim operations, and strict acquisition read/save. Initial ID creation publishes a complete sibling temp via atomic no-overwrite hard link and rereads a concurrent winner; malformed existing records are preserved. An exclusive install-claim marker elects one packaged host across processes. The complete installation JSON is atomically replaced; caught replacement failures remove the marker and temp for retry, while a crash after claiming may consume the event without emission. Legacy installed records remain claimed.
- **Browser attempt:** `attribution.json` exclusively creates its first `{ browserClaimAttempted: true }` marker with `wx`. Redeem atomically replaces it with strict first/last touch fields (bounded UTM values, referrer class, timestamp, and policy version); failed network or replacement work leaves the attempt terminal. Retention is 30 days after `last_touch`: expired or invalid records become terminal. The persisted schema rejects claim/verifier/challenge/URL, journey/bridge IDs, IP, and user agent. Other state has no cross-process lock.
- **Allowed deps:** `contracts` (`Project`, `Workspace`, `AppConfig`, `LayoutPreset`, `DEFAULT_CONFIG`,
  `isTerminalWindowsShell`); Node `fs`/`os`/`path`.
- **Forbidden:** importing feature siblings or `host`; deriving session state; storing transcript content, cached running/input/completion state, or local activation; combining purpose/cancellation metadata with read receipts; persisting a current frame/view, selection/focus, or frontend-surface identity; reading alternate config keys or old schemas; or reading, rewriting, or deleting old host layout snapshots.

Session metadata writes are complete-copy temp-file replacements. A missing receipt file receives one
pre-serving baseline of existing completion ids so history does not light up; unresolved input is never
baselined. Corruption/failure is conservative: it may resurface or retain completion attention but never
silently records unseen work as read. Purpose metadata is written before an internal session can publish.

Analytics config preserves a saved boolean preference and a valid `analyticsConsentConfirmed` boolean
independently; absent/malformed values default false. A preference-only write never implies completion.
Settings owns initial preference priming and preference-plus-confirmation writes.

Config validation normalizes the closed theme mode plus complete opaque system pair, the closed
composer-growth preference, the closed Windows terminal-shell preference (invalid/absent →
`DEFAULT_CONFIG.terminalWindowsShell`), chat/file line widths plus their pane-bound switches, and the
JetBrains quota boolean + whole `1–3600` second cadence over their defaults; it accepts only the current bounded
`customLayoutPresets` catalog as synchronized layout data. Current/default preset ids, group limits, and
chat message order are not config fields; retired config shapes are stripped rather than upgraded or
preserved as extensions. Historical `layouts/` files remain untouched and inert.
