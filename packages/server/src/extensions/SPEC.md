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
§ Composition). `registry.ts` statically imports every `@thinkrail/ext-*/server` and exports ordered
entries `{ specifier, extension }` — the `defineServerExtension` descriptor **and** its public server
specifier as a string. The static imports carry the factories into the compiled CLI binary and the
desktop server-runtime bundle through the normal server graph, so the packagers generate no factory
list for registry extensions.

## Boundary

- **Owns:** `serverExtensions` (the ordered entries), `registryInlineExtensions(kind, isDisabled?,
  entries?, session?)` (flattens `extensions` / `childExtensions` into pi `InlineExtension`s named after
  the extension — one factory keeps the bare name, several get `name#n` — so pi diagnostics show
  `<inline:visualize>` instead of a position; each factory asks `isDisabled(name)` **when pi loads it**, so
  a reload re-decides membership without rebuilding the loader. A parent flatten given the host's
  `HostSessionServices` appends `sessionExtensions(services)` after the static factories under the same
  naming; it calls it once per flatten, so every parent session's factories close over its own services.
  Each extension gets its **own view** (`extensionSessionServices`): `setting(key)` answers only that
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
  `omitSupersededPackages(result, isDisabled)` (composed between the two: drops the extensions of the
  npm packages an enabled extension names in `supersedesPackages`, identified by the `name` of the
  nearest `package.json` above each loaded file — memoized per folder — so an npm, git or local install
  of the package is left out alike; inline entries are never touched, and a disabled superseding
  extension lets the package load again. The catalog still lists the package with what a load recorded,
  since recording runs first; `agent` marks its row `supersededBy` through `supersedingExtension(name,
  isDisabled)` — the enabled extension naming that package — and keys an open chat's reload on what
  `supersedablePackagesIn(result)` — the loaded packages any extension supersedes, on or off — found, so a
  switch flip reloads only chats that actually load such a package),
  `preferRegistryTools(result)` (also composed into that override, after the disabled filter). It moves a
  registry extension directly ahead of the first non-registry extension that registers one of its tool
  names, so a user-installed same-name package never takes over a tool whose host UI and lifecycle key on
  the name — `ask_user_question` is the reason. The other package's other tools, commands and hooks stay
  loaded. pi's own conflict diagnostic stays in the loader result, unreported, as before. The pi facts it
  relies on are registered in [[pi-compatibility]]),
  `registryExtensionName(path)` (maps an `<inline:name>` / `<inline:name#n>` path — an extension's or its
  tools' `sourceInfo.path` — back to the registry extension that owns it by name, `undefined` otherwise;
  matching by name rather than by recomputed names keeps it independent of how many per-session factories
  a session got),
  `listExtensionCatalog(disabled)` (the Settings catalog: per entry `name`, `title` — falling back to
  `name` — optional `description`, `hasParentExtensions` (the descriptor declares `extensions` or
  `sessionExtensions`), `hasChildExtensions`, `enabled = !disabled.has(name)`, the declared
  `settings` (`key` + `default`), and the tool names
  its **parent** factories register against a recording stub `ExtensionAPI` whose every other member is
  inert. Per-session factories are built for this with an inert session whose `awaitToolResponse` and
  `workspaceFiles.check` reject and whose `setting` answers the declared defaults. The tools are computed once per process, never from a live session, and a factory that throws against the stub
  keeps the tools it recorded before throwing; plus the declared `apiVersion` — the catalog never builds
  `queries(host)`), `createExtensionQueries({ isDisabled, services, entries? })` →
  `ExtensionQueries { query, releaseDisabled }` (`query` is the `extension.query` dispatcher: each
  extension's `queries(host)` is built lazily on its first query, with that extension's
  `ExtensionHostServices` from the injected `services(name, signal)`, the signal its own
  `AbortController`'s; an unknown extension, one without `queries`, an unknown method or a malformed
  request is `UNKNOWN_EXTENSION_QUERY`, a disabled one `EXTENSION_DISABLED` — checked on every call, before
  anything is built — and an error a query throws propagates unchanged. `releaseDisabled()` aborts, with
  an `EXTENSION_DISABLED` reason, and forgets the table of every extension now off, so its background work
  stops and its memory goes; the first query after it is back on builds a new table with a fresh signal.
  The host calls it on a switch rather than the dispatcher on its next call, because a switched-off
  extension receives no next call), `runExtensionHostServices({ isDisabled, services, entries? })`
  (→ `ExtensionHostServiceRunner { sync, stop }`: `sync()` calls each enabled extension's
  `hostService(services(name, signal))` that is not running, the signal its own `AbortController`'s, and
  stops each disabled one's, so the host calls it once its publishers are wired and again on every
  `disabledExtensions` change; a start that throws is logged on the extension's own `log` and retried at
  the next `sync`; `stop()` awaits every running service's `stop` (a failing one is logged) and makes later
  `sync`s inert; after each stop the service's signal is aborted, which ends what the host holds for that
  run alone — its event subscriptions — so a run restarted while an older `stop` is pending keeps its own), and `resolveExtensionSkillRoots(entry)` (the owner-scoped skill resolver: the extension's
  entry file from `specifier`, then each `skillPackages` manifest via `createRequire(extensionEntry)`,
  returning its `pi.skills` directories; a named package with no skills fails loudly),
  `STAGED_HOST_SKILLS_ROUTE` (`host`) and `stagedExtensionSkillRoute(name)` (`extensions/<name>`) — the
  folders of a staged skills root the host's and an extension's roots are staged under, shared by build
  support and the runtime so a disabled extension's folder can be left out of pi's skill inputs and `extensionSkillRoots(entry,
  stagedSkillsDir?)` (the roots that own an extension's skills: the resolved source roots without a
  staged dir, that owner folder with one, nothing for an extension without `skillPackages`). The specifier is kept
  as a string precisely because a descriptor holds functions, which yield no module identity.
