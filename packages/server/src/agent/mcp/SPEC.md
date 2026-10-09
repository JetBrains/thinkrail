---
id: submodule-server-agent-mcp
type: submodule-design
status: active
title: "agent/mcp — host-owned MCP layer: pi-parity config loader, writers, fingerprints, per-session host extension"
parent: submodule-server-agent
depends-on: [module-contracts]
tags: [mcp, pi]
---

## Responsibility

What ThinkRail owns around pi's built-in MCP: at the configuration layer, reading the two `mcp.json`
files exactly as pi does, editing them safely from a long-lived multi-client process, and the two
host-only derivations — the exposure normalization that stands in for codemode, and the per-entry
fingerprint behind repo-server approvals; at the session layer, the per-session host extension that
guards calls and the per-server lock that keeps two sign-ins for one server from running at once; and
reading one server's lines from pi's shared MCP log. The engine (connections, OAuth, tools) stays pi's;
this module never opens a connection.

## pi facts (`@earendil-works/pi-coding-agent`, the catalog-pinned version)

pi does not export `loadMcpConfig` / `validateMcpServerConfig` / its writers, and a host-supplied
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

- `summaries.ts` — `summarizeMcpServers()`: one `McpServerSummary` per entry as written (an override-only
  project entry folds into its user-level server as that server's `approval`; an entry that is not an object
  keeps its row with pi's `must be an object` error), with scope, defining file,
  transport, masked endpoint (`maskMcpEndpoint`), configured vs effective exposure and enablement (record
  overrides and admitted repo overrides applied), OAuth applicability, replacement of a user-level server,
  approval state (`approved` / `pending` / `changed` against the current fingerprint) and pi-equivalent
  config errors (through `redactMcpText`). `summarizeMcpConfigErrors()` is the file-level rest (unparsable
  JSON, `mcpServers` not an object, a mistyped `autoEnableCodemode`) as `{ source, message }`, masked, for
  `McpListResult.configErrors`: for the first two pi's loader lists none of that file's servers, so without
  it `mcp.list` would read "no servers".
- `redact.ts` — the host's one credential mask for text that leaves it. pi redacts nothing in its status
  texts: a connection error, an HTTP error-body snippet and a stdio server's stderr tail (up to 2 000
  chars) arrive verbatim. `redactMcpText` masks, deterministically and idempotently, URL user info and
  credential-named query values (`maskUrl`; any other URL is returned exactly as written), `Bearer` /
  `Basic` credentials (any case), credential-named `key=value` pairs and quoted `"key": value` pairs, the
  known token prefixes (`gh[pousr]_`, `github_pat_`, `sk-`, `xox[abprs]-`, `glpat-`, `AKIA`), and runs of
  32+ characters that are hex, or mixed-case with digits in the base64url alphabet — `/` and `.` end a
  run, so paths, URLs and package names survive (a standard-base64 secret split by `/` into short parts is
  the accepted miss). It is applied where pi's text becomes a host DTO: both status parsers (every
  `detail` and parsed config error), `summarizeMcpServers` (`configError`), `summarizeMcpConfigErrors`,
  `readMcpServerLog` and the sign-in probe's error frames. `maskMcpEndpoint` is the command-line form: the URL, or the command
  with the value after a credential-named flag or assignment, URL-shaped arguments (user info, credential-named query values),
  header arguments (any value after `-H` / `--header`, a credential-named `Name: value` anywhere) and
  token-prefixed arguments masked; `${VAR}` references stay, and arguments with spaces, quotes or nothing in
  them are JSON-quoted so the line is unambiguous (a client shows it as what runs).
- `status.ts` — parsers for pi's two status texts (`formatStatus` lines `name: state[, N tools] (exposure)`
  with indented errors, and the startup attention notice) and `deriveMcpServerStatuses()`; the formats are
  pinned by fixtures and re-checked on every pi bump; parsed details are redacted before anything else
  sees them.
