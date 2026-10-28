---
id: submodule-server-agent-packages
type: submodule-design
status: draft
title: "agent/packages — pi packages: read-only catalog, identity, mutations"
parent: submodule-server-agent
depends-on: [module-contracts]
references: [pi-compatibility]
tags: [pi, extensions]
---

## Responsibility

What ThinkRail owns around pi's package manager so Settings → Extensions can list and manage the pi
packages, loose extension files and built-ins a chat loads: a **read-only catalog** that can never
install as a side effect, pi's **package identity rule** for the host-wide package switch, and (next)
the install / remove / update / toggle mutations in pi's own settings format. Installing and resolving
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

- `catalog.ts` — `listPiPackageCatalog(options)`: `resolve(async () => "skip")` + `listConfiguredPackages()`
  grouped into `PiPackagesCatalog` (packages by `scope + source`, loose extensions, the host-supplied
  built-ins only); the Central artifact path is excluded like the session loader excludes it; a
  package pi deduplicated away (declared at both scopes) is not a row, as in `pi config`. Tool and
  command names and load errors come from a `DefaultResourceLoader` over exactly the **enabled**
  extension file paths with `SettingsManager.inMemory({})` (nothing to install), `noExtensions` (only
  those paths load), and every other resource kind off — enabled factories run, as at every chat start;
  disabled code never runs for chips. Short TTL cache; `invalidatePiPackageCatalog()` is the explicit
  invalidation mutations and reloads call. `packageSourceIdentity(source, scope, cwd, agentDir)`
  resolves a local source against the settings file that declares it (user → `agentDir`, project →
  `<cwd>/.pi`), as pi does.
- `identity.ts` — `piPackageSourceKind` (npm / git / local, pi's prefix rules) and `piPackageIdentity`.
  A simplified port of pi's git parsing (no `hosted-git-info`): good enough for a ThinkRail-only key,
  never written into pi settings. Changing a declared source's version or ref keeps the identity;
  renaming a local folder makes a new one (the old switch entry becomes inert, like an unknown
  `disabledExtensions` name).
- `mutations.ts` — every write, serialized through one module queue (pi's `SettingsManager` merges only
  modified fields, but two instances racing on one field would still lose one), each ending in
  `flush()` + `drainErrors()` → `PACKAGE_SETTINGS_WRITE_FAILED` (pi's setters only enqueue; a failed
  write is otherwise swallowed). `installPiPackage` is `install()` → fresh trust check for a project
  scope → `addSourceToSettings()` → persist, **not** `installAndPersist`, which persists before the
  caller can re-check anything; a local source must exist (pi would happily declare a missing path);
  npm/git are refused offline (`PACKAGE_OFFLINE`), local is not. `removePiPackage` removes the
  declaration and persists **before** `remove()` touches disk, aborting on a write error, so a resolve
  that starts afterwards cannot re-install it. `updatePiPackages(sources)` runs pi's `update(source)`,
  which reconciles every declaration of that identity at both scopes; `checkPiPackageUpdates` wraps
  `checkForAvailableUpdates()` (no target version, pinned npm never reported) behind a five-minute
  cache. `setPiResourceEnabled` re-resolves, finds the resource by path and scope, and writes `pi
  config`'s format: a package resource → `±<path relative to the package root>` on its declaration's
  object form; a top-level resource → `±<path relative to its base dir>` in the scope's array of that
  kind; a built-in → `±builtin:<name>`. One deliberate difference from pi's TUI: a plain explicit entry
  stays beside its override — pi replaces it, after which the file is no longer discovered and cannot be
  switched back on. **Input vs declared source:** pi stores a local source relative to its settings
  file but matches an *input* source against the process cwd (`getSourceMatchKeyForInput`), so a
  declared `../pkgs/tools` handed back as written is not found; rows carry the declared string and
  `inputSource` hands pi the absolute path for Remove and Update (pinned by a test with a foreign cwd).
  Error codes: `PACKAGE_SOURCE_INVALID`, `PACKAGE_OFFLINE`, `PACKAGE_UNTRUSTED`, `PACKAGE_UNKNOWN`,
  `PACKAGE_INSTALL_FAILED`, `PACKAGE_NOTHING_LOADABLE` (installed, but pi finds nothing to load — raised
  by the `piPackages` façade), `PACKAGE_REMOVE_FAILED`, `PACKAGE_UPDATE_FAILED`,
  `PACKAGE_SETTINGS_WRITE_FAILED`; messages carry pi's text and never reach analytics.

## Consumers

`agent/piPackages.ts` is the only caller: it adds the agent dir, the Central exclusion, the host
built-ins and the apply-to-chats step, and `host/packages.ts` maps a `workspaceId` onto a
`PiPackagesTarget`. Known limitations of the whole feature (concurrent resolves, on-disk changes under a
busy chat) are recorded in [[submodule-server-agent]] beside the orchestration that accepts them.

## Boundary

- **Allowed deps:** `@earendil-works/pi-coding-agent`, `@thinkrail/contracts` (types), Node `fs`/`path`.
- **Allowed deps (cont.):** `@thinkrail/shared/codedError`.
- **Forbidden:** `host`, `settings`, sibling `agent` files (the disabled set, trust, agent dir and
  excluded paths arrive as parameters), spawning npm/git directly (pi's package manager does).
