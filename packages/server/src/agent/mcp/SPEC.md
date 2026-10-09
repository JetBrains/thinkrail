---
id: submodule-server-agent-mcp
type: submodule-design
status: active
title: "agent/mcp — host-owned MCP layer: pi-parity config loader, fingerprints, per-session host extension"
parent: submodule-server-agent
depends-on: [module-contracts]
tags: [mcp, pi]
---

## Responsibility

What ThinkRail owns around pi's built-in MCP: at the configuration layer, reading the two `mcp.json`
files exactly as pi does, and the two host-only derivations — the exposure normalization that stands in
for codemode, and the per-entry fingerprint behind repo-server approvals; at the session layer, the
per-session host extension that guards calls. The engine (connections, OAuth, tools) stays pi's; this
module never opens a connection.

## pi facts (`@earendil-works/pi-coding-agent`, the catalog-pinned version)

pi does not export `loadMcpConfig` / `validateMcpServerConfig`, and a host-supplied
`loadConfig` replaces pi's loader wholesale — so `config.ts` is a **port** of `dist/core/mcp-servers.js`
and `dist/extensions/mcp/config.js` (MIT). The rules that matter for safety are the same by
construction and pinned by `config.test.ts`, which runs the same fixtures through pi's installed loader
(reached by its dist path, since the package `exports` map hides it) and ours: server-name charset,
exposure values and the `codemode-deferred` alias, `toolExposure` shape, `type: "sse"` rejection,
URL/`headers`/`args`/`env`/`cwd` typing, OAuth (`callbackUrl` loopback-only, `callbackPort`
consistency, CIMD constraints, `authServerMetadataUrl`), `auth.provider` only with https or loopback and
**never in the project file**, project override entries (`enabled` / `exposure` / `toolExposure` only, on
an existing global server, reported merged with `scope: "global"` and an `override` path), and the
`-`/`_` namespace clash. Re-verify on every pi bump; a parity failure is a port bug, never a reason to
relax a rule.

## What's here

- `results.ts` — `summarizeMcpResult()`: the `McpResultSummary` the session host's `tool_result` handler
  writes into `details.thinkrail` for `mcp__*` and the three resource tools, built from pi's
  machine-readable result (`structuredContent` = the server's raw `CallToolResult`, or the resource
  payload): block kinds, URIs, MIME types and sizes — never image/audio/blob data — plus the server's own
  `structuredContent` up to 64 KiB (else `structuredContentTruncated`); a resource read keeps only its
  contents' URIs and types. pi drops `structuredContent` from finalized messages, so this is what lets a
  result be rendered the same live, after reload and on another client.
- `config.ts` — the port plus the host additions: `loadHostMcpConfig()` is what a session hands pi —
  project-file entries (servers and override-only entries alike) are admitted only when the project
  record's `mcpApprovals[name]` equals their current fingerprint (an unapproved override leaves the global
  server as configured), the record's `mcpOverrides` set `enabled` / `exposure` of user-level servers, and
  exposure is normalized; `loadMcpConfigFiles()`
  (with the optional `admitProjectEntry` predicate it is built on) returns pi's `LoadedMcpConfig`
  **and** `entries` (every named `mcpServers` value as written — objects and invalid values alike — with
  file, scope and whether it is an override) because pi's merged result loses project provenance, **and**
  `fileErrors` (the file-level subset of `errors`, split into path and message);
  `fingerprintMcpEntry(name, raw)` = SHA-256 over the name and the canonical JSON of the whole raw entry (keys sorted recursively except
  `toolExposure`, whose order is semantic) — never over resolved values; `normalizeExposureForHost()` maps
  unset and `codemode` exposures (server and per-tool) to `deferred` in memory while codemode is not
  shipped. `mcpPolicyOf(project)` reads that policy off a project record (absent fields read as empty).
- `sessionHost.ts` — `createMcpSessionHost()`, one per parent session (the manager keeps it on its entry;
  child sessions get none): a `tool_call` handler that asks before any `mcp__*` call whose tool does not
  declare `readOnlyHint: true` — options **Deny · Allow once · Allow in this chat**, in that order so the
  chat-wide grant never sits next to Deny on a stacked mobile layout — and blocks with a reason on
  everything but the two affirmative answers (Deny, dismissal, abort, no UI). Each pending dialog owns an
  `AbortController` combined with the run's `ctx.signal`; `cancelPendingConfirmations()` is what the
  manager calls when a steer is accepted, because pi's steering only queues the message. "Allow in this
  chat" lives in the host object, so it survives resource reloads and dies with the session; nothing is
  persisted. Its `extensions` also carry the engine (`engine.ts`) with the session's `loadConfig`
  (`loadHostMcpConfig` over `getAgentDir()`, the session `cwd`, `ctx.isProjectTrusted()` and the injected
  project policy). `shutdownEngine(event, ctx)` runs the engine's captured shutdown.
- `engine.ts` — `createMcpEngine({ loadConfig })` → `{ extensions, shutdown }`: pi's two
  built-in descriptors (`mcp` = `createMcpExtension({ loadConfig, openUrl: no-op })`, `tool-search`), both
  `replaceable: true, builtin: true` exactly like pi's CLI. The `mcp` factory first registers its own
  `session_start` / `mcp_servers_change` handlers that activate `tool_search` whenever
  `pi.getMcpServers()` is non-empty, so they run before pi's reachability check: extension-registered
  servers bypass the loader's normalization (pi defaults them to codemode, which is not shipped) and
  `tool_search` reaches them. Living inside the replaceable built-in, the activation disappears with it when
  another extension owns MCP, and handling `mcp_servers_change` there does not distort pi's "nobody
  connects registered servers" report. The `mcp` factory hands pi a `Proxy` of the `ExtensionAPI`; every
  member but `on` is forwarded with `Reflect.get` (pi's API object is never spread, so nothing is read
  eagerly). `on` records the `session_shutdown` handlers pi's factory registers — a fresh list per load —
  and forwards them unchanged, so `shutdown(event, ctx)` can run the latest load's directly, in order, the
  way pi's runner would; pi's handler (1.1.0: abort the session signal, close the current connections,
  clear the list, await tracked work) is idempotent, so pi's own later call through the regular emission
  closes nothing twice — re-check on every pi bump.

## Boundary

- **Public surface (barrel):** `loadMcpConfigFiles`, `validateMcpServerConfig`, `getMcpToolExposure`,
  `mcpNamespace`, `isOverrideEntry`, `fingerprintMcpEntry`, `normalizeExposureForHost`,
  `globalMcpConfigPath`, `projectMcpConfigPath`, `createMcpSessionHost` + `McpSessionHost` and the option
  labels `MCP_CONFIRM_DENY` / `MCP_CONFIRM_ONCE` / `MCP_CONFIRM_CHAT`, `createMcpEngine` (`{ loadConfig }`),
  `loadHostMcpConfig` + `McpProjectPolicy` + `mcpPolicyOf`, `summarizeMcpResult` / `isMcpResultTool` /
  `MCP_STRUCTURED_SUMMARY_BYTES`, and the types `LoadedMcpFiles`, `McpConfigFileEntry`, `McpConfigScope`.
- **Allowed deps:** `@earendil-works/pi-coding-agent` (types, `CONFIG_DIR_NAME`, `getAgentDir`, and the
  engine factories `createMcpExtension` / `createToolSearchExtension`); `@thinkrail/contracts` (types);
  Node `fs`/`path`/`crypto`.
- **Forbidden:** `host`, `projects`, the web; no connection, OAuth or transport code — those stay in pi.
