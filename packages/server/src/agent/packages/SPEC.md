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
  declaration, so a package that contributes nothing still has a row with Remove, a declaration with no
  install on disk is a row without `installedPath` (the UI's **Not installed**: Remove only — pi retries
  the install at a chat's next start, and this row is the only way out of a typo or an offline install
  short of `pi remove`), and a user declaration pi deduplicates behind the repository's same-identity
  declaration stays a row marked `shadowed` — then `resolve(async () => "skip")` attaches each resource to its declaration
  and yields the loose extensions and the host-supplied built-ins; the Central artifact path is excluded
  like the session loader excludes it. **The catalog never executes
  extension code.** Tool and command names and load errors (`extensionInfo.ts`) are what a loader last
  *recorded* for a file: every chat's `buildResourceLoader` reports its `LoadExtensionsResult` through
  `recordLoadedExtensions`, and the install dialog's "Installed" step runs `probeExtensionInfo` once over
  the new package's enabled extension files (in-memory settings, `noExtensions`, the explicit paths —
  nothing to install) because no chat has loaded them yet. The memo is keyed by file and mtime, so a
  changed file loses its chips until the next load records them; a row with no chips is a file no load
  has seen since it changed, not an empty extension. *Rejected:* probing at list time (the first
  implementation) — it ran every enabled extension's factory in the host process, outside any session
  and without `session_shutdown`, on every Settings visit. The catalog's result cache is long-lived
  because every change path invalidates it explicitly (`invalidatePiPackageCatalog()`);
  `listPiPackageRevealTargets` validates a reveal path from the same reads. Before the install probe
  runs, `advancePiExtensionCache` (an empty loader reloaded twice — pi clears its process-wide factory
  cache only on a loaded loader's reload, and exports no clearer) makes it read the files as they are
  now.
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
  re-resolves, finds the resource by path and scope, and writes pi's format for **top-level resources
  only**: a loose file → `±<path relative to its base dir>` in the scope's array of that kind (a plain
  explicit entry stays beside its override — pi's TUI replaces it, after which the file is no longer
  discovered and cannot be switched back on); a built-in → `±builtin:<name>` in the scope that decides
  it. A resource *inside a package* is refused (`PACKAGE_SOURCE_INVALID`): the package switch is the
  control. **Deferred — in-package resource toggles.** The first implementation wrote pi's per-package
  filter arrays; three rounds of review each found a way the written shape changed what pi loads
  (collapsing an allowlist, dropping the only `+path` under `autoload: false`, materialising a string
  declaration into object form, which flips pi's convention-directory fallback) — every one a port of
  private pi behaviour with no public API behind it. They return when pi exposes a per-resource toggle;
  until then the row lists each resource read-only with pi's `enabled` state. **Input vs declared source:** pi stores a local source relative to its settings
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
a `workspaceId` onto a `PiPackagesTarget`. Every other `agent/` module opens pi settings through
`createPiSettings` (`agent/SPEC.md` lists which view each loader gets). Known limitations of the whole feature (concurrent resolves, on-disk changes under a
busy chat) are recorded in [[submodule-server-agent]] beside the orchestration that accepts them.

## Boundary

- **Allowed deps:** `@earendil-works/pi-coding-agent`, `@thinkrail/contracts` (types), Node `fs`/`path`.
- **Allowed deps (cont.):** `@thinkrail/shared/codedError`.
- **Forbidden:** `host`, `settings`, sibling `agent` files (the disabled set, trust, agent dir and
  excluded paths arrive as parameters), spawning npm/git directly (pi's package manager does).
