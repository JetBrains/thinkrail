---
id: submodule-server-extensions-installed
type: submodule-design
status: active
title: extensions/installed — installing and loading ThinkRail extensions at runtime
parent: submodule-server-extensions
depends-on: [module-extension-api, module-contracts]
references: [module-thinkrail-extensions, pi-compatibility, submodule-server-agent-packages, submodule-server-agent]
tags: [extensions, public-surface-checked]
---

## Responsibility

The runtime half of [[module-thinkrail-extensions]] § Installed extensions on the host: the declarations
file, the ThinkRail-owned install root, the descriptor loader and the per-extension state. It hands the
parent registry ([[submodule-server-extensions]]) the loaded server halves and never composes them
itself; it knows nothing of sessions, the catalog or the wire.

## On disk

```
<data dir>/extensions.json                 { "extensions": ["<source>", …] } — the user's and the agent's file
<data dir>/extensions/installs/<id>/       one pi install root per installed version (<id> = time + random)
  npm/node_modules/<name>/…                    where pi's installer puts an npm source
  git/<host>/<path>/…                          and a git source
<data dir>/extensions/installs.json        host-owned: source → { dir: <id>, path: <package root in it> }
<data dir>/extensions/status.json          host-written, read by agents: the outcome of the last reconcile
<data dir>/extensions/host/                shims (removed after each load) and an empty discovery folder
```

A folder source is never copied: it loads from where it is, and nothing under it is written or removed.

## Decisions

- **Sources are pi's syntax, read without pi's settings.** `npm:<spec>`; `git:` or a `scheme://` URL;
  an absolute folder (or `~/…`). Anything else, including a relative path, is a failed row: the file has
  no base directory a relative path could mean. `extensions.json` is read tolerantly — a missing file is
  no extensions, entries are trimmed and deduplicated, other top-level keys survive a host write — and a
  file that does not parse is reported (`fileError()`, logged) while the last good state stays in force.
  The host refuses to rewrite such a file (`EXTENSIONS_FILE_INVALID`) rather than lose the user's text.
- **Install is pi's `DefaultPackageManager.install()`** with `agentDir` and `cwd` set to a fresh
  `installs/<id>` folder and `SettingsManager.inMemory({ npmCommand })` — never the pi agent dir, never
  pi's settings (only the user's pi `npmCommand`, read per install through an injected `NpmCommand`, so a
  user whose npm is a wrapper, a full path or pnpm fetches the same way pi does — kind detection stages
  plain pi packages too, and must not regress them),
  so pi's own loader never sees an extension. Each install (first install, update, re-stage) gets a new
  folder because Bun keeps a module's first evaluation and cached folder listings for the process
  lifetime. After install every `node_modules/@earendil-works` and `node_modules/typebox` under the folder
  is pruned: pi's args already omit peers, and a copy that slips in is what a plain-JavaScript dependency
  would bind to. The installer is an injected `ExtensionInstaller` (tests stub it; nothing in the tests
  touches the network). `PI_OFFLINE` refuses npm/git installs like pi packages; a folder source works
  offline.
