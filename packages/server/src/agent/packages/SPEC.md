---
id: submodule-server-agent-packages
type: submodule-design
status: draft
title: agent/packages — pi packages: read-only catalog, identity, mutations
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

## Boundary

- **Allowed deps:** `@earendil-works/pi-coding-agent`, `@thinkrail/contracts` (types), Node `fs`/`path`.
- **Forbidden:** `host`, `settings`, sibling `agent` files (the disabled set, trust, agent dir and
  excluded paths arrive as parameters), spawning npm/git.
