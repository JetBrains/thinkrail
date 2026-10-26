---
id: submodule-server-environment
type: submodule-design
status: active
title: environment — stored host environment (pi config folder + variables)
parent: module-server
depends-on: [module-contracts, module-shared]
---

## Responsibility

The user's stored host environment: an optional pi config folder (`PI_CODING_AGENT_DIR`) and an ordered
list of `NAME=value` variables, edited in Settings → Environment and applied to `process.env` once per
host process at boot. It exists because a Dock/Finder launch has no way to pass `PI_*` (the login-shell
import never imports them) and a shell alias is never exported. Everything in-process — pi, extensions,
the bash tool, terminals, stdio MCP servers — then sees one consistent environment, so a `pi` run in a
ThinkRail terminal uses the same config folder.

## Boundary

- **Owns:** structural parse + semantic validation of the record, `applyHostEnvironment()` (called only
  by `host`'s `bootHost`), the applied snapshot and launch-key snapshot, and the status the Settings
  section reads.
- **Public surface (barrel):** `applyHostEnvironment`, `hostEnvironmentStatus`, `updateHostEnvironment`.
- **Allowed deps:** `persistence` (`loadHostEnvironment` / `saveHostEnvironment`), `log`, `contracts`
  (types), `@thinkrail/shared/shellEnv` (`launchEnvKeys`), `@earendil-works/pi-coding-agent`
  (`getAgentDir`, for the folder in use).
- **Forbidden:** `settings` / `AppConfig` (values may be secrets and `AppConfig` is broadcast to every
  frontend and seeded in `server.welcome`); publishing on any channel; logging or reporting variable
  names or values.

## Get right

- **Apply point.** `bootHost` calls `applyHostEnvironment()` after `await resolveShellEnv()` and before
  `initializeJbcentralRuntime()` / `createServer()` — before the first `getAgentDir()` reader. Applying
  later would split the process: the model runtime, MCP user-config watcher, history root and Central
  hold the agent dir they first saw.
- **Precedence: launch env > stored record > login-shell import / locale repair.** Names present before
  the shell repair (`launchEnvKeys()`) are never overwritten, so `FOO=1 thinkrail` and the e2e/smoke
  isolation through `PI_CODING_AGENT_DIR` keep working; the status lists those names as
  `launchOverridden`. The key set is copied at apply time, so a fallback snapshot (no shell repair ran)
  never includes the record's own writes.
- **Change = restart.** `environment.update` only persists; `restartRequired` is "stored ≠ applied".
  Live re-apply was rejected for the split-process reason above. A "Restart now" action is deferred: no
  generic host restart exists.
- **Validation** (all-or-nothing on update, issue per field/row): agent dir must be absolute after `~`
  expansion and an existing directory; names match `[A-Za-z_][A-Za-z0-9_]*`, no duplicates; reserved
  (case-insensitive) are `PATH` (shellEnv owns it), `HOME` / `USERPROFILE` (Bun caches `homedir()`),
  `PI_CODING_AGENT_DIR` (its own field) and `THINKRAIL_*` (data dir, port and host are read before or
  outside the record). Blank rows are dropped; a structurally malformed record is a thrown request error.
- **Boot tolerates drift.** An entry that is invalid on disk (a deleted folder, a hand-edited reserved
  name) is skipped with a `log.warn` naming only field and code; the rest applies. A skipped agent dir
  falls back to pi's default, which the status' `effectiveAgentDir` makes visible.
- **Storage:** `<dataDir>/environment.json`, atomically replaced with mode `0600`; fetched only by
  `environment.get`, never broadcast.
- **Consequence the user accepted:** pi keeps transcripts under `<agentDir>/sessions`, so switching the
  folder hides chats made under another one until switched back, as in pi's CLI.
