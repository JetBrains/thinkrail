---
id: submodule-server-extensions
type: submodule-design
status: active
title: extensions — the server registry of ThinkRail extensions
parent: module-server
depends-on: [module-extension-api, module-thinkrail-extensions]
tags: [extensions, public-surface-checked]
---

## Responsibility

The one place the host lists the ThinkRail extensions it composes ([[module-thinkrail-extensions]]
§ Composition) — built in and installed. `registry.ts` statically imports every
`@thinkrail/ext-*/server` into `builtinServerExtensions`, ordered entries `{ specifier, extension }` —
the `defineServerExtension` descriptor **and** its public server specifier as a string. The static
imports carry the factories into the compiled CLI binary and the desktop server-runtime bundle through
the normal server graph, so the packagers generate no factory list for registry extensions, and build
support stages only these. `serverExtensions()` is the **runtime registry**: the built-ins first, then
the server halves the [[submodule-server-extensions-installed]] sub-module loaded, each as an entry whose
`specifier` is its absolute entry file and whose `installed.skillRoots` are the roots its loader
resolved. It returns the same array until the loaded set changes (entries are memoised per loaded
server half), which is what the agent's loader compares to decide on a rebuild. Everything that composes
extensions — inline flattening, the switch filter, tool precedence, interactive and artifact tools, owner
lookup, skill roots — defaults to it, so an installed extension is composed exactly like a built-in.

## Boundary