- **Public surface (barrel):** `serverExtensions`, `ServerExtensionEntry`, `registryInlineExtensions`,
  `RegistryExtensionKind`, `ExtensionDisabled`, `omitDisabledRegistryExtensions`, `omitSupersededPackages`, `preferRegistryTools`,
  `registryExtensionName`, `extensionSessionServices`, `HostSessionServices`, `ExtensionSettingValue`,
  `checkWorkspaceFile`, `workspaceFiles`, `MOCKUP_DIR`, `supersedablePackagesIn`, `supersedingExtension`,
  `listExtensionCatalog`, `runExtensionHostServices`, `ExtensionHostServiceRunner`,
  `resolveExtensionSkillRoots`, `STAGED_HOST_SKILLS_ROUTE`, `stagedExtensionSkillRoute`,
  `extensionSkillRoots`, `interactiveTools`, `InteractiveTools`, `artifactTools`, `ArtifactTools`,
  `ExtensionSessionServices`, `InteractiveTool`, `ArtifactTool`, `ToolResponse`, `createExtensionQueries`,
  `ExtensionQueries`, `ExtensionHostServicesFor`, `ExtensionHostServices`, `ExtensionSessionView`, `ExtensionSessionPlacement`,
  `ExtensionHostProject`, `ExtensionHostWorkspace`, `ExtensionSessionStatus`, `ExtensionMessageAnchor`,
  `ExtensionModel`, `ExtensionTurnReceipt`, `ExtensionTurnTree`, `ExtensionTreeFile`, `ExtensionArtifactsDir`,
  `ExtensionLog`, `ExtensionQuery`, `ExtensionHostActions`, `ExtensionHostEvents`, `ExtensionHostEventType`,
  `ExtensionHostEventBus`, `ExtensionPublishScope`, `ExtensionWorkspaceFacts`, `ExtensionChatFacts`,
  `ExtensionTaskSpec`, `ExtensionOpenspecTree`, `ExtensionTextFile`, `ExtensionHostService`.
- **Session-seam types:** `ExtensionSessionServices`, `InteractiveTool` and `ToolResponse` are re-exported
  from `extension-api/server` so that `agent` can type the services it builds through this barrel.
- **Query-seam types:** `ExtensionHostServices` and its value types (`ExtensionSessionView`,
  `ExtensionSessionPlacement`, `ExtensionHostProject`, `ExtensionHostWorkspace`, `ExtensionSessionStatus`,
  `ExtensionMessageAnchor`, `ExtensionModel`, `ExtensionTurnReceipt`, `ExtensionTurnTree`, `ExtensionTreeFile`,
  `ExtensionArtifactsDir`, `ExtensionLog`, `ExtensionQuery`, and the action, event and facts types —
  `ExtensionHostActions`, `ExtensionHostEvents`, `ExtensionHostEventType`, `ExtensionHostEventBus`,
  `ExtensionPublishScope`, `ExtensionWorkspaceFacts`, `ExtensionChatFacts`, `ExtensionTaskSpec`,
  `ExtensionOpenspecTree`, `ExtensionTextFile`, `ExtensionHostService`) are re-exported the same way, beside `ExtensionHostServicesFor`, so `host` builds each extension's services
  through this barrel. This module never builds them: the
  services arrive as a parameter, so there is no edge to `projects`, `workspaces` or `agent`.
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
  `@thinkrail/shared` (`paths`, `artifactsDir`, `codedError`),
  `@earendil-works/pi-coding-agent` (types only), `@thinkrail/contracts` (the `ExtensionCatalogEntry` type),
  Node `module`/`fs`/`path`.
- **Forbidden:** `host`; `settings` (the disabled set arrives as a parameter); sibling features; resolving extension-owned packages from the host's own
  `createRequire` (the host does not depend on the pi packages an extension composes, so that resolution
  breaks in isolated layouts).

## Consumers

`host` answers `extension.list` with `listExtensionCatalog` over the `disabledExtensions` setting,
`extension.query` with one `createExtensionQueries` over the same setting and its per-extension host
services, releasing a switched-off extension's table on each change of that setting, and runs the
extensions' host services with one `runExtensionHostServices` per server.
`agent/extensions.ts` composes the flattened parent set into every resource loader and the child set
into the curated hidden-child extensions in dev and bundled mode alike, and leaves a disabled extension's
`extensionSkillRoots` out of pi's skill inputs; `buildSupport.ts` hands both packagers each extension's skill roots
with their `stagedExtensionSkillRoute`; unbundled dev resolves the same roots at runtime, and the bundled
runtime uses only the launcher-staged root.
