---
id: pi-compatibility
type: architecture-design
status: draft
title: Pi compatibility — host adaptations and upgrade removal gates
parent: architecture
references: [submodule-server-agent, submodule-server-agent-mcp, submodule-server-extensions-installed, module-artifact-tests, submodule-server-history, submodule-server-templates, module-cli, module-desktop, submodule-web-chat, module-pi-subagents, module-pi-background-commands, module-pi-delegation, module-pi-session-insights]
tags: [pi, compatibility]
---

## Responsibility

The upgrade checklist for host code that compensates for a missing pi API, a pi defect, or a
packaging constraint. Pi remains the engine and state owner. Module specs own detailed rationale;
this index records what an upgrade must re-check and what would let us delete the adaptation.
The installed version comes only from the root dependency catalog, not a second pin in this file.

## Last re-check

Pi 1.6.0 was checked against the installed dist (1.5.2 → 1.6.0, a single release; every private symbol
re-grepped, `agent-session.js`, the extension loader/runner, `package-manager.js`, `resource-loader.js`,
`session-manager.js`, `model-resolver.js`, the MCP extension, pi-mcp, pi-agent-core's `agent-loop.js` and
pi-ai's providers diffed). **No gate is met and no adaptation was added**; one mirror followed pi. Byte-identical
in 1.6.0: `sdk.js`, `settings-defaults.js`, `mcp-servers.js`, `extensions/mcp/config.js`,
`agent-session-services.js`, `skills.js`, `source-info.js`, `utils/paths.js`, compaction, the edit/bash
tools, `tools/path-utils.js` and the package root `index.d.ts` (no new public export). The evidence:

- The Anthropic SSE framing defect is unchanged upstream (`consumeLine` / `iterateSseMessages` untouched;
  #10390 still open): the unpatched 1.6.0 dist fails all three "defects the patch fixes" cases. 1.6.0
  removed one line above them (message threads now default on for any baseUrl on api.anthropic.com, not only
  the `anthropic` provider), so the patch was regenerated from a clean dist with identical `+`/`-` lines.
- `defaultModelPerProvider` moved `openai`, `azure` and `openai-codex` to `gpt-6.2-sol` (`github-copilot`
  stays on `gpt-6.1-sol`); the mirror and its fixtures follow. `restoreModelFromSession` and
  `resolveModelScope` were removed from `model-resolver.js`; the host imported neither.
- `_isActivatedOnRegistration`, the provider-registration queues with `extensionPath`,
  `getAllRegisteredTools`, the `sk-ant-oat` predicate and the interactive warning, `getPackageIdentity`,
  `isOfflineModeEnabled`, `clearExtensionCache`, `getResourcePathKey`, `"pi-virtual"`,
  `getBranchSelection`, `projectContextEntry`, `formatSkillsForPrompt`, `findCutPoint` / `generateSummary`,
  the single-`appendFileSync` session append and the leaf rule are all still private and unchanged in
  shape; the parity fixtures (MCP loader, package identity, restored selection, subagent and insights
  totals, display transcript) pass unchanged. pi-mcp only exports `mcpServerSummary` (the `mcp_servers`
  section's one-liner) in addition.
- `AgentSession.reload()` now emits `session_start` whenever `bindExtensions` ran (`_extensionsBound`), not
  only when a UI context, command actions, shutdown handler or error listener was bound. Chats bind a UI
  context, so nothing changes for them; delegated children bind `{ mode: "print" }` but never call
  `AgentSession.reload()`. `setActiveToolsByName` now drops the restored loadout's pending tools only when it
  deactivates one of *that* loadout (#11996: an extension deactivating its own tool at `session_start` kept
  MCP tools loaded by `tool_search` dropped), which is orthogonal to the registry-tool reconcile below.
  `AgentSession.dispose()` still emits no shutdown. `AgentSessionRuntime.takeUnreportedDiagnostics()` and the
  all-mode "Could not restore model" report are runtime-only; the host does not use `AgentSessionRuntime`
  and still does not surface `modelFallbackMessage`.
- Errors thrown by an extension's `pi.events` handler now reach the runner's `emitError` (the host's
  `onError`) instead of `console.error`. On Esc, every tool call of the batch that had not started gets an
  "Operation aborted" result (#9986), as the host's restart repair already does for dangling calls.
  `PackageManager` gains a `commandOutput: "inherit" | "capture"` option (default `inherit`, unchanged) and
  reports resolve-time installs as progress; the host sets no progress callback.
- The installed-extension entries ([[submodule-server-extensions-installed]]) hold on 1.6.0: the loader only
  gains `reportError` and the `pi.events` error wrapper, so `discoverAndLoadExtensions` still calls the
  uncached `loadExtensions` and `loadExtensionModule` builds the same `moduleCache: false` jiti; no module
  loader or `VIRTUAL_MODULES` is exported, so the shim stays. `DefaultPackageManager`'s `install`,
  `getInstalledPath`, `checkForAvailableUpdates` and `--legacy-peer-deps` are untouched (the new
  `commandOutput` defaults to `inherit`), `DefaultResourceLoader` still copies `extensionFactories` at
  construction, `parseGitUrl` is byte-identical, and `omitReplacedExtensions` (registry tool precedence's
  fourth fact) is unchanged.
- pi-tui's `render()` now returns `readonly string[]` and built-ins return a cached array (#9549); the
  ThinkRail TUI components already build a new array per render, so only two test helpers' types changed.
- pi-ai 1.6.0 discovers four new credential variables (`QWEN_TOKEN_PLAN_{TEAM,TEAM_CN,INDIVIDUAL,INDIVIDUAL_CN}_API_KEY`),
  which the e2e ambient-credential denylist now strips. Retry patterns widen ("Connection closed.", bare
  `ECONNRESET`/`EPIPE`/`ETIMEDOUT` codes, the Codex WebSocket connection limit); OpenAI-compatible providers
  other than OpenAI get system messages with the `system` role; Mistral tools are non-strict unless
  `compat.supportsStrictMode`. The models declaring `allowedFallbackModels` are unchanged.
- The bundled chat catalogue changes from 1,643 to 1,698 provider/model pairs: 103 added (GPT-6.2 Astra and
  Sol on OpenAI, Azure, Codex, Bedrock, Copilot, OpenRouter, Vercel, Radius, Cloudflare and OpenCode; Gemini
  4 Carbon/Hydrogen/Neon; `qwen4-max-preview` and `deepseek-v4.1-flash` on the Qwen Token Plan providers;
  `gpt-6-cyber`) and 48 removed (older NVIDIA, OpenCode GLM/Gemini 3, OpenRouter and Vercel aliases;
  `deepseek-v3.2` / `deepseek-v4-flash` on the Qwen Token Plan Team providers). The default `openai`,
  `azure` and `openai-codex` model is now `gpt-6.2-sol`, at the same price. Release notes must say both and
  advise users to check their default and restored-chat model; unavailable models follow the existing
  selection rules in [[submodule-server-agent]].

## Upgrade contract

Every pi upgrade checks each entry against the **installed package's exports and implementation**,
not only release notes or an upstream issue's status. The upgrade's verification summary names the
adaptations removed, retained with evidence, or changed, and the affected tests run. A new workaround
adds an entry here and rationale in its owning spec; its removal deletes both the workaround and its
entry. A parity failure is evidence of drift, not permission to weaken the test.

A public SDK replacement must preserve session isolation, cancellation, project trust, durable
transcripts, and compiled/desktop behavior before the host implementation is removed. Importing a
private dist path in production is not a replacement; such imports remain confined to parity tests.
The step-by-step upgrade procedure lives in the repo skill
`.agents/skills/upgrading-core-dependencies` (`playbooks/pi.md`); this registry stays the list of what it re-checks.

## MCP adaptations

### Configuration loader and writers

**Owner:** [[submodule-server-agent-mcp]], `agent/mcp/config.ts` and `writers.ts`.
Pi's public `loadConfig` hook replaces its loader wholesale; its loader and writers are not public
exports, and since pi 1.5.1 only the shared *entry* validator is (`@earendil-works/pi-mcp`'s
`validateMcpServerConfig`, which leaves pi's `exposure` / `toolExposure` / `auth` checks private). The
host ports their file semantics to apply project policy and perform safe multi-client writes.
**Removal gate:** a public loader/validator/writer surface preserving entry provenance and allowing
admission before project overrides merge; adopting pi-mcp's partial validator alone would add a direct
dependency for half the rules and is deferred until the loader follows. Verify the port against the
installed `core/mcp-servers` and `extensions/mcp/config`; run `agent/mcp/config.test.ts` and
`host/mcp.test.ts`. The parity fixture lists one entry per validation rule pi has, so a new config
field (pi 1.5 added `oauth.clientRegistration: "auto"`) shows up as a parity failure before it reaches
users. Host containment, stale-write checks and private policy remain host obligations.

### Runtime status, management and sign-in outcomes

**Owner:** [[submodule-server-agent]], `mcpSessions.ts` / `mcpSignIn.ts`, and
[[submodule-server-agent-mcp]], `status.ts` / `log.ts`.
Pi exposes management through `/mcp` and notifications rather than a typed controller. The host
captures those commands, parses status and outcome text, reads pi's log format, and uses an isolated
pi session for Settings probes. OAuth and credentials stay in pi; the authorization URL is available
through pi's public `openUrl` callback and needs no text parser. **Removal gate:** a public per-session
status read/subscription and cancellable management/auth API, plus structured diagnostics for log
reads. Run `mcpEngine.test.ts`, `mcpSignIn.test.ts`, and the MCP status/log/redaction tests; verify both
modern status pushes and legacy notification redaction when pi's wording changes.

### Ordered engine shutdown and reload admission

**Owner:** [[submodule-server-agent]], session lifecycle, and [[submodule-server-agent-mcp]], `engine.ts`.
`AgentSession.dispose()` does not emit shutdown, and pi's sequential extension shutdown can be held
by an unrelated handler. The host captures the builtin MCP shutdown handler and starts it before
ordinary teardown/reload, retaining a bounded host quit path. Captured and runner-emitted shutdown
share one per-load cleanup promise; reload awaits actual cleanup before replacement admission. Pi
clears its server list before awaiting closure, so idempotence is insufficient to guarantee
completion ordering. The host also guards the actual MCP startup/change callbacks after closure:
`beforeSessionStart` precedes the entire async dispatch and cannot alone prevent late startup.
**Removal gate:** a public lifecycle that closes MCP independently of unrelated handlers, joins the
same actual cleanup on repeated shutdown, admits replacements only after cleanup completes, and
prevents startup even when an earlier handler resumes after disposal. Re-check completion ordering
and `AgentSession.reload` hooks, not just idempotence; run `sessionShutdown.test.ts`, `reloadGate.test.ts`,
and MCP delete/reload/process-lifetime regressions, including a stubborn old PID and a startup dispatch
paused through closure with async `resources_discover`.
`AgentSessionRuntime.dispose()` alone is not evidence that these host obligations disappeared.

### Exposure while codemode is not packaged

**Owner:** [[submodule-server-agent-mcp]], `normalizeExposureForHost` and tool-search activation.
File-configured `codemode` exposure becomes `deferred`; registered servers stay reachable through
`tool_search`. **Removal gate:** ship pi's codemode worker/WASM across CLI and desktop, then preserve
native exposure without normalization. Run config/exposure tests and the shared artifact probes;
public factory availability alone does not establish packaging support.

### Durable presentation details

**Owner:** [[submodule-server-agent-mcp]], `results.ts`, and [[submodule-web-chat]].
Pi's raw `structuredContent` reaches hooks but is not retained in finalized transcript messages.
The host stores bounded, base64-free presentation details so live and restored cards agree.
**Removal gate:** an equivalent bounded durable representation from pi. Re-check result shapes and
full-output paths; run `mcp/results.test.ts`, `mcpEngine.test.ts`, web MCP card tests and
`e2e/mcp-tool-cards.spec.ts`. Never persist the full raw result merely to delete the adapter.

## Other pi-sensitive host seams

**Registry-tool reconcile at attach and reload** — [[submodule-server-agent]], `agentSessionManager.ts`. Pi ≥ 1.3
restores a resumed chat's recorded tool loadout and keeps recorded removals inactive, so a tool withheld
while its registry extension was disabled would stay off after re-enabling. Pi's own `reload()` activates
every extension tool again, but an extension's `session_start` can replay the same record
(`pi-web-access`'s activation selection does, on reloads too), so the reconcile runs at attach and after
every successful gated resource reload. It re-activates enabled registry-extension tools by mirroring
Pi's private `_isActivatedOnRegistration` (declarable exposure, `defaultActive !== false`); re-check that
rule on upgrades. If the host ever calls `navigateTree`, which re-runs the restore, reconcile after it
too. **Removal gate:** a public Pi way to keep host-withheld tools apart from the recorded selection, so
neither Pi's restore nor an extension reading the transcript sees them as removals. Run the manager's
restart and toggle-reload regressions on upgrades.

- **Anthropic extra-usage warning parity** — [[submodule-server-agent]], `agent/anthropicExtraUsage.ts`.
  Pi's warning exists only in interactive mode (`maybeWarnAboutAnthropicSubscriptionAuth`), and its
  `sk-ant-oat` predicate and warning text are module-private. So the host mirrors the trigger: it uses
  the public `ModelRuntime.checkAuth` / `getAuth`, gates on `SettingsManager.getWarnings()`, and copies
  the prefix check. The re-check points are mirrored too: session start, every model change via pi's `model_select` event, and Anthropic login.
  **Removal gate:** pi exports the predicate, or a host-consumable warning event; then drop the copy.
  On upgrades, re-diff the interactive check and its call sites, and run
  `agent/anthropicExtraUsage.test.ts`.
- **pi package management** — [[submodule-server-agent-packages]], [[submodule-server-agent]]. The
  Settings → Extensions & skills package catalog and mutations build on pi's public
  `DefaultPackageManager` (`resolve(onMissing)`, `install`, `remove`, `update`,
  `checkForAvailableUpdates`, `listConfiguredPackages`, `addSourceToSettings` /
  `removeSourceFromSettings`) and `SettingsManager`
  (`setPackages` / `set*Paths`, `flush`, `drainErrors`, `inMemory`). Nine pi facts the host compensates
  for, each with its gate:
  - `resolve()` without `onMissing` installs a declared-but-missing package, and
    `DefaultResourceLoader.reload()` always calls it that way; the catalog therefore reads with
    `onMissing → skip`, and the one-off install probe loads through a loader built on
    `SettingsManager.inMemory({})`.
    **Gate:** a public no-install resolve or exact-path extension loader.
  - `pi config`'s toggle writers are a TUI component, not SDK; `mutations.ts` replicates the format for
    top-level resources only (`±relative` patterns, `±builtin:<name>`) and deliberately keeps a plain
    explicit `extensions[]` entry beside its `-` override, which the TUI replaces, losing discovery.
    In-package filters are not written at all (deferred until a public per-resource API: every port of
    `applyPatterns` / `collectPackageResources` semantics changed what pi loads in some shape). Re-run
    the round-trip tests through pi's resolver on every bump. **Gate:** a public
    `setResourceEnabled`-style API.
  - `getPackageIdentity` is private; `identity.ts` ports it for the host-wide `disabledPackages` key.
    **Gate:** pi exporting its identity rule.
  - `getResourcePathKey` (synthetic paths as-is, else realpath with a raw-path fallback, case-folded on
    Windows) is private; `identity.ts` ports it as `piResourcePathKey`, the path identity of
    [[submodule-server-agent]]'s Central exclusion, so it matches the paths pi's resolve and loader dedupe.
    Re-diff it against `core/source-info.js` / `utils/paths.js` on every bump. **Gate:** pi exporting it.
  - `installAndPersist` persists before the caller can re-check project trust, and settings writes are
    queued with swallowed errors; the host sequences `install → trust → addSourceToSettings → flush →
    drainErrors`. **Gate:** a persist step that reports failure and accepts a trust predicate.
  - A local *input* source is matched against the process cwd while a *declared* one is stored relative
    to its settings file (`getSourceMatchKeyForInput` vs `…ForSettings`); mutations pass absolute paths,
    normalised by a port of pi's private `resolvePath` (`~`, `file://`) in `resolveLocalSource`.
    **Gate:** pi matching declared strings by settings scope, or exporting `resolvePath`.
  - `isOfflineModeEnabled` (`PI_OFFLINE` ∈ `1|true|yes`) is private and pi's `install` / `update` turn
    into silent no-ops offline; `identity.ts` ports the rule so the host can refuse with `PACKAGE_OFFLINE`.
    **Gate:** pi exporting the predicate or throwing a typed error offline.
  - `SettingsManager.save()` / `saveProjectSettings()` silently skip a scope whose file failed to parse
    (private `*SettingsLoadError`); `drainErrors()` is the only signal, so mutations read it per scope
    before writing. **Gate:** a save that reports the skip.
  - pi's extension-factory cache is process-wide and is cleared only by a loaded loader's `reload()`;
    `clearExtensionCache` is not exported. `advancePiExtensionCache` reloads an empty loader twice
    before the boot runtime and before the install probe. **Gate:** an exported clearer or a per-loader
    cache.
  Also relied on: `SettingsManager.getGlobalSettings` / `getProjectSettings` are the only reads pi's
  package manager makes of declarations, so patching them per instance hides a switched-off package —
  or every package, for a loader that resolves none — from every install-capable resolve
  (`createPiSettings`; **gate:** a loader option to exclude declarations); `PackageUpdate`
  carries no target version; pi skips pinned npm versions in update checks; pi classifies `git@host:…`
  and `github:…` sources as local paths.
- **Anthropic SSE framing patch** — [[submodule-server-agent]] (Provider stream framing),
  `patches/@earendil-works%2Fpi-ai@1.6.0.patch` on `dist/api/anthropic-messages.js`. Unpatched, two
  streams fail with the non-retryable "Could not parse Anthropic SSE event": a valid CRLF stream whose
  `\r\n` is split across network chunks, and a stream cut off mid-event. Patched, the first succeeds and
  the second ends with a retryable truncation error such as "stream ended before message_stop".
  **Removal gate:** an installed pi-ai release that fixes both (track
  [upstream #10390](https://github.com/earendil-works/pi/issues/10390)). Bun silently skips a patch whose
  version doesn't match, so every pi bump runs `agent/anthropicStreamFraming.test.ts` against the
  unpatched release. Its "defects the patch fixes" group decides: when it passes, delete the patch and its
  `patchedDependencies` entry; when it fails, port the patch to the new version. Port by regenerating the
  file from a clean 1.x dist, not by renaming it: Bun applies hunks at their recorded lines and silently
  produces a broken module when the context moved (1.5.0 shifted it by two lines), and only the framing
  test catches that. If only the "behavior the patch keeps" group fails, pi changed that behavior: decide
  whether to follow it before porting anything.
- **Registry tool precedence** — [[submodule-server-extensions]], `preferRegistryTools` in the session
  loader's `extensionsOverride`, and the composition order around it. It relies on three pi facts:
  - pi keeps every extension and gives a tool name to its first registration
    (`ExtensionRunner.getAllRegisteredTools`);
  - path extensions (user packages) load before inline factories;
  - tool conflicts are reported only between extensions, before the override runs.

  The override moves a **built-in** registry extension ahead of the first user package registering one
  of its tool names (with the built-ins between them, keeping their order), so a same-name package such as rpiv's `ask_user_question` cannot take over the card,
  mailbox and repair that key on the name. An installed extension is never promoted: it is composed
  after every host-owned inline factory, so by the first fact any host tool (a built-in's, a host
  factory's, a session extra's, an MCP tool of the `builtin:mcp` path) beats it, and by the second a
  user's pi package beats it on a shared tool name — the pi package's tool wins, both extensions' other
  tools stay. A fourth fact closes the gap order cannot: pi drops a **replaceable `builtin:` slot** when
  any non-replaceable extension registers one of its names (`omitReplacedExtensions`), and loads the
  slots before every inline factory; the session loader records the names the host's slots (`mcp`,
  `tool-search`) register and refuses those registrations to an installed extension, so
  `tool_search` and `/mcp` stay the host's. Remove it when pi offers an inline-extension precedence or
  replace option. Re-verify the four facts in the installed dist, and run the collision tests in
  `agentSessionManager.test.ts` (same-name questionnaire before and after reload, and a chat created with
  ours off that re-enables it over the package) and `agent/extensions.test.ts` (an installed extension
  registering every class of host name) on every upgrade.
- **Superseded vanilla packages** — [[submodule-server-extensions]], `omitSupersededPackages` in the
  same `extensionsOverride`. It relies on pi letting the override drop entries of a
  `LoadExtensionsResult` (the disabled filter does too) and on `Extension.resolvedPath` being the loaded
  file inside the package's install folder, whose nearest `package.json` names the package for npm, git
  and local installs alike. Remove it when pi offers a host-side package exclusion. Run
  `extensions/inline.test.ts` and the superseded-package case in `agent/extensions.test.ts` on every
  upgrade and recheck where pi installs npm and git packages.
- **`/insights` output per mode** — [[module-pi-session-insights]], `extension.ts`. The report goes
  through `ctx.ui.notify(…, "info")`, which pi's TUI shows as dim text in the chat (a following status
  replaces it) and RPC sends as a notification; in print and JSON modes, where `ctx.hasUI` is false and
  pi redirects `process.stdout` to stderr to keep its own stdout clean, it writes to stderr directly.
  Argument completions return full replacement values because pi's autocomplete replaces the whole
  argument text. Recheck `docs/extensions.md` (Mode Behavior, `registerCommand`) on every bump; the
  parity gate's command cases and `extension.test.ts` cover the modes.
- **Provider-registration provenance** — [[submodule-server-agent]], `recordProviderOwners` in the
  session loader's `extensionsOverride` ([[module-pi-delegation]] decision #32). Pi keeps no
  provider-to-extension provenance: `LoadExtensionsResult.runtime.pendingProviderRegistrations` /
  `pendingNativeProviderRegistrations` carry `extensionPath` only until `bindCore` flushes them, and the
  post-bind `registerProvider` it installs drops the path. The host reads the queues during every session
  load; a provider registered only after binding stays unowned, so its children keep the narrow set.
  Children use the same queues the other way: a child drops its owners' queued registrations before
  bind, so the shared runtime keeps the parent's; a post-bind re-registration would still replace it.
  **Removal gate:** a public surface naming the providers each extension registered. Re-verify that the
  queues still carry `extensionPath` and are filled before `extensionsOverride` runs; run the provider-owner
  regressions in `agent/extensions.test.ts`, `agent/delegation.test.ts` and `pi-delegation`'s
  `service.test.ts` on every upgrade.
- **Extension providers in the shared catalog** — [[submodule-server-agent]], the user-extension pass in
  `piRuntime.ts` (`registerUserExtensionProviders`, #1351). Pi applies the queued
  `pendingProviderRegistrations` / `pendingNativeProviderRegistrations` / `pendingVirtualModelRegistrations`
  of a load only in `createAgentSessionServices` (the CLI, before model resolution) or at a session's
  `bindCore` (after it). The services call cannot carry the catalog's user pass: it applies a load's
  registrations whenever that load finishes, so a pass abandoned at its deadline would still register late,
  after the generation's attribution was taken. The host therefore resolves the enabled set itself
  (`resolve(onMissing → skip)`, then the Central exclusion of [[submodule-server-agent]]), loads it through
  its own `noExtensions` loader and mirrors pi's apply loop over those queues on the candidate runtime, then
  its awaited `refresh({ allowNetwork: false })` — only when something was applied, since the strict pass's
  services call has just run it — all within the deadline. It does not clear the queues (the loader is
  discarded) nor apply extension flags (the pass has none). It relies on the queues carrying every
  registration of a load until bind and on a later session bind's re-registration merging over the boot one.
  **Removal gate:** a public way to apply a path-filtered extension load's registrations to a given
  `ModelRuntime` with cancellation (e.g. `createAgentSessionServices` taking an extension filter and a
  signal). On upgrades re-diff the apply loop in `agent-session-services.js` against the host's and run the
  user-extension tests in `piRuntime.test.ts`, `runtimeGenerations.test.ts` and `auth/jbcentral.test.ts`.
- **Queued-message images** — [[submodule-server-agent]], queue projection. Pi's queue API is text-only:
  `getSteeringMessages()` / `getFollowUpMessages()` / `clearQueue()` return strings and drop image blocks,
  so the host keeps a transient per-lane copy of browser-queued message content (images included) while
  pi reports the matching text pending, and projects only a `hasImages` aggregate. Pi 1.5.1 fixed the
  related delivery defect (#8612: an image-only delivery now leaves the queue), so the host's
  `stuckEmptyDeliveries` override is gone; the copy stays. **Removal gate:** pi's queue API returning the
  full queued message content (or a per-message handle), so a restore can rebuild images from pi. Run the
  manager's queue/image regressions (image-only steer, follow-up and prompt; `clearQueue` content).
- **Bundled extension loading and image handling** — [[submodule-server-agent]], [[module-cli]],
  [[module-desktop]]. Forced Jiti transformation, virtual-module identity, static provider registration,
  and the image-resize override bridge resources a single-file artifact cannot discover or load.
  Replace each only when pi supplies an equivalent artifact seam; run `check:seams` and the relevant
  binary/desktop artifact probes, including extension value imports and images.
- **Runtime extension descriptor shim** — [[submodule-server-extensions-installed]], `installed/loader.ts`.
  An installed ThinkRail extension's server entry must import the host's single pi and typebox in every
  launcher, but pi exports no "load a module with extension resolution" API. The host writes a shim that
  evaluates the entry with the jiti instance pi's loader gives a module as `require` (stock jiti
  `evalModule(source, { filename, async: true, forceTranspile: true })`, so a JavaScript entry is
  transformed and resolved like a `.ts` one instead of native-imported), imports `createAgentSession` /
  `Type` for its identity guard, and loads it with
  the public `discoverAndLoadExtensions([shim], empty, empty)`, the descriptor coming back through a
  per-load key on a `Symbol.for` global map. It relies on four pi facts:
  - pi's extension loader applies its module resolution — the alias map in a source run (pi's own
    `loader.js` is `.js`, so dev takes the alias branch), the virtual-module map in the compiled binary
    and the desktop bundle — to every module the entry imports (stock jiti `virtualModules`/`alias`,
    reached through `loadExtensionModule`);
  - `discoverAndLoadExtensions` → `loadExtensions` stays uncached (never pi's process-wide factory cache)
    and loads an explicit file path, so an edited entry reloads on the same path; building a
    `DefaultResourceLoader` for it instead would be cached and would clear pi's cache for every session
    loader of another cwd;
  - pi still calls the default-export factory during load;
  - with `JITI_TRY_NATIVE=false` and `JITI_REBUILD_FS_CACHE=1` around the load (the pair `piRuntime.ts`
    forces, now one serialized `withForcedJitiTransform`, which also sets `JITI_FS_CACHE=false`: a forced
    rebuild never reads that cache) a `.ts` dependency of the extension is
    transformed and mapped; without it a `.ts` dependency reaching pi could bind to a copy in the
    extension's `node_modules`. Plain-JavaScript dependencies are native-imported by Bun either way,
    which is why the installer prunes `@earendil-works/*` and `typebox` from an install.
  Every load checks member identity (`===` on `createAgentSession` and `Type`; jiti hands a namespace
  over as a Proxy, so namespaces are never compared) and fails the extension otherwise.
  **Removal gate:** pi exports a public module loader with its extension resolution (a
  `createExtensionModuleLoader()` / `importExtensionModule(path)` on the package root, or its
  `VIRTUAL_MODULES`); then drop the shim and the global map. **Re-check on every bump:** the artifact
  probe that loads a fixture extension in the compiled binary and the desktop runtime
  ([[module-artifact-tests]]), and `extensions/installed/loader.test.ts`.
- **Installed extensions on pi's installer and loader** — [[submodule-server-extensions-installed]],
  [[submodule-server-agent]]. Three more pi facts the installed-extension runtime builds on:
  - `DefaultPackageManager.install(source)` at user scope writes only under its `agentDir`
    (`npm/node_modules/<name>`, `git/<host>/<path>`), needs no persisted declaration
    (`SettingsManager.inMemory({ npmCommand })`, the user's pi `npmCommand` carried over), and `getInstalledPath(source, "user")` names the package root; its
    npm arguments omit peers (`--legacy-peer-deps`, bun/pnpm equivalents). `checkForAvailableUpdates()`
    reads the declarations from the in-memory settings it is given. **Gate:** none needed while these
    stay public; re-verify the layout on a bump.
  - `DefaultResourceLoader` copies `extensionFactories` at construction and offers no way to change
    them, so a change of the runtime registry is applied by building a fresh inner loader at the next
    reload behind the one `ResourceLoader` a session keeps (`buildResourceLoader`). **Gate:** a loader
    option read on every reload, or a setter. Run `agent/extensions.test.ts` ("rebuilds behind the same
    loader…").
  - pi's `parseGitUrl` reads only `git:` and `https?|ssh|git://` as git; everything else, `file://`
    included, is a path. `extensions.json` follows the same rule (`extensionSourceKind`).
- **Account-scoped model availability** — [[submodule-server-agent]], `modelAvailability.ts`. Pi's
  `openai` provider lists its whole API catalog under Sign in with ChatGPT (its `filterAllModels` drops
  only classifiers), so the host keeps the ids in pi's `openai-codex` catalog; Central proxies advertise
  a narrower catalog than pi's, so the host intersects opaque providers with their `/models` listing.
  Remove the ChatGPT rule when the installed `providers/openai.js` filters OAuth chat models itself, and
  the listing rule when pi narrows a rerouted provider's catalog to what its endpoint serves; run
  `modelAvailability.test.ts` and `runtimeGenerations.test.ts`.
- **Restored model selection** — [[submodule-server-agent]], `piBranchSelection` in
  `agentSessionManager.ts`. A reopened chat is checked against its saved model before pi restores it,
  and that must be pi's virtual-aware `getBranchSelection` (a registered virtual `model_change` holds
  over the physical responses it routed), not `buildSessionContext().model` (the last physical
  response) — else a still-registered router whose last target is gone reads as unavailable and every
  send is refused. Pi exports neither it nor `isVirtualModel`, so the host mirrors the walk and matches
  the `"pi-virtual"` API. **Removal gate:** pi exports `getBranchSelection` or otherwise reports the
  restored selection publicly. `runtimeGenerations.test.ts` pins parity against the installed dist ("the
  restored selection mirrors pi's virtual-aware branch selection"); rerun it on every pi bump.
- **Default-model preference** — [[submodule-server-agent]], `modelDefaults.ts`. Pi's
  `defaultModelPerProvider` is not exported, so the host mirrors it for new-chat, reviewer, and
  one-shot defaults. Remove the mirror when a public export or initial-model resolver exists; until
  then the parity test in `modelDefaults.test.ts` fails on any upstream change to the map or order.
- **Headless theme** — [[submodule-server-agent]], `plainTextTheme`. Pi's terminal theme is not
  initialized by SDK session creation. Remove the subclass when pi supplies a usable non-TUI theme
  contract; run `webUiContext.test.ts` against the whole inherited surface.
- **Trust discovery and exclusion reloads** — [[submodule-server-agent]], `projectTrust.ts` and
  `extensions.ts`. Resource-kind discovery mirrors pi's private trust-requiring paths, while the
  excluding loader preserves reloadable extension paths and builtin exclusions. Prefer a public
  discovery/filter API when available; run `projectTrust.test.ts`, `extensions.test.ts` and
  `piRuntime.test.ts` on every change to resource loading.
- **Session discovery and prompt-template parsing** — [[submodule-server-history]],
  [[submodule-server-templates]], [[submodule-web-chat]]. The host mirrors pi's session directory/JSONL
  discovery and prompt-template/frontmatter rules where public APIs cannot serve its read/edit UI.
  [[module-pi-session-insights]]' `listSessionFiles` mirrors the same directory layout, since pi's
  `SessionManager.list`/`listAll` parse every file they list.
  Prefer public discovery/parsing APIs when they meet those needs; retain parity coverage in history,
  template and composer tests until then.
- **Context edits on summarized display turns** — [[submodule-server-history]], `displayTranscript.ts`
  (`projectContextEntry`). The display projection puts the turns the latest compaction summarized back
  in front of its marker, and they must carry the branch's latest `context_edit` the way pi projects kept
  entries, or an omitted recovery attempt (`replacement: null`) comes back once a later compaction
  advances past it. Pi's per-entry `projectContextEntry` is exported from `core/session-manager.js` but not
  the package root, so the host mirrors it. **Removal gate:** pi exporting `projectContextEntry`, or a
  projection that keeps summarized entries, from the package root. On upgrades run
  `history/displayTranscript.test.ts`, whose parity test compares the mirror with pi's dist function.
- **Subagent usage totals from child transcripts** — [[submodule-server-agent]], `subagentUsage.ts`.
  Pi's session-total loop (`AgentSession.getSessionStats`) is not exported for a bare session file, so
  the host mirrors which entries carry spend (`usage`, compaction/branch-summary `usage`, assistant and
  tool-result message usage) to reconcile crashed child runs. Remove the mirror when pi exports a totals
  helper over entries or a file. Until then `delegation.test.ts` ("the subagent totals mirror matches pi's
  own totals for every spend source") pins parity with pi's `getSessionStats` on one transcript that
  carries every spend source, including off-branch spend; rerun it on every pi bump.
- **Recorded totals, second mirror** — [[module-pi-session-insights]], `src/totals.ts`. Session insights'
  headline tokens and cost are the same spend sources summed over a session file (`usage` entries,
  compaction/branch-summary `usage`, assistant and tool-result message usage, every branch), because
  `getSessionStats` needs a live `AgentSession`. **Removal gate:** pi exports a totals helper over entries
  or a file; then this mirror and `subagentUsage.ts` go together. `totals.test.ts` pins parity with
  `AgentSession.getSessionStats()` on one transcript carrying every spend source, off-branch included;
  rerun it on every pi bump.
- **Streaming parse of session files** — [[module-pi-session-insights]], `src/lines.ts`. Pi's exported
  `parseSessionEntries` is one synchronous pass over a whole file's string, which would stall the host's
  event loop on a large transcript, so the index mirrors the per-line rule it shares with pi's file
  loader (split on `\n`, skip blank and unparseable lines, a complete unterminated last line counts) line
  by line with cooperative yields. **Removal gate:** pi exports an incremental or
  async parser. `lines.test.ts` compares the entries with `parseSessionEntries` on fixtures, a torn last
  line included.
- **Trace timings and the active branch** — [[module-pi-session-insights]], `src/trace.ts`. The trace
  explorer draws a model call from `AssistantMessage.timestamp` (typed in pi-ai as "when the request
  started") to `+ durationMs`, and a tool call ending at `ToolResultMessage.timestamp` and starting
  `durationMs` before it; both `durationMs` fields are typed in pi-ai 1.6.0 but absent from
  `docs/session-format.md`, and older entries lack them (then the span is approximated from entry
  timestamps and labelled so). It also mirrors pi's load rule that the file's last entry is the current
  leaf, following `parentId` to pick the shown branch, because `buildSessionContext` drops the entries a
  trace needs (tool results' ranges, markers). The session timeline (who-waits bands, packed lanes, turn
  durations) and the day view's turn bars are built on the same spans, no further field. **Removal gate:**
  none for the fields (they are pi's record); on every pi bump rerun `trace.test.ts`, `timeline.test.ts` and
  the golden test, and recheck the two `timestamp` doc comments and the leaf rule in `session-manager.js`.
- **Skill activations from prompts** — [[module-pi-session-insights]], `src/facts.ts`. Session insights
  reads a `/skill:name` prompt as a skill activation from the block pi's `AgentSession` expands it into
  (`<skill name="…" location="…">`, `dist/core/agent-session.js`), which is not part of
  `docs/session-format.md`; a successful `read` of `…/SKILL.md` counts too. **Removal gate:** pi records a
  skill activation as an entry of its own. On every pi bump rerun `analysis.test.ts` and the golden test
  (its fixture reads two `SKILL.md` files) and recheck the expansion's opening tag.
- **Request reconstruction and composition replay** — [[module-pi-session-insights]],
  `src/requestDiff.ts` and `src/ledger.ts`. The adjacent-request diff rebuilds a model call's request with
  pi's exported `buildSessionProjection` (the projection behind `buildSessionContext`) at the call's
  parent entry, read-only — nothing is assembled for or sent to a model — and then replays the system
  messages in it the way pi-ai's `getCurrentSystemMessage` does (content appended, `sections` patched by
  name with `null` removing one, `toolsAdded` / `toolsRemoved` by name), because pi-ai is not one of the
  core's dependencies. The per-call composition estimate replays the same rules incrementally over the
  active branch (the latest compaction's `firstKeptEntryId` and `systemMessage` checkpoint, `context_edit`
  omissions and replacements) with pi's four-characters-a-token estimate, since rebuilding the projection
  for every one of thousands of calls would be quadratic. A compaction without a `systemMessage` (older
  entries) reconstructs without a system prompt, as pi's projection does. **Removal gate:** pi exports
  the system-message replay through `pi-coding-agent`, or an incremental projection; on every pi bump rerun
  `requestDiff.test.ts` and `context.test.ts` and recheck `buildContextEntries` and pi-ai's
  `utils/transcript.js`.
- **Edit and write facts** — [[module-pi-session-insights]], `src/facts.ts`. The files matrix counts
  lines from an `edit` result's `details.patch` (pi's `EditToolDetails`, unified diff), falling back to the
  numbered display `details.diff` (`+12 text` / `-12 text`), and a `write`'s `content` argument; these are
  analytics only and badged "from tool calls". **Removal gate:** none (pi's record); on every pi bump rerun
  `files.test.ts` and recheck `EditToolDetails` in `dist/core/tools/edit.d.ts`.
- **Tool paths in the session's own flavor** — [[module-pi-session-insights]], `src/paths.ts`. A `read`,
  `edit` or `write` path argument is stored as the model wrote it, and pi's tools resolve it against the
  session's cwd with the platform's `path` (`resolveToCwd` in `dist/core/tools/path-utils.js`: `@`
  dropped, `~` the home); the header records that cwd as pi's `process.cwd()`, so a Windows session's is a
  drive-letter or UNC path. Session insights reads that prefix as the flavor (`path.win32`,
  case-insensitive, else `path.posix`) rather than the host's, so a session copied to another OS keys its
  files and `SKILL.md` reads as it did where it ran. **Removal gate:** none (pi's record); on every pi bump
  rerun `paths.test.ts` and recheck `resolveToCwd` and the header's `cwd` in `SessionManager`.
- **Persisted skills list and shell exit codes** — [[module-pi-session-insights]], `src/trace.ts`. The
  statistics read which skills a session listed from the persisted system prompt's `skills` section (and a
  compaction's `systemMessage` checkpoint), parsing the `<available_skills>` / `<skill><name>` markup pi's
  `formatSkillsForPrompt` writes (`dist/core/skills.js`, not in `docs/session-format.md`), and size each
  entry at pi's four characters a token. A `bash` result's exit code comes from the trailer pi's bash tool
  appends (`Command exited with code N`, `Command timed out` / `aborted`), which the trace already read.
  **Removal gate:** pi records the listed skills (or an exit code) as structured fields. On every pi bump
  rerun `usage.test.ts` and `findings.test.ts` (both build pi-format lists and trailers) and recheck the
  markup in `formatSkillsForPrompt` and the bash tool's trailer.
- **Byte prefilter over session lines** — [[module-pi-session-insights]], `src/searchScan.ts`. Search
  across sessions skips parsing a line unless its bytes hold a free-text term in the form a JSON string
  holds it, which relies on pi writing each entry with `JSON.stringify` (non-ASCII characters and `/`
  unescaped, `"`, `\` and control characters escaped as `JSON.stringify` does) — the format of
  `SessionManager`'s appends, not stated in `docs/session-format.md`. A writer that `\u`-escaped non-ASCII
  text would make such terms miss, never match wrongly. **Removal gate:** none (pi's record); on every pi
  bump rerun `search.test.ts`, whose prefilter test compares against a full parse and searches a file pi's
  `SessionManager` wrote (quotes, a backslash, Cyrillic and an emoji).
- **Fixture cut of a session file** — [[module-pi-session-insights]], `src/fixture.ts`. The e2e fixture
  export writes a loadable session by keeping the header and the `parentId` chain from the root to the
  cut entry, in file order, and relies on pi's load rule that the last entry is the leaf (as the trace
  does) and on every entry of a current-format file carrying `id` / `parentId`; strings are redacted and
  the header's `cwd` replaced, which pi does not validate on open (the workflow harness rewrites it
  anyway). A first-format file without ids is cut by position. **Removal gate:** pi exports a "fork at
  entry" writer (pi's `SessionManager` forks copy whole branches into a new file, with a new id and a
  `parentSession`, which a fixture must not carry). On every pi bump rerun `exports.test.ts` and recheck
  the leaf rule and the entry fields in `docs/session-format.md`.
- **Cut-back of a failed usage append** — [[submodule-server-agent]], `recordSessionUsage`. Since pi 1.5
  (`#11460`) a failed `_persist` removes the entry from memory and restores the leaf, so the host's leaf
  restore is gone and a failed append reports `false`. Pi still appends with one `appendFileSync`, which
  can leave a torn partial line, so the host truncates an existing transcript back to its pre-append size;
  `delegation.test.ts` pins both ("a failed usage write leaves pi's memory and leaf untouched…" against a
  real read-only file, "a torn usage append is cut back…"). **Removal gate:** pi guarantees that a failed
  append leaves no torn bytes. If pi ever stops rolling back memory, the first test fails: that is a
  reason to reinstate the restore, not to weaken the test.

- **Detached result hold** — [[module-pi-subagents]] (Result delivery) and
  [[module-pi-background-commands]], applied by [[submodule-server-agent]]'s `turn_end` and
  `compaction_end` flushes. Pi drains follow-up messages only when a run would otherwise stop, offers
  extensions no way to inspect or withdraw one queued message (`hasPendingMessages()` is a boolean,
  `clearQueue()` is host-only and clears everything), and keeps queued messages across an abort, so a
  pushed result duplicated one the agent had already pulled. The owners hold outcomes and send them
  only at step boundaries or to an idle parent. **Removal gate:** a per-message queue handle an
  extension can withdraw, delivered at the next step rather than at run end — even then, keep the
  claim-on-pull rule. The owners also hold later idle deliveries behind a wake pi defers inside
  `agent_settled` (the parent still reads idle, and each deferred request starts its own run); drop
  that hold once pi coalesces deferred wakes or reports the pending run. Run the `pi-subagents` and
  `pi-background-commands` suites and `agent/chatResources.test.ts`.
- **Skill catalog budget** — [[submodule-server-agent]], `skillCatalog.ts`. Pi's
  `formatSkillsForPrompt` lists every admitted skill with its full description and no cap, so a machine
  with other agents' skills put 1,395 skills (~165K tokens) in every request (#1210). A host
  `before_agent_start` handler replaces the `skills` section with a budgeted, ranked listing only when
  pi's would overrun the budget, registers `skill_search` over the full set, and hints distinctly
  matching unlisted skills after the user turn. Remove it when pi caps
  or defers its skill listing natively; verify with `skillCatalog.test.ts`.
- **Skill bodies across compaction** — [[submodule-server-agent]], `skillCarryover.ts`. Pi's compaction
  summarizes loaded skill text away (a `read` result reaches the summarizer cut to 2000 characters) and
  nothing re-supplies it, so a host `context` handler re-attaches compacted skill bodies to every
  request after a compaction. Remove it when pi's compaction preserves or re-attaches loaded skills
  natively; verify with `skillCarryover.test.ts` and `bun run e2e:full e2e/skill-after-compaction.live.spec.ts`.
  It skips virtual selections by matching pi's unexported `"pi-virtual"` model API, since a `context`
  handler sees only the selection, not the routed model; replace that check when pi exposes the
  dispatched model (or `isVirtualModel`) to `context` handlers.

- **Cache-warming default** — [[submodule-server-agent]], `cacheWarming.ts` (`applyCacheWarmingDefault`).
  Pi 1.5.1 defaults `cacheWarming` to `idle`, which spends tokens in every idle chat, and reads the mode
  from the snapshot its `SettingsManager` loaded (`globalSettings`, rebuilt by every persisting setter's
  `save()`), so neither an in-memory `applyOverrides` nor a one-time default survives pi's own writes.
  The host therefore replaces `getCacheWarmingMode` on every session's `SettingsManager` — chats and
  delegated children alike — with a getter that answers from pi's `settings.json` (mtime-cached) and falls
  back to `streaming` while the file names no valid mode; the Settings control writes that file through
  pi's own `setCacheWarmingMode`, and no per-session fan-out exists. **Removal gate:** a public way to give
  the SDK a cache-warming default without touching the user's file (a `createAgentSession` /
  `SettingsManager` option, or pi re-reading the file at each decision), or pi returning to a default that
  costs nothing while idle. On upgrades re-check that `sdk.js` still obtains the mode through
  `settingsManager.getCacheWarmingMode()` and that `CacheWarmer` consults it before every warm
  (`validateRun`); run `cacheWarming.test.ts` (it asserts pi's own default is `idle` so a change upstream
  shows up) and the manager's cache-warming tests.
- **Credential writes at host exit** — [[submodule-server-agent]], `settleCredentialWritesForShutdown`.
  Pi 1.5.1 waits for an in-flight OAuth refresh in `AgentSessionRuntime.dispose()` (#11692: the refresh
  spends its single-use token before the rotated one is saved); the host does not use that runtime, so its
  graceful shutdown calls the public `ModelRuntime.settleCredentialWrites()` itself, on the active
  generation and on every runtime a live chat still holds. Not a workaround but a pi fact the host must
  mirror: re-check on upgrades that credential writes are still tracked per `ModelRuntime` (a process-wide
  settle would let the host call it once) and run the manager's shutdown-settle test.
- **Rejected server-side fallback repair** — [[submodule-server-agent]] (`agent/serverFallback.ts`),
  [[submodule-web-chat]] (`assistantFailure.ts`). Pi sends Anthropic's `fallbacks` field and the
  `server-side-fallback-*` beta whenever a model's `compat.allowedFallbackModels` is non-empty, and offers
  no per-request opt-out, so the host repairs a proxy that rejects it by writing the documented
  per-model `modelOverrides.<id>.compat.allowedFallbackModels: []` (pi: "when absent or empty, callers
  must omit fallbacks"). Re-check on upgrades: that key name and its empty-list meaning; that
  `modelOverrides` still apply after provider config and extension registrations; that the beta header
  is still gated on the same list; which catalogue models declare fallbacks; and that a failed request
  still leaves an assistant message with `stopReason: "error"`, `provider` and `model` as the last
  message (the host reads the failed model from it). The web error-signature table matches proxy and
  gateway wording, not pi's, so pi upgrades do not touch it. **Removal gate:** pi detects or tolerates a
  rejected `fallbacks` field itself, or exposes a session-level opt-out. Run `serverFallback.test.ts`
  (its fake proxy asserts the field and the beta are gone after the repair) and
  `assistantFailure.test.ts`.

## Context-budget limitations

**Owner:** [[submodule-server-agent]]. These are upstream limitations, not host adaptations. In the
installed SDK, `findCutPoint` keeps a trailing tool-call/result pair whole even when it alone exceeds
`keepRecentTokens`, and `generateSummary` serializes the whole summarized span without an input
budget (since Pi 1.4 it requests up to the model's output limit). Bounded tool results therefore do
not guarantee whole-request admission.

**Upgrade check:** inspect those public functions in the installed compaction implementation for
retained-batch and summary-input budgeting. Use a tool pair larger than the recent-token target and
user text larger than the summary model's input window to assess admission, not as CI assertions that
the limitations must persist. Do not compensate with host retries or compaction-default overrides.

## Not temporary SDK workarounds

Project-server approvals, private project/chat overrides, confirmation policy, credential masking,
wire capability checks and React presentation are deliberate ThinkRail behavior. Their owners are
[[submodule-server-agent-mcp]] and [[submodule-server-agent]]. A pi upgrade does not silently remove
or weaken them. Reusing an upstream policy is a separate compatibility/product decision, not an
assumption that similarly named APIs have identical semantics.