- **Owns:** `serverExtensions` (the ordered entries), `registryInlineExtensions(kind, isDisabled?,
  entries?, session?)` (flattens `extensions` / `childExtensions` into pi `InlineExtension`s named after
  the extension — one factory keeps the bare name, several get `name#n` — so pi diagnostics show
  `<inline:visualize>` instead of a position; an installed extension's names live in their own namespace,
  `ext:<name>` / `ext:<name>#n` (`<inline:ext:weather>`): an npm name holds no `:`, so an installed
  package can never be read back as a built-in or a host inline of the same name; each factory asks `isDisabled(name)` **when pi loads it**, so
  a reload re-decides membership without rebuilding the loader. A parent flatten given the host's
  `HostSessionServices` appends `sessionExtensions(services)` after the static factories under the same
  naming; it calls it once per flatten, so every parent session's factories close over its own services.
  A `sessionExtensions` that throws, or returns anything but a list of factories, becomes one factory that rethrows when pi loads it, so the failure is
  that extension's `<inline:name>` load error rather than a loader that cannot be built (the catalog's
  inert-session call likewise keeps only the static tools). An **installed** extension's factory, static
  or per-session, is raced against `EXTENSION_LOAD_TIMEOUT_MS` when pi loads it: one still running then is
  that extension's load error (`<name> did not finish loading within 10 s`) and the chat starts without it.
  pi stages a factory's registrations until it returns and discards them when it throws, so a late settle
  registers nothing; built-ins are ours and are not raced. The bound is per factory, as pi loads them one at
  a time: an extension whose several factories all hang delays a chat's start by 10 s each. Each extension gets its **own view** (`extensionSessionServices`): `setting(key)` answers only that
  extension's declared settings — the stored value from the injected `ExtensionSettingValue` lookup, else
  the declared default; an undeclared key throws — and is read **inside the factory body**, so every pi
  (re)load sees current values. Without services, and in the child set, session factories are absent),
  `workspaceFiles` (the host's file check shared by extension server halves through the session seam —
  `checkWorkspaceFile` + `MOCKUP_DIR` (`contracts`' `WORKSPACE_MOCKUP_DIR` with a trailing slash, the one
  name the UI also uses to run mockup scripts): a path must be relative, stay inside the session cwd lexically and
  after resolving links, name a regular file and stay out of `.git`, the paths the host's `fs.readFile`
  then serves; `extension-api` stays contract-only, so the check lives here, not in the SDK; plus
  `ensureArtifactsDir`, which is `shared`'s `seedArtifactsDir` on the session cwd), `omitDisabledRegistryExtensions(result, isDisabled)` (drops a disabled
  extension's `<inline:…>` entries from a pi `LoadExtensionsResult`, for the parent loader's
  `extensionsOverride`, so a disabled extension is absent rather than present-and-empty),
  `preferRegistryTools(result)` (also composed into that override, after the disabled filter). It moves a
  **built-in** directly ahead of the first other extension that registers one of its tool names, so a
  user-installed same-name package never takes over a tool whose host UI and lifecycle key on the name —
  `ask_user_question` is the reason. Every built-in between the two moves with it, in its order: built-ins
  never reorder among themselves, because their order is the precedence. An installed extension is never
  promoted — **host-owned tools always win**: the agent composes it after every host inline factory
  ([[submodule-server-agent]] § composition), so a built-in's, a host factory's or an MCP tool beats it,
  and a user's pi package, which pi loads before any inline factory, beats it on a shared name. The other package's other tools, commands and hooks stay
  loaded. pi's own conflict diagnostic stays in the loader result, unreported, as before. The pi facts it
  relies on are registered in [[pi-compatibility]]),
  `registryExtensionName(path)` (maps an `<inline:name>` / `<inline:name#n>` path — an extension's or its
  tools' `sourceInfo.path` — back to the registry extension that owns it by name, a bare name to a
  built-in only and an `ext:` name to an installed extension only, `undefined` otherwise;
  matching by name rather than by recomputed names keeps it independent of how many per-session factories
  a session got),
  `listExtensionCatalog(disabled, builtins?, installed?)` (the Settings catalog: the built-ins, then
  one row per installed declaration from the runtime's records, so a failed or incompatible extension is
  listed with `state` / `error` and no tools; per entry `name`, `title` — an installed one's manifest
  title, else its descriptor's, else `name` — optional `description` (an installed one's package
  description first), `hasChildExtensions`, `enabled = !disabled.has(name)`, `kind`, for installed
  `source` / `version` / `state` / `error` / `web` (`webHalfOf`), the declared
  `settings` (`key` + `default`, plus an installed setting's own `title` / `description`), and the tool names
  its **parent** factories register against a recording stub `ExtensionAPI` whose every other member is
  inert — for an installed row only the names it owns (`extensionToolNames` below). Per-session factories are built for this with an inert session whose `awaitToolResponse` and
  `workspaceFiles.check` reject and whose `setting` answers the declared defaults. The tools are computed once per descriptor object (a reloaded installed extension is a new one), never from a live session, and a factory that throws against the stub,
  or is still running after `EXTENSION_LOAD_TIMEOUT_MS`, keeps the tools it recorded until then; a
  `sessionExtensions` that throws or answers anything but a list adds none (a promise among such answers has
  its rejection observed, here and in a session's flatten, so it never reaches the crash handler) — so no
  third-party code holds `extension.list` or the status file for longer than that bound), `skillPackageRoots(extensionEntry, extension)` (the
  shared owner-scoped resolver: each `skillPackages` manifest via `createRequire(extensionEntry)`,
  returning its `pi.skills` directories; a named package with no skills fails loudly — the installed
  loader calls it once per load, so an unresolvable skill package is a failed row, not a broken chat),
  `resolveExtensionSkillRoots(entry)` (a built-in's entry file from `specifier`, then `skillPackageRoots`;
  an installed entry's recorded roots),
  `STAGED_HOST_SKILLS_ROUTE` (`host`) and `stagedExtensionSkillRoute(name)` (`extensions/<name>`) — the
  folders of a staged skills root the host's and an extension's roots are staged under, shared by build
  support and the runtime so a disabled extension's folder can be left out of pi's skill inputs and `extensionSkillRoots(entry,
  stagedSkillsDir?)` (the roots that own an extension's skills: the resolved source roots without a
  staged dir or for an installed extension — never staged — that owner folder with one, nothing for an
  extension without `skillPackages`), `startInstalledExtensions({ dataDir, onChange, npmCommand?, installer?, hostExtensionNames? })`
  (`installedHost.ts`: builds the installed runtime with every built-in's name reserved — the server
  registry's plus the web-only built-ins the host otherwise never sees, since an installed package of
  the same name would share their on/off switch; a test holds the list to the `thinkrail-extensions/`
  packages — and the `hostExtensionNames` the host hands in: the names of its own named inline
  extensions, pi's built-in slots it supplies (`mcp`, `tool-search`; `agent`'s
  `HOST_BUILTIN_EXTENSION_NAMES`, the constant that names them, and a test fails when the composed loader
  holds a named host inline outside it). The host's other inline factories are unnamed (`<inline:<n>>`);
  the `ext:` namespace keeps every one of them apart from an installed extension —
  `skillPackageRoots` as its resolver and the catalog's tool names for its status file, makes it the
  host's one, starts the watcher and a background reconcile, and returns its stop; it also hands the
  catalog `hostToolFactories` — `agent`'s `HOST_INLINE_FACTORIES`, the one list the parent composition
  uses too). **`extensionToolNames(extension)`** splits an installed half's recorded names (the same
  memoised description Settings lists) into `tools` it owns and `shadowed` ones the host owns, so neither
  Settings nor the status file presents a name whose registration has no effect. The host names it knows
  without a session are every built-in's (parent and inert-session factories, whether switched on or
  off — a switch can take the name back at any reload) and those the host's static inline factories
  register against the same stub. **Not known, so left listed:** names that only a session's loader
  reveals — the per-session host factories (subagents' `Agent`, background commands, the MCP host's
  server tools and `mcp` / `tool-search` slots, the usage policy), the host's pi packages (pi-spec-graph,
  pi-thinkrail-workflow, pi-todos: extension paths from source, bundled factories in a binary) and the
  user's own pi packages and extensions. The specifier is kept
  as a string precisely because a descriptor holds functions, which yield no module identity.
