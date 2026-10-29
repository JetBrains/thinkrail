---
id: submodule-server-agent-packages
type: submodule-design
status: active
title: "agent/packages — pi packages: read-only catalog, identity, mutations"
parent: submodule-server-agent
depends-on: [module-contracts]
references: [pi-compatibility]
tags: [pi, extensions]
---

## Responsibility

What ThinkRail owns around pi's package manager so Settings → Extensions can list and manage the pi
packages, loose extension files and built-ins a chat loads: a **read-only catalog** that can never
install as a side effect, pi's **package identity rule** for the host-wide package switch, and the
install / remove / update / toggle mutations in pi's own settings format. Installing and resolving
stay pi's (`DefaultPackageManager`); this module never spawns npm or git itself.

## pi facts (`@earendil-works/pi-coding-agent`, the catalog-pinned version)

- `DefaultPackageManager.resolve(onMissing)` installs a declared-but-missing npm/git package unless
  `onMissing` answers `skip`; `DefaultResourceLoader.reload()` always calls `resolve()` **without**
  `onMissing`. So a read must either pass `skip` or hand the loader settings that declare no packages.
- `resolve()` output provenance: a package resource is `{ origin: "package", source: <declared string>,
  scope, packageRoot }`; an auto-discovered `<agentDir>/extensions` or `.pi/extensions` file is
  `{ origin: "top-level", source: "auto", baseDir }`; an explicit `extensions[]` settings entry is
  `{ origin: "top-level", source: "local" }`; a built-in is path `builtin:<name>` with `source: "builtin"`.
  Project-scope resources appear only when the settings manager is project-trusted.
- `getPackageIdentity` is private: npm by name, git by `host/path` without ref, local by resolved path.
  `identity.ts` is its port; it keys only ThinkRail's own `disabledPackages`, never a pi settings write.
- A loaded `Extension` carries no name or description — only `path`, `tools`, `commands`; the only
  human-readable metadata is a package's `package.json`.

## What's here

- `catalog.ts` — `listPiPackageCatalog(options)`: rows are seeded from `listConfiguredPackages()` — every
  declaration whose install is **on disk**, so a package that contributes nothing still has a row with
  Remove, and a user declaration pi deduplicates behind the repository's same-identity declaration stays
  a row marked `shadowed` — then `resolve(async () => "skip")` attaches each resource to its declaration
  and yields the loose extensions and the host-supplied built-ins; the Central artifact path is excluded
  like the session loader excludes it. `singleFile` marks a local source that is one extension file: pi
  loads it whole and ignores filters, so it gets no per-resource switches. Tool and command names and
  load errors come from a `DefaultResourceLoader` over exactly the **enabled** extension file paths with
  `SettingsManager.inMemory({})` (nothing to install), `noExtensions` (only those paths load), and
  every other resource kind off — enabled factories run, as at every chat start; disabled code never
  runs for chips, and a file's factory runs once per content change (a memo keyed by mtime). The
  catalog cache is long-lived because every change path invalidates it explicitly
  (`invalidatePiPackageCatalog()`); `listPiPackageRevealTargets` validates a reveal path from the same
  reads without executing any extension. Before a probe runs, `advancePiExtensionCache` (an empty
  loader reloaded twice — pi clears its process-wide factory cache only on a loaded loader's reload,
  and exports no clearer) makes it read the files as they are now, so an update's new names show
  without waiting for a chat to reload; `invalidatePiPackageCatalog()` drops the memo too and bumps a
  generation a probe that was already running cannot write into, so the memo only spares unchanged
  files across workspaces and TTL expiry. What a probe cannot see is what a chat reload cannot see
  either: under Bun's native import (the source and CLI runtimes; the desktop bundle forces jiti's
  transform) a module an extension *imports* is cached process-wide, so a change to a helper outside
  the manifest's globs shows after a restart — the chips match the next chat, which is their contract. Known limitation: a probe loader is
  never sent `session_shutdown`, so a factory that allocates at registration time (a watcher, a timer) leaks once
  per content change of its file — pi's contract for a factory is to register, not to allocate. `packageSourceIdentity(source, scope, cwd, agentDir)`
  resolves a local source against the settings file that declares it (user → `agentDir`, project →
  `<cwd>/.pi`), as pi does.
