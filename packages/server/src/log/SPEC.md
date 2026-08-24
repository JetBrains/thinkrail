---
id: submodule-server-log
type: submodule-design
status: active
title: log — leveled diagnostics to stderr + rotated daily files
parent: module-server
depends-on: [submodule-server-persistence]
tags: [v1]
---

## Responsibility

The host's diagnostic record: every module logs through `logger(scope)` instead of `console.*`, and
each line lands on stderr **and** in a rotated log file under `<dataDir>/logs/` — so a bug report has
a trace even when the terminal is gone (GUI launch, closed window). A console tee additionally mirrors
`console.*` output from pi / third-party code into the file, since pi runs in-process and prints its
own warnings.

## File layout & rotation (user-confirmed 2026-01-28)

- **Daily files with a 10 MB hard cap per file:** `thinkrail-YYYY-MM-DD.log`; when a file would exceed
  10 MB the writer moves to `thinkrail-YYYY-MM-DD_1.log`, `_2`, … — append-only, no renames, the
  newest file has the highest suffix. A single line larger than the cap still lands (in a file of its
  own) rather than rotating forever.
- **The day is the UTC day of the line timestamps** (`toISOString()`), so a file's name always matches
  the stamps inside it — deliberately not the local calendar day, which would disagree with the lines.
- **Retention: files whose day is older than 14 days are deleted** at open/day-switch (the boundary
  day is kept). Only `thinkrail-*.log` names are swept — `crash.log` (owned by `host/crashLog.ts`)
  is never touched.
- Line format is human-readable text, chosen over JSONL (this log is read by humans in an editor or
  `tail -f`, not shipped to a pipeline): `<ISO ts> LEVEL [scope] message`, with an error's rendering
  appended as 2-space-indented lines.

## Levels & the debug switch

- `debug | info | warn | error`; default threshold **info**. The threshold gates stderr and file
  alike. Resolution: explicit `initLogging({ level })` (the CLI's `--verbose` → debug) >
  `THINKRAIL_LOG_LEVEL` (this module is that variable's single reader; an invalid value warns and
  falls back to info) > info.
- Before `initLogging`, `logger(...)` calls echo to stderr only (level-gated at the default) and
  write no file — so unit tests and library embedders never grow log files or a patched console.
  `initLogging` is called once by `host`'s `bootHost` (never by `createServer` — file logging and the
  console patch are process-level choices that belong to the process owner); repeated calls only
  re-resolve the level.

## Console tee

`initLogging` patches `console.debug/log/info/warn/error` to call through to the original **and**
mirror the formatted args into the file under the `[console]` scope (`log`→info, others 1:1),
level-gated like everything else. Terminal-only output is unchanged. Because the tee installs only at
`bootHost`, the CLI's user-facing output for `--help`/`update`/`uninstall` never lands in a log file.
The logger's own stderr echo uses `process.stderr.write`, never `console`, so the tee cannot recurse.

## Never throw, never leak

- **Logging must never take the host down:** every file write is try/caught and degrades to
  stderr-only, silently. The writer tracks bytes itself (one `stat` per file open, not per line).
- **Privacy rule:** no credential values, no prompt/message contents, no WS payloads — debug traces
  log command *types* only (a payload can carry an API key, e.g. `provider.loginReply`). The same
  closed-diagnostics discipline as `submodule-server-analytics`.

## Boundary

- **Owns:** `logging.ts` — `logger(scope)` → `{ debug, info, warn, error }` (each
  `(message, error?)`), `initLogging({ level?, appVersion? })` (level resolve + writer + console tee +
  retention sweep + one boot line naming the logs dir/version/pid/level), `setLogLevel`, `logsDir()`
  (`<dataDir>/logs`), `describeError` (the shared error renderer — `host/crashLog.ts` uses it too, so
  crash reports and log lines render a throw identically), and the pure rotation parts
  (`logFileName`/`parseLogFileName`/`latestLogSequence`/`selectRetentionVictims`/`formatLogLine`/
  `shouldLog`/`resolveLogLevel` + `LogFileWriter`), pinned by `logging.test.ts`.
- **Public surface (barrel):** `logger`, `Logger`, `LogLevel`, `initLogging`, `InitLoggingOptions`,
  `setLogLevel`, `logsDir`, `describeError`.
- **Allowed deps:** `persistence` (`dataDir`); Node `fs`/`path`/`util`.
- **Forbidden:** importing any other sibling module or `host`; being imported by `persistence` (the
  one module below it — a `persistence → log` edge would be a cycle).