- `log.ts` — `readMcpServerLog(name)` → `McpServerLog`: pi appends every `notifications/message` a
  server sends to one `mcp.log` in the agent dir (rotated to `mcp.log.1` past 5 MiB), one entry per
  message as `<ISO time> [<server>] <level>[ <logger>:] <text>` with continuation lines indented four
  spaces (`formatMcpLogMessage`, so a server cannot forge another's head). `mcpServerLogLines` keeps the
  entries whose head names the server plus their continuations — never a substring match — and the
  latest 200 lines; both files are read (the last 8 MiB each, a missing one is empty) and the result goes
  through `redactMcpText`. The format is pinned by a test against pi's own formatter; re-check it on every
  pi bump.
- `results.ts` — `summarizeMcpResult()`: the `McpResultSummary` the session host's `tool_result` handler
  writes into `details.thinkrail` for `mcp__*` and the three resource tools, built from pi's
  machine-readable result (`structuredContent` = the server's raw `CallToolResult`, or the resource
  payload): block kinds, URIs, MIME types and sizes — never image/audio/blob data — plus the server's own
  `structuredContent`. One byte budget (`MCP_SUMMARY_BYTES`, 64 KiB) bounds the whole summary: blocks are
  kept in order until it is spent (`omittedBlocks` counts the rest, since a server may return thousands of
  resource links with long URIs), and `structuredContent` is kept only if it fits what remains (else
  `structuredContentTruncated`); a resource read keeps only its contents' URIs and types. pi drops `structuredContent` from finalized messages, so this is what lets a
  result be rendered the same live, after reload and on another client.
- `management.ts` — the config mutations the host composes: `writeMcpServerEntry` (pi validation plus the
  project `auth` ban, add vs update, project containment; returns a project entry's fingerprint),
  `removeMcpServerEntry`, `projectMcpEntryFingerprint`, `shareMcpOverrideWithRepo` (writes pi's override
  entry from the record; refuses when the project file defines that server itself or holds an override not
  approved at its current fingerprint, so a share never merges into unreviewed repository content).
- `config.ts` — the port plus the host additions: `loadHostMcpConfig()` is what a session hands pi —
  project-file entries (servers and override-only entries alike) are admitted only when the project
  record's `mcpApprovals[name]` equals their current fingerprint (an unapproved override leaves the global
  server as configured), the record's `mcpOverrides` set `enabled` / `exposure` of user-level servers, an
  optional chat-local disabled set wins over both, and exposure is normalized; `loadMcpConfigFiles()`
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
  project policy). The host extension is an always-loaded inline factory, so its factory starts every load:
  it clears `loaded()` (each server's effective config as pi received it, set again only when the built-in
  starts — a load where another extension owns `/mcp`, or `-builtin:mcp`, leaves it `null`) and keeps that load's `ExtensionAPI` for `registered()` (pi's
  `getMcpServers()`: the servers extensions registered, `[]` once the load is stale). `shutdownEngine(event,
  ctx)` runs the engine's captured shutdown.
- `engine.ts` — `createMcpEngine({ loadConfig, lockSignIns? })` → `{ extensions, shutdown }`: pi's two
  built-in descriptors (`mcp` = `createMcpExtension({ loadConfig, openUrl: no-op })`, `tool-search`), both
  `replaceable: true, builtin: true` exactly like pi's CLI. The `mcp` factory first registers its own
  `session_start` / `mcp_servers_change` handlers that activate `tool_search` whenever
  `pi.getMcpServers()` is non-empty, so they run before pi's reachability check: extension-registered
  servers bypass the loader's normalization (pi defaults them to codemode, which is not shipped) and
  `tool_search` reaches them. Living inside the replaceable built-in, the activation disappears with it when
  another extension owns MCP, and handling `mcp_servers_change` there does not distort pi's "nobody
  connects registered servers" report. The `mcp` factory hands pi a `Proxy` of the `ExtensionAPI`; every
  member but two is forwarded with `Reflect.get` (pi's API object is never spread, so nothing is read
  eagerly). `on` records the `session_shutdown` handlers pi's factory registers — a fresh list per load —
  and forwards them unchanged, so `shutdown(event, ctx)` can run the latest load's directly, in order, the
  way pi's runner would; pi's handler (1.1.0: abort the session signal, close the current connections,
  clear the list, await tracked work) is idempotent, so pi's own later call through the regular emission
  closes nothing twice — re-check on every pi bump. Unless the caller passes `lockSignIns: false` (only the
  host's sign-in probe, which holds the lock itself), `registerCommand` wraps `/mcp`'s handler: `login <name>` /
  `logout <name>`, parsed the way pi parses them, take `acquireMcpSignInLock(name, "chat")` for the
  command's duration and release it in `finally`; while another holder has it the command posts "A sign-in
  for "<name>" is already running in Settings." (or "in a chat") as a warning and never reaches pi. Status,
  `reconnect`, a bare `login` / `logout` and malformed arguments pass straight through.
- `signInLock.ts` — `acquireMcpSignInLock(serverName, holder)`: the process-wide lock, keyed by server
  name, that the host's sign-in probes (`"settings"`) and chats (`"chat"`) share (why and who holds it:
  [[submodule-server-agent]] › MCP servers). It returns `{ release }` (frees only its own hold, so a late
  or repeated call is harmless) or `{ heldBy }`, which callers turn into their refusal.
