---
id: submodule-server-persistence
type: submodule-design
status: active
title: persistence — JSON app state
parent: module-server
depends-on: [module-contracts]
---

## Responsibility

Durable host state—projects, workspaces, cross-frontend app config, terminal catalogs, session completion receipts, installation identity, and server-only acquisition state—as JSON under the data dir. Current workbench frame and workspace placement are frontend-local and have no host persistence.

## Boundary

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`, always resolved to an absolute path — a relative override would otherwise land managed worktrees in two places: `mkdirSync` resolves it against the host's cwd, `git -C <project>` against the project); project/workspace/config load-save operations and fieldwise validation over `DEFAULT_CONFIG` while preserving unknown top-level extension fields; versioned atomic `session-lifecycle.json` (latest observed settled completion + explicit-cancel run id), `session-receipts.json` (first-install baseline complete + session→handled completion id) and `turns.json` (per-workspace agent-run change sets, owned by `turns`); server-only `installation.json` (`{ id, appInstalled?: true }`) and campaign-only `attribution.json`; the structural load/save of `environment.json` (`loadHostEnvironment` / `saveHostEnvironment`, atomic, mode `0600`, semantics owned by [[submodule-server-environment]]). The non-rotating install UUID never crosses the wire.
- **Chats store:** the Chats container (`Project.kind: "chats"`) and chat workspaces (`Workspace.kind: "chat"`)
  live in a separate **`chats.json`** (`PersistedChats` v1, written atomically). `loadProjects` /
  `loadWorkspaces` merge it in; `saveProjects` / `saveWorkspaces` **partition on save by kind** for both
  legacy files, so every writer that rewrites `projects.json` / `workspaces.json` wholesale (activity
  stamps, slug backfill, review stamps…) keeps a chat or container record out of them — an older host
  (the CLI is the supported rollback artifact) never sees a chat and its reclaim path can never `rm -rf`
  a chat folder. A corrupt `chats.json` is set aside as `.corrupt-<epoch>`, loads as empty, and chat
  writes are refused until restart (`chatsStoreWritable()`); the legacy files keep saving. `chatsRoot()`
  (`<dataDir>/chats`) names the reserved folder: `isUnderChatsRoot()` is the lexical test for spellings
  ThinkRail stored or pi recorded, `landsInChatsRoot()` the door policy for a path someone typed or picked
  (lexical, or canonical through the nearest existing ancestors — [[submodule-server-projects]]).
- **Public surface (barrel):** `dataDir`, `chatsRoot`, `isUnderChatsRoot`, `landsInChatsRoot`, `loadChats`, `chatsStoreWritable`,
  `isChatsContainer`, `isChatWorkspace`, `PersistedChats`, `CHATS_FILE_VERSION`, project/workspace/config and terminal-catalog load-save operations, session receipt load-save operations, `ensureInstallation()` returning only `{ id }`, narrow install/browser claim operations, and strict acquisition read/save. Initial ID creation publishes a complete sibling temp via atomic no-overwrite hard link and rereads a concurrent winner; malformed existing records are preserved. An exclusive install-claim marker elects one packaged host across processes. The complete installation JSON is atomically replaced; caught replacement failures remove the marker and temp for retry, while a crash after claiming may consume the event without emission. Legacy installed records remain claimed.
- **Browser attempt:** `attribution.json` exclusively creates its first `{ browserClaimAttempted: true }` marker with `wx`. Redeem atomically replaces it with strict first/last touch fields (bounded UTM values, referrer class, timestamp, and policy version); failed network or replacement work leaves the attempt terminal. Retention is 30 days after `last_touch`: expired or invalid records become terminal. The persisted schema rejects claim/verifier/challenge/URL, journey/bridge IDs, IP, and user agent. Other state has no cross-process lock.
- **Allowed deps:** `contracts` (`Project`, `Workspace`, `AppConfig`, `HostEnvironment`, `LayoutPreset`, `DEFAULT_CONFIG`,
  `isTerminalWindowsShell`); Node `fs`/`os`/`path`.
- **Forbidden:** importing feature siblings or `host`; deriving session state; storing transcript content, cached running/input state, or local activation; combining lifecycle metadata with read receipts; persisting a current frame/view, selection/focus, or frontend-surface identity; reading alternate config keys or old schemas; or reading, rewriting, or deleting old host layout snapshots.

Project and workspace loads return `Project.path` / `Workspace.worktreePath` in the host's resolved spelling
(architecture Decision 22). A record stored in another spelling — git's `C:/…`, an unresolved segment, a
file an older host wrote — heals on read and is persisted by the next save of that file; loads never write,
and a value that is not absolute on this host stays as stored. Saves do not normalize: the producers resolve
at their own doors, so an object a create call returns never differs from what it stored.

Session metadata writes are complete-copy temp-file replacements. Lifecycle persists only facts a transcript
cannot prove—`agent_settled` outcome and explicit Stop—keyed to the active run/completion ids; stale records
never apply to a newer turn. Loads report each file as loaded, missing, or set aside. Unless both files
load, the owner runs one pre-serving baseline of existing completion ids so history does not light up;
unresolved input is never baselined. An unreadable file (I/O, parse, or schema failure) never blocks host
startup: it is renamed to `<file>.corrupt-<epoch-ms>` for diagnosis (best effort) and treated as missing, so
the re-baseline marks existing completions read. Trading possibly-unseen attention for a bootable host is
deliberate: a v0.2.0-nightly.16 host refused to start on a bad `session-receipts.json` until the user deleted
it. Write failures stay conservative: they may resurface or retain attention but never record unseen work as
read.

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