- **Public surface (barrel):** `serverExtensions`, `builtinServerExtensions`, `ServerExtensionEntry`,
  `registryInlineExtensions`,
  `RegistryExtensionKind`, `ExtensionDisabled`, `omitDisabledRegistryExtensions`, `preferRegistryTools`,
  `registryExtensionName`, `extensionSessionServices`, `HostSessionServices`, `ExtensionSettingValue`,
  `checkWorkspaceFile`, `workspaceFiles`, `MOCKUP_DIR`,
  `listExtensionCatalog`,
  `resolveExtensionSkillRoots`, `skillPackageRoots`, `STAGED_HOST_SKILLS_ROUTE`,
  `stagedExtensionSkillRoute`, `extensionSkillRoots`, `interactiveTools`, `InteractiveTools`,
  `artifactTools`, `ArtifactTools`, `ExtensionSessionServices`, `InteractiveTool`, `ArtifactTool`,
  `ToolResponse`, `startInstalledExtensions`, `InstalledExtensionsHostOptions`, `InstalledExtensions`,
  `InstalledExtensionRecord`, `StagedExtension`, `ExtensionSourceKind`, `installedExtensions`,
  `resolveExtensionAsset`, `withForcedJitiTransform`, `EXTENSION_LOAD_TIMEOUT_MS`.
- **Re-exported from the installed sub-module:** the last eight names of the surface above.
- **Session-seam types:** `ExtensionSessionServices`, `InteractiveTool` and `ToolResponse` are re-exported
  from `extension-api/server` so that `agent` can type the services it builds through this barrel.
- **Interactive tools (`interactive.ts`):** `interactiveTools(isDisabled)` folds the enabled registry
  extensions' `interactiveTools` declarations into one name → `InteractiveTool` map (first declaration of a
  name wins). It is the only tool knowledge `agent` holds for restart repair, transcript-derived
  needs-input and late-response wording. **Artifact tools (`artifactTools.ts`)** fold the enabled
  extensions' `artifactTools` the same way; `host` maps a successful call's declared paths into the
  artifact index's session events (`host/artifactEvents.ts`), so it too names no tool; nothing in `packages/server` names an extension's tool or imports an
  extension outside `registry.ts`. The one tool name the host knows is `web_search`, in `agent`'s
  headless-search policy: it compensates for the host's UI for any copy of `pi-web-access`, so it is not
  the extension's to own.
- **Allowed deps:** `@thinkrail/extension-api/server` (types), every `@thinkrail/ext-*/server`,
  `@thinkrail/shared` (`paths`, `artifactsDir`),
  `@earendil-works/pi-coding-agent` (types only), `@thinkrail/contracts` (the `ExtensionCatalogEntry` type),
  `log`, Node `module`/`fs`/`path`; the `installed` sub-module through its barrel (it holds the pi value
  imports, the install root and the loader, and never imports back — the reserved names and the skill
  resolver are handed to it).
- **Forbidden:** `host`; `settings` (the disabled set arrives as a parameter); sibling features; resolving extension-owned packages from the host's own
  `createRequire` (the host does not depend on the pi packages an extension composes, so that resolution
  breaks in isolated layouts).

## Consumers

`host` answers `extension.list` with `listExtensionCatalog` over the `disabledExtensions` setting, starts
the installed runtime at server start, serves `resolveExtensionAsset` on its `/extensions/` route and
answers `extensions.*`; `agent` runs the install-time kind detection (`stage` / `adopt`) and its pi
runtime build shares `withForcedJitiTransform`.
`agent/extensions.ts` composes the flattened parent set into every resource loader and the child set
into the curated hidden-child extensions in dev and bundled mode alike, and leaves a disabled extension's
`extensionSkillRoots` out of pi's skill inputs; `buildSupport.ts` hands both packagers each extension's skill roots
with their `stagedExtensionSkillRoute`; unbundled dev resolves the same roots at runtime, and the bundled
runtime uses only the launcher-staged root.