- `writers.ts` — `add` / `update` / `remove` with pi's editing semantics (unknown keys and indentation
  kept; a global server's `enabled: true` / `exposure: "codemode"` defaults are removed rather than
  written; an override entry keeps explicit values), replacing the file atomically (temp file + rename)
  with its mode preserved. `assertProjectMcpConfigWritable(worktree, path)` is the containment rule for
  project files: the target stays inside the worktree, an existing `.pi/` is a real directory and an
  existing `mcp.json` a regular file — never a symlink, because pi's reader follows links and a
  read-modify-write would copy a foreign file into the repository (`McpConfigPathUnsafeError`,
  wire code `MCP_PATH_UNSAFE`). Writes are synchronous, so one process never interleaves two edits; the
  atomic rename keeps a concurrent `pi mcp add` from ever reading a torn file (a lost update between two
  processes is accepted). `add` creates a missing file and reports whether it replaced a same-name entry,
  `remove` whether the file defined the server, and `update` with `override` adds a missing override entry.

## Boundary

- **Public surface (barrel):** `loadMcpConfigFiles`, `validateMcpServerConfig`, `getMcpToolExposure`,
  `mcpNamespace`, `isOverrideEntry`, `fingerprintMcpEntry`, `normalizeExposureForHost`,
  `globalMcpConfigPath`, `projectMcpConfigPath`, `addMcpServerConfig`, `updateMcpServerConfig`,
  `removeMcpServerConfig`, `assertProjectMcpConfigWritable`, `McpConfigPathUnsafeError`,
  `createMcpSessionHost` + `McpSessionHost` and the option labels `MCP_CONFIRM_DENY` / `MCP_CONFIRM_ONCE` /
  `MCP_CONFIRM_CHAT`, `createMcpEngine` (`{ loadConfig, lockSignIns? }`), `acquireMcpSignInLock`,
  `loadHostMcpConfig` + `McpProjectPolicy` + `mcpPolicyOf`, `summarizeMcpServers`, `maskMcpEndpoint` /
  `redactMcpText`, `readMcpServerLog`, the `management.ts` mutations (`writeMcpServerEntry`,
  `removeMcpServerEntry`, `projectMcpEntryFingerprint`, `shareMcpOverrideWithRepo`),
  `summarizeMcpConfigErrors`, the status parsers (`parseMcpStatusText`, `parseMcpAttentionNotice`,
  `MCP_ATTENTION_PREFIX`, `deriveMcpServerStatuses`, `ParsedMcpStatus`), `summarizeMcpResult` /
  `isMcpResultTool` / `MCP_SUMMARY_BYTES`, and the types `LoadedMcpFiles`,
  `McpConfigFileEntry`, `McpConfigScope`, `McpServerConfigPatch`.
- **Allowed deps:** `@earendil-works/pi-coding-agent` (types, `CONFIG_DIR_NAME`, `getAgentDir`, and the
  engine factories `createMcpExtension` / `createToolSearchExtension`); `@thinkrail/contracts` (types);
  `@thinkrail/shared/codedError`; Node `fs`/`path`/`crypto`.
- **Forbidden:** `host`, `projects`, the web; no connection, OAuth or transport code — those stay in pi.
