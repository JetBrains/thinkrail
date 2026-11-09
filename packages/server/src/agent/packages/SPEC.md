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
packages, loose extension files and built-ins a chat loads: a **read-only catalog** that never installs
and never runs extension code, the **settings views** every pi loader in the host goes through, pi's
**package identity rule** for the host-wide package switch, and the install / remove / update / toggle
mutations in pi's own settings format. Installing and resolving stay pi's (`DefaultPackageManager`);
this module never spawns npm or git itself.

## Invariants

1. **Listing has no side effects.** The catalog resolves with `onMissing → skip` (pi's `resolve()`
   installs a declared-but-missing package otherwise, and `DefaultResourceLoader.reload()` always calls
   it that way) and takes tool/command names from what a loader *recorded*, never from running a factory.
2. **One way to open pi settings.** `createPiSettings` is the only `SettingsManager.create` in the server
   (a unit test scans the sources). Its `packages` view — `all` / `enabled` / `none` — decides which
   declarations pi sees; a view refuses `setPackages` / `setProjectPackages`, so a filtered list is never
   written back.
3. **Writes are pi's format, top-level only.** Loose files and built-ins are toggled with pi's
   `±pattern` / `±builtin:<name>` entries; declarations are added and removed through pi's own
   `addSourceToSettings` / `removeSourceFromSettings`. Nothing inside a package is rewritten (see Deferred).
4. **The identity is ThinkRail's key, never pi's input.** It keys `disabledPackages` and nothing else.

## Files

- `identity.ts` — `piPackageSourceKind` (pi's rule: `npm:` is npm; `git:` or a `scheme://` URL is git;
  everything else, including `git@host:…` and `github:…`, is a path), `piPackageIdentity` (a port of
  pi's private `getPackageIdentity`: npm by name, git by `host/path` with the ref split at the first
  `@`/`#` inside the repository path and pi's hosted shorthands — `github:`, `gitlab:`, `bitbucket:`,
  `sourcehut:` — expanded to their hosts, local by resolved path), `piDeclarationIdentity` (pi's
  equivalence of two declarations — what decides shadowing, deltas and dedupe), `packageSourceIdentity`
  (the **switch key**: the same, except a repository declaration's local source inside the worktree is
  keyed by the repository and the worktree-relative path, `local:project:<main worktree>:tools`, so
  every worktree of the project shares the switch as they share its npm/git declarations while two
  unrelated repositories declaring `./tools` do not; `repositoryRoot` reads a linked worktree's `.git`
  file — `gitdir: …/.git/worktrees/<name>` — back to the main worktree without spawning git, and a
  folder that is no checkout is its own root) and `disabledDeclarationIdentities` (the switch
  set closed over pi's equivalence: when any declaration of a pi identity is switched off, every alias
  is — hiding one must never let pi load the package through another; the `enabled` view and the
  catalog's `enabled` both use it), `resolveLocalSource` (pi's private `resolvePath` for a local
  source: trim, `~`, `file://`, then the base dir), `settingsBaseDir`, `isOfflineMode` (`PI_OFFLINE`).
- `settingsView.ts` — `createPiSettings(cwd, agentDir, { projectTrusted?, packages })` and the
  `disabledPackages` resolver the host sets from its config. `enabled` hides the switched-off
  declarations from `getGlobalSettings` / `getProjectSettings`, re-evaluated per read; `none` hides all.
- `extensionInfo.ts` — the recorded-load memo, keyed by file and mtime: `recordLoadedExtensions` (every
  chat's `buildResourceLoader` reports its `LoadExtensionsResult`), `knownExtensionInfo` (what the
  catalog annotates with), `probeExtensionInfo` (the one deliberate run: the install dialog's "Installed"
  step, over the new package's enabled extension files, through a loader on `SettingsManager.inMemory({})`
  with `noExtensions` and the explicit paths — nothing to install). A changed file loses its chips until
  the next load records them; a row without chips is a file no load has seen, not an empty extension.
  A record that changes what a row would show (`setExtensionInfoListener`) invalidates the catalog's
  result cache and publishes `packages.changed`, without touching the package revision, so an open page
  re-lists after a chat's load and no chat reloads.
- `extensionCache.ts` — `advancePiExtensionCache`: pi clears its process-wide factory cache only on a
  loaded loader's reload and exports no clearer; an empty loader reloaded twice does it. Used before the
  boot runtime and before the install probe. It reaches only pi's map. In a Bun source run (dev,
  `bun test`) jiti imports natively wherever its transform is not forced (the boot runtime forces it), and
  Bun's module registry keeps a path's first evaluation, so a rewritten extension file is seen only at a
  new path; tests give each extension body its own file name. Such a test fails alone but may pass in the
  package run, where an earlier file's dynamic import makes jiti's `moduleCache: false` eviction work
  (Bun 1.4.4). The binary and desktop bundle are unaffected: pi's embedded-modules loader never imports
  natively.