- `settingsView.ts` — `withPackageDeclarations(settings, keep)`: patches one `SettingsManager`'s
  `getGlobalSettings` / `getProjectSettings` to drop the declarations `keep` rejects (once per instance;
  re-evaluated per read). `withoutPackages` drops them all — for a loader that resolves nothing from
  packages (the boot runtime, the extension-cache advance, the MCP sign-in probe, alias discovery), so
  pi's resolve-time install never runs there. `agent/extensions.ts` builds the disabled-set view on it.
- `extensionCache.ts` — `advancePiExtensionCache(agentDir)`, shared by the boot runtime and the catalog probe.
- `identity.ts` — `piPackageSourceKind` (npm by `npm:`; git only by `git:` or a `scheme://` URL — pi
  treats `git@host:…` and `github:…` as local paths, so does this), `piPackageIdentity` (a simplified
  port of pi's git parsing, no `hosted-git-info`, splitting the ref at the first `@`/`#` inside the
  repository path so a `feature/x` branch keeps the identity — good enough for a ThinkRail-only key,
  never written into pi settings), the shared `settingsBaseDir`, `resolveLocalSource` (pi's
  `resolvePath` rule for a local source — trim, `~`, a `file://` URL decoded, then the base dir — used
  alike by the identity, the install input and the declared-source mutations, so `file:///x` installs,
  lists and removes as `/x`) and `isOfflineMode` (pi's `PI_OFFLINE` rule, which pi does not export). Changing a declared source's version or ref keeps the identity;
  renaming a local folder makes a new one (the old switch entry becomes inert, like an unknown
  `disabledExtensions` name).
- `mutations.ts` — every write validates `scope` / `type` at the boundary (the wire carries no runtime
  schema; an unknown type would otherwise fall through to pi's prompts setter), is serialized through
  one module queue (pi's `SettingsManager` merges only modified fields, but two instances racing on one
  field would still lose one), and ends in `flush()` + `drainErrors()` → `PACKAGE_SETTINGS_WRITE_FAILED`
  (pi's setters only enqueue; a failed write is otherwise swallowed; load errors recorded when the
  settings were opened or reloaded are drained first so another scope's malformed file is not reported
  as this write's failure). `onPersisted(settingsPath)` fires right after each successful persist so
  the packages layer primes its watcher before any further disk work. `installPiPackage` is
  `install()` → fresh trust check for a project scope → `settings.reload()` (an npm install can take
  minutes; an outside edit of `packages` meanwhile must survive) → `addSourceToSettings()` → persist,
  **not** `installAndPersist`, which persists before the caller can re-check anything. The input is first
  read with [[module-contracts]]' `parsePiPackageInput` (gallery / npm links, pasted `pi install`
  lines and bare npm names → `npm:…`), the same function the dialog echoes with; a bare name that is
  also a folder or file next to the workspace installs that path instead, as `pi install name` would. A relative
  local source is the user's *input* and reads like `pi install ./tools` from the workspace (`cwd`, else
  the agent dir); it must exist (pi would happily declare a missing path), and the same absolute path is
  installed, declared (pi stores it relative to the settings file) and turned into the identity.
  npm/git are refused offline (`PACKAGE_OFFLINE`), local is not. `removePiPackage` removes the
  declaration and persists **before** `remove()` touches disk, aborting on a write error, so a resolve
  that starts afterwards cannot re-install it. `updatePiPackages(targets)` runs pi's `update(source)` per target —
  which reconciles every declaration of that identity at both scopes — or pi's batched `update()` once
  when the targets cover every installed declaration (Update all), so npm runs once per scope;
  `checkPiPackageUpdates` wraps `checkForAvailableUpdates()` (no target version, pinned npm never
  reported) behind a five-minute cache that `force` bypasses for the manual check. `setPiResourceEnabled`
  re-resolves, finds the resource by path and scope, and writes pi's format: a top-level resource →
  `±<path relative to its base dir>` in the scope's array of that kind (a plain explicit entry stays
  beside its override — pi's TUI replaces it, after which the file is no longer discovered and cannot be
  switched back on); a built-in → `±builtin:<name>` in the scope that decides it; a package resource →
  `togglePackageFilter` on its declaration's object form, which leaves pi's filter semantics
  (`undefined` = everything, `[]` = nothing, plain entries form an allowlist, `!` excludes, `±path` are
  exact overrides that beat everything before them) to pi: it replaces only this resource's own exact
  `±` override and appends the new one, never touching plain, glob or `!` entries — a disabled allowlist
  member becomes `["a", "-a"]`, not an allowlist without `a` (which would admit every sibling). The
  two baselines are the only special cases: enabling from `undefined` changes nothing and enabling
  from `[]` writes `[path]`; otherwise the explicit `+path` stays even as the only entry, because under
  an `autoload: false` declaration (or a user-scope `[]` the repository overrides) nothing is admitted
  by default. pi's TUI drops plain entries instead, which turns an
  allowlist of one into "everything but one". A single-file local package has no filters pi honours;
  toggling one is refused. **Materializing a string declaration** (`"source"` → `{ source, … }`) is
  itself a semantic change in pi: the string form loads only what a present manifest names, while the
  object form falls back to the convention directory (`extensions/`, `skills/`, …) for every kind the
  filter leaves `undefined`. The first toggle therefore pins every kind the manifest omits but whose
  directory exists to `[]`, so a skill toggle never starts loading an `extensions/` folder the manifest
  never declared (those files then appear as switched-off rows, as in `pi config`). *Rejected:* rewriting the allowlist (first fix) — collapsing its last member
  flips the baseline from "only these" to "everything". **Input vs declared source:** pi stores a local source relative to its settings
  file but matches an *input* source against the process cwd (`getSourceMatchKeyForInput`), so a
  declared `../pkgs/tools` handed back as written is not found; rows carry the declared string and
  `inputSource` hands pi the absolute path for Remove and Update (pinned by a test with a foreign cwd).
  **Load errors are scoped:** pi's `save()` / `saveProjectSettings()` silently skip a scope whose
  file failed to parse, so a mutation refuses up front (`PACKAGE_SETTINGS_WRITE_FAILED`) when the scope
  it writes has a load error — at open and again after the install's reload — and ignores the other
  scope's. **Batched update** runs only when the targets cover every *declaration*, installed or not:
  pi's `update()` also installs a missing one, which must not happen for a package the user did not
  ask about (a disabled one, say). Error codes: `PACKAGE_SOURCE_INVALID`, `PACKAGE_OFFLINE`,
  `PACKAGE_UNTRUSTED`, `PACKAGE_UNKNOWN`, `PACKAGE_INSTALL_FAILED`, `PACKAGE_REMOVE_FAILED`,
  `PACKAGE_UPDATE_FAILED`, `PACKAGE_SETTINGS_WRITE_FAILED`, and `PACKAGE_INSTALLED_UNLISTED` (raised by
  the `piPackages` façade when the declaration is persisted but the row cannot be produced — the
  client must not claim nothing changed); messages carry pi's text and never reach analytics.

## Consumers

`agent/piPackages.ts` orchestrates the catalog and mutations: it adds the agent dir, the Central
exclusion, the host built-ins, the watcher priming and the apply-to-chats step; `host/packages.ts` maps
a `workspaceId` onto a `PiPackagesTarget`. `agent/extensions.ts` builds `withoutDisabledPackages` on
`withPackageDeclarations` + `packageSourceIdentity`; `agent/piRuntime.ts`, `agent/mcpSignIn.ts` and the
alias discovery use `withoutPackages`. Known limitations of the whole feature (concurrent resolves, on-disk changes under a
busy chat) are recorded in [[submodule-server-agent]] beside the orchestration that accepts them.

## Boundary

- **Allowed deps:** `@earendil-works/pi-coding-agent`, `@thinkrail/contracts` (types), Node `fs`/`path`.
- **Allowed deps (cont.):** `@thinkrail/shared/codedError`.
- **Forbidden:** `host`, `settings`, sibling `agent` files (the disabled set, trust, agent dir and
  excluded paths arrive as parameters), spawning npm/git directly (pi's package manager does).