- **Reconcile is idempotent and serialized.** One queue runs reconcile, adopt, remove and update; a
  reconcile requested while one is waiting shares it. A pass: drop `installs.json` entries of undeclared
  sources, settle every
  declared source in order — reuse the previous record when its package root and file fingerprint
  (`package.json` plus the manifest's files, mtime and size) are unchanged, so nothing reloads — publish,
  then install the missing npm/git sources one at a time, publishing after each. `onChange` fires only
  when a record changed (records are compared by value; a reused server half keeps its identity), and
  `servers()` is a new array only when the set of loaded server halves changed. A folder source reloads
  when its fingerprint changed at a reconcile, or on `update`. A failed npm/git install is not retried by
  a later reconcile (its failed row is kept): it is retried when the source is declared anew, on
  `update`, or at the next host start. A new declaration has no row until its first install finishes.
- **Install folders are swept once per process**, at its first reconcile: a folder no `installs.json`
  entry names (a removed source, a superseded version, a crash's leftover) is deleted then, never while
  the process may still hold a loader built from it — a chat mid-turn keeps the old factories, their lazy
  imports and skill files until its end-of-turn rebuild. A staged folder of a plain pi package, an
  install that lost its declaration and a failed update's new folder were never loaded and are removed at
  once.
- **Update never loses a working install.** `update` installs into a new folder and evaluates it first;
  only a `loaded` result replaces the old install. An install error,
  an incompatible or failing new version is `PACKAGE_UPDATE_FAILED` with the reason, and the new folder
  is dropped.
- **States.** `loaded`; `incompatible` — `extensionApiMismatch` says why, and it is decided **before any
  extension code runs**; `failed` — the reason text: install error, not an extension source, no or
  invalid manifest (including a built-in's name, from the injected `reservedNames`), a declared file
  missing or resolving outside the package (realpath), a load error, a wrong descriptor shape, a
  descriptor `name` other than the package name (the package name is the identity, and a silent rename
  would surprise the author), an unresolvable `skillPackages` entry, or a name an earlier declaration
  already provides (the first declaration wins once both are installed). A row's `error` is the user's
  to read; the log records which extension failed without the error object, so a third party's bug is
  not a ThinkRail error report.
- **The descriptor shim** (the seam [[pi-compatibility]] registers). The host writes
  `host/shims/<pid>-<n>.ts`, which default-imports the entry by absolute path and also imports
  `createAgentSession` (pi-coding-agent) and `Type` (typebox), and default-exports a function that puts
  all three under a per-load key in a `Symbol.for("thinkrail.extensionDescriptors")` map. It is loaded with
  pi's public `discoverAndLoadExtensions([shim], empty, empty)` — uncached, so an edited entry reloads on
  the same path — inside `withForcedJitiTransform` (`JITI_TRY_NATIVE=false`, `JITI_REBUILD_FS_CACHE=1`,
  restored afterwards; one task at a time, shared with the agent's runtime build). The key is read and
  deleted, the shim removed. **Identity guard:** the shim's `createAgentSession` and `Type` must be the
  host's own (`===`; a jiti namespace is a Proxy, so members are compared, never namespaces), else the load
  fails — the loader proves on every load that the extension resolution yields the host's single pi. The
  descriptor's shape is then validated field by field.
- **Kind detection at install** (`stage`): a folder is read in place; an npm/git source is installed into a
  fresh, pending `installs/<id>` and its `package.json` read. A `thinkrail` key makes it an extension
  (`StagedExtension`); otherwise the folder is removed and `undefined` returned, so the caller installs a
  pi package the usual way — a plain npm/git pi package is therefore fetched twice through the dialog, the
  second time from npm's cache. `adopt` records the install, appends the source to `extensions.json` if
  absent and reconciles; `discard` drops a staged folder.
- **The status file is how an agent learns the outcome** (the `making-thinkrail-extensions` host skill
  reads it): a load failure, an incompatible `api` or a refused `extensions.json` is otherwise visible
  only in Settings and the host log, and an agent has files, not the wire. After every reconcile pass —
  and after each npm/git install inside one — the runtime atomically rewrites `status.json`:

  ```json
  { "api": "1.0", "updatedAt": "<ISO time>", "declarations": "<data dir>/extensions.json",
    "fileError": "<why extensions.json was refused — only then>",
    "extensions": [{ "source": "<as declared>", "name": "…", "version": "…",
                     "state": "loaded | failed | incompatible | installing", "error": "…", "tools": ["…"] }] }
  ```

  One entry per declared source, in declaration order; `installing` is a declared source with no row yet
  (only npm/git), so a failed install keeps its `failed` row. When the file is refused the entries are
  the last good rows. `api` is the host's `EXTENSION_API_VERSION`, so an agent can pick a matching SDK
  before anything is declared — the file is written even with no declarations. `tools` is present for a
  loaded server half: the names its factories register, from the injected `toolNames` (the catalog's
  description, bounded by a 2 s wait and omitted when it fails or times out) — a loaded half whose
  factory throws lists none. `updatedAt` changes on every pass, so an agent that touched
  `extensions.json` knows when its edit was read. The file is a report, never an input; a failed write is
  logged and skipped.
- **The data dir reaches agent sessions** as `THINKRAIL_DATA_DIR`: `createServer` sets it to the resolved
  `dataDir()` in the host's environment, which pi's bash tool and every child inherit (user terminals
  drop `THINKRAIL_*`), so an agent finds `extensions.json` in dev, the CLI and the desktop app alike —
  including a relative override, which would otherwise resolve against the agent's cwd.
- **The agent's path in** is the `making-thinkrail-extensions` host skill ([[submodule-server-agent]]
  stages it), the counterpart of `managing-mcp-servers` editing `mcp.json`: the agent writes a folder
  extension, builds it with the SDK and declares it itself, with no confirmation click. Its decisions:
  - the default folder is `~/thinkrail-extensions/<slug>/` — the user's source code, so never inside a
    workspace (worktrees are deleted), a chat folder or the data dir (`<data dir>/extensions/` is the
    host's, and uninstalling ThinkRail may remove the data dir); package name `thinkrail-ext-<slug>`;
  - `scripts/extensions.mjs` (plain Node, no dependencies) is the one writer it uses: `add` / `reload` /
    `remove` rewrite `extensions.json` atomically with the host's rules (other keys kept, a source
    compared after `~` / `file://` expansion, a file that does not parse refused with exit 2), then wait
    for a newer `status.json`; `add` / `reload` print the entry (exit 0 only for `loaded`), `remove`
    returns once the entry is gone. `reload` touches the
    folder's `package.json`, because a folder reloads only when its fingerprint changes and an edited
    non-entry server file is not in it;
  - installs use `npm install --omit=peer` and an `.npmrc` with `omit=peer`: a plain install pulls pi
    (~190 MB) into a folder the host never prunes;
  - before `@thinkrail/extension-sdk` is on npm the skill detects it (`npm view` → `E404`) and stops
    before writing anything, telling the user; only when the user names a ThinkRail checkout does it
    pack the SDK there. No private registry, nothing vendored into the app;
  - `skillExample.test.ts` keeps the skill's worked example and script honest against this runtime.
- **Web half URLs** (`assets.ts`): `/extensions/<encodeURIComponent(name)>/<version>-<hash>/<file>`,
  `<hash>` the first 12 hex of a sha-256 over the served files' paths, mtimes and sizes, so a changed file
  — a folder source's edit, an update — is a new URL and the route may answer immutable. `webHalfOf`
  gives the URLs only for a `loaded` record with a `web` file. `resolveExtensionAsset(records, pathname)`
  answers only the manifest's `web` or `styles` path of a loaded extension whose current token matches,
  re-checked by realpath to stay inside the package, and names its content type.

## Known limitations

- **A folder source's `node_modules` is never pruned.** It is loaded in place, and the host never writes
  inside it (the npm/git prune does not apply). An author's dev copies of pi and typebox
  (`devDependencies`, installed with peers) are therefore present, and a plain-JavaScript dependency of
  the extension that itself imports pi binds to that copy instead of the host's. TypeScript sources and
  the extension's own entry are unaffected: they go through pi's loader, and the identity guard checks
  the entry's pi. So dev copies are harmless for the usual extension, whose own code is the only thing
  importing pi (the sample keeps them as `devDependencies` for type checking). An author whose
  extension does have such a dependency installs with peers omitted and no pi or typebox
  `devDependencies`, as the `making-thinkrail-extensions` skill always does (`omit=peer` in `.npmrc`,
  peers only).

## Boundary

- **Public surface (barrel):** `InstalledExtensions`, `InstalledExtensionsOptions`,
  `InstalledExtensionRecord`, `InstalledServerExtension`, `StagedExtension`, `installedExtensions`,
  `setInstalledExtensions`, `ExtensionInstaller`, `NpmCommand`, `piExtensionInstaller`, `extensionSourceKind`,
  `ExtensionSourceKind`, `loadServerDescriptor`, `withForcedJitiTransform`, `webHalfOf`, `webToken`,
  `resolveExtensionAsset`, `ExtensionAsset`.
- `InstalledExtensions` is the runtime (`records`, `servers`, `fileError`, `reconcile`, `watch`, `stage`,
  `adopt`, `discard`, `remove`, `update`, `checkUpdates`, `declarationsPath`, `root`);
  `installedExtensions()` is the host's one runtime, absent until the host starts it. The status file's
  schema is `ExtensionsStatus` in `runtime.ts`; the file, not the type, is the contract.
- **Allowed deps:** `@earendil-works/pi-coding-agent` (`DefaultPackageManager`, `SettingsManager`,
  `discoverAndLoadExtensions`, `createAgentSession` for the guard), `typebox` (`Type`, the guard),
  `@thinkrail/extension-api/installed` (the manifest reader), `@thinkrail/extension-api/server` (the
  descriptor types), `@thinkrail/contracts`,
  `@thinkrail/shared/codedError`, `log`, Node `fs` / `path` / `os` / `crypto`.
- **Forbidden:** the parent registry and its siblings (the skill resolver and the reserved names arrive
  as options), `agent`, `host`, `settings`, `persistence` (the data dir arrives as an option), spawning
  npm or git itself, writing inside a folder source or outside `<data dir>/extensions*`.

## Verification

Unit tests over disposable temp folders: the declarations reader, the peer prune, the loader (identity
guard, shim cleanup, env serialization), reconcile (idempotence, malformed file, removal, folder source,
incompatible, every failure mode, duplicates, offline, stub npm installs, update, staging and adoption)
the asset resolver (traversal, unknown extension, wrong file, stale token, links) and the status file
(every state, tools, `installing` during an install, a refused file, no declarations).
`skillExample.test.ts` keeps the host skill's worked example honest: its `package.json` passes the
manifest reader and its server half loads through this loader with the tool it promises.