- `catalog.ts` — `listPiPackageCatalog(options)`: rows are seeded from `listConfiguredPackages()`, one per
  declaration — a declaration with no install on disk is a row without `installedPath` (the UI's **Not
  installed**, Remove only: pi retries at a chat's next start, and this row is the only way out of a
  typo or an offline install short of `pi remove`); a user declaration pi deduplicates behind the
  repository's same-identity declaration is marked `shadowed`; a repository `{ source, autoload: false }`
  declaration is pi's *delta* over the user install (both are kept, delta first), so it gets no row and
  its resources land on the user row with their override state. `resolve(async () => "skip")` then
  attaches each resource (`origin: "package"` → its declaration, by source and scope, falling back to the
  same identity), yields loose files (`origin: "top-level"`, `source: "auto"` for a discovered file,
  `"local"` for an explicit `extensions[]` entry) and the host-supplied built-ins, and excludes the Central
  artifact path like the session loader does. Human-readable metadata comes only from a package's
  `package.json` (a loaded `Extension` has no name). The result cache is long-lived because every change
  path calls `invalidatePiPackageCatalog()`. `listPiPackageRevealTargets` validates a reveal path from
  the same reads.
- `mutations.ts` — one module queue (two `SettingsManager`s racing on one field would lose a write);
  every write validates `scope` / `type` at the boundary, is opened on the scope it writes
  (`assertScopeLoaded`: pi's `save()` silently skips a scope whose file failed to parse — only that
  scope's load error blocks, drained so another scope's is not reported as this write's), and ends in
  `flush()` + `drainErrors()` → `PACKAGE_SETTINGS_WRITE_FAILED`, then `onPersisted(settingsPath)` so the
  packages layer primes its watcher before any disk work.
  - `installPiPackage`: `parsePiPackageInput` ([[module-contracts]], the same function the dialog echoes
    with) → a bare name that is also a folder or file next to the workspace installs that path, as
    `pi install name` would → a relative local source resolves against the workspace (else the agent dir)
    and must exist → npm/git refused offline → `install()` → fresh trust re-check → `settings.reload()`
    (an npm install can take minutes; an outside edit must survive) → `addSourceToSettings()` → persist.
    Not `installAndPersist`, which persists before anything can be re-checked. The façade then requires
    the new row to carry `installedPath` (a Not installed row is not a success) before it probes it.
  - `removePiPackage` persists the removal **before** `remove()` touches disk, so a resolve that starts
    meanwhile cannot re-install it. `updatePiPackages(targets)` runs pi's `update(source)` per target, or
    the batched `update()` once only when the targets cover every *declaration* (it would install a
    missing, unrequested one). `checkPiPackageUpdates` caches `checkForAvailableUpdates()` for five
    minutes unless `force`.
  - **Input vs declared source:** pi stores a local source relative to its settings file but matches an
    *input* against the process cwd, so Remove and Update hand pi the absolute path (`declaredAsInput`).
  - `setPiResourceEnabled`: re-resolves, finds the resource by path and scope, writes `±<relative path>`
    into the scope's array of that kind, replacing an existing override of the same file whether it was
    written relative to the scope's base dir or absolute — pi honours both spellings (keeping a plain
    explicit entry beside its override — pi's TUI replaces it, after which the file is no longer
    discovered) or `±builtin:<name>` in the scope that
    decides the built-in; a resource inside a package is refused with `PACKAGE_SOURCE_INVALID`.
  - Error codes: `PACKAGE_SOURCE_INVALID`, `PACKAGE_OFFLINE`, `PACKAGE_UNTRUSTED`, `PACKAGE_UNKNOWN`,
    `PACKAGE_INSTALL_FAILED`, `PACKAGE_REMOVE_FAILED`, `PACKAGE_UPDATE_FAILED`,
    `PACKAGE_SETTINGS_WRITE_FAILED`; `PACKAGE_INSTALLED_UNLISTED` is the façade's (declaration persisted,
    row not produced). Messages carry pi's text and never reach analytics.

## Deferred

**In-package resource toggles.** The first implementation wrote pi's per-package filter arrays; every
shape it produced was a port of private pi behaviour (`applyPatterns`, `collectPackageResources`) and
three review rounds each found one that changed what pi loads — collapsing an allowlist, dropping the
only `+path` under `autoload: false`, materialising a string declaration into object form (which flips
pi's convention-directory fallback). They return when pi exposes a per-resource toggle; until then the
row lists each resource read-only with pi's `enabled` state and the package switch is the control.

## Rejected

- Probing extensions at list time: ran every enabled factory in the host process on each Settings
  visit, outside any session and without `session_shutdown`.
- Keying the switch on resolved file paths (filtering pi's output): pi had already installed the
  package by then, and delegated children bypassed the filter. The settings view hides the declaration
  instead.
- A separate "installing" row or any per-workspace state: installing is the dialog's request; a
  declaration is on wherever it loads.

## Consumers

`agent/piPackages.ts` orchestrates: the agent dir, the Central exclusion, the host built-ins, the watcher
priming, the install-time probe and the apply-to-chats step; `host/packages.ts` maps a `workspaceId`
onto a `PiPackagesTarget`; every other `agent/` module opens pi settings through `createPiSettings`
([[submodule-server-agent]] lists which view each loader gets). The feature's accepted limitations
(concurrent resolves, on-disk changes under a busy chat) live there too.

## Boundary

- **Allowed deps:** `@earendil-works/pi-coding-agent`, `@thinkrail/contracts`,
  `@thinkrail/shared/codedError`, Node `fs` / `path` / `os` / `url`.
- **Forbidden:** `host`, `settings`, sibling `agent` files (trust, the agent dir and excluded paths
  arrive as parameters; the disabled set arrives through `setDisabledPackagesResolver`), spawning npm/git
  directly.
