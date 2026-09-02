---
id: submodule-server-log
type: submodule-design
status: active
title: log — leveled diagnostics to stderr + rotated support files
parent: module-server
depends-on: [submodule-server-persistence]
tags: [v1, public-surface-checked]
---

## Responsibility

The host's diagnostic record: every module logs through `logger(scope)` instead of `console.*`.
Operators see readable stderr, while the same application records land as structured JSONL under
`<dataDir>/logs/` so users can send them to ThinkRail for agent-led reproduction and investigation.
Only calls through this module's explicit logger reach durable files; arbitrary pi / extension
`console.*` arguments remain terminal-only because they can contain prompts, tool data, or credentials.

## Destinations & rotation

- Pino owns record serialization. Each JSONL line is an independent schema-versioned record with an ISO
  timestamp, numeric + textual severity, scope, message, and a structured error when one was supplied.
  Append-only JSONL is streamable and a truncated final write cannot invalidate earlier records.
- `pino-pretty` renders application logs to stderr only. Durable files stay as Pino's NDJSON rather than
  passing through a human-text formatter.
- `pino-roll` owns the complete file lifecycle: daily plus 10 MB size rotation, generated suffixes, size
  accounting, restart continuation, and cleanup. The base is `thinkrail.jsonl`; generated names follow
  the installed transport's convention. Fourteen rotated files plus the active file are retained, which
  bounds ordinary diagnostic storage near 150 MB. The adapter invokes the pinned transport's own cleanup
  routine once after opening because `pino-roll@4.0.0` otherwise runs it only after an in-process roll;
  this preserves the bound for restart-heavy, low-volume hosts without duplicating its retention
  algorithm. Rotation follows the host's local calendar boundary; record timestamps remain UTC ISO strings.
- The rolling destination writes synchronously so accepted records are not stranded in a worker queue.
  `crash.log` remains a separate synchronous plain-text fatal report owned by `host/crashLog.ts` and is
  outside pino-roll's filename set.

## Levels & initialization

- `debug | info | warn | error`; default threshold **info**. The threshold gates stderr and file alike.
  Resolution: explicit `initLogging({ level })` (the CLI's `--verbose` → debug) >
  `THINKRAIL_LOG_LEVEL` (this module is that variable's single reader; an invalid value warns without
  echoing the environment value and falls back to info) > info.
- Before `initLogging`, `logger(...)` calls echo to stderr only and write no file, so unit tests and
  library embedders never grow support files implicitly.
- `initLogging` asynchronously opens pino-roll and is awaited first by `host`'s `bootHost` (never by
  `createServer`; process-level logging belongs to the process owner). Repeated calls re-resolve the
  level and concurrent calls await the same one-time opener. Direct in-process streams deliberately avoid `pino.transport()` worker threads and their
  extra-file binary-bundling contract.

## Console boundary

`console.debug/log/info/warn/error` are never patched or copied into durable files. Pi, extensions, and
third-party packages may put sensitive project data in arbitrary console arguments; no structured
redactor can make their free text safe. Host diagnostics that belong in support files must instead pass
through a reviewed `logger(scope)` call with an intentionally bounded message.

## Failure & privacy boundary

- Logging must never take the host down. Initialization and log calls degrade to direct stderr on failure;
  every destination error channel is consumed without routing back through the logger.
- Support files never intentionally contain credentials, authorization headers, cookies, environment
  values, prompt/message contents, file contents, tool arguments/results, or WS/protocol payloads. Known
  structured secret fields are removed with Pino redaction as defense in depth; call sites must still
  follow the closed-diagnostics rule because secrets embedded in free-text messages cannot be redacted
  structurally. Durable messages may interpolate only closed method names, counts, generated ids, and
  equivalent bounded metadata — never raw error text or request-derived paths. A callsite that explicitly
  approves a structured error gets only type/message/stack, never arbitrary enumerable fields.

## Boundary

- **Owns:** the process-level Pino adapter, level/env resolution, scoped façade, JSONL schema and privacy
  policy, pino-roll configuration and startup cleanup invocation, pretty stderr, and the shared
  `describeError` used by the independent crash report.
- **Public surface (barrel):** `logger`, `Logger`, `LogLevel`, `initLogging`, `InitLoggingOptions`,
  `setLogLevel`, `logsDir`, `describeError`.
- **Allowed deps:** `persistence` (`dataDir`); `pino`, `pino-pretty`, `pino-roll`; Node path/streams.
- **Forbidden:** importing any other sibling module or `host`; being imported by `persistence` (the one
  module below it — a `persistence → log` edge would be a cycle).
