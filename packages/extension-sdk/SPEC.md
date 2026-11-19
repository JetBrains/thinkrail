---
id: module-extension-sdk
type: module-design
status: draft
title: Published extension SDK (@thinkrail/extension-sdk)
parent: architecture
depends-on: [module-extension-api, module-ui, module-resource-renderers, module-contracts]
references: [module-thinkrail-extensions, module-pi-extensions, module-extension-examples]
tags: [extensions, sdk, publishing]
---

## Responsibility

The one published package an outside author builds a ThinkRail extension with — the "SDK" of
[[module-thinkrail-extensions]] § Installed extensions. It carries extension API **1.0**: the server and
web contracts, type declarations for the modules the app shares with extension web halves, the
`thinkrail-extension build` command, the manifest of shared export names and the theme file. It is the
published face of the private `extension-api`, `ui` and `resource-renderers` packages, which stay
private and unchanged. It imports no pi value at runtime.

## Public surface (what API v1 promises)

- `./server` — `defineServerExtension` (identity) and `ServerExtension`, `ExtensionSessionServices`,
  `WorkspaceFiles`, `ExtensionSetting` / `ExtensionBooleanSetting` (`{ type: "boolean", default, title?,
  description? }` — an installed extension's setting carries its own, untranslated copy), `InteractiveTool`,
  `ArtifactTool`, `ToolResponse`. Runtime is `dist/server.js`; pi types come from the optional peer
  `@earendil-works/pi-coding-agent`.
- `./web`, `./resources`, `./ui/button`, `./ui/theme`, `./ui/utils` — **type declarations** of the
  shared set. At runtime these specifiers are the app's own modules on
  `globalThis.__thinkrailExtensionHost = { api, modules }`, keyed by exactly these specifiers plus
  `react`, `react/jsx-runtime` and `react-dom`, each holding only its allow-listed names. The canonical
  list, the allow-list (`SHARED_MODULE_EXPORTS`), the API version and the object name are
  `@thinkrail/extension-api/installed`'s ([[module-extension-api]]); shipped code may not import that
  private package, so `src/shared.ts` keeps a runtime copy (`SHARED_SPECIFIERS`,
  `EXTENSION_API_VERSION`, `HOST_OBJECT`) and `tools/shared.test.ts` fails when it differs in a value or
  in order.
- `./web` is **the installed-extension contract**, narrower than the built-ins' `extension-api/web`: a
  `WebExtension` of `{ name, toolRenderers }` (both required — the app's loader rejects a web half
  without `toolRenderers`), each entry a `renderer: ToolRenderer` and optional `options:
  ToolRegistrationOptions` (`summary`, `chrome`, `prominence`, `width`, `defaultExpanded`,
  `interactive`, `dock`, `composerSuggestions` — every option the app applies to an installed
  renderer). `defineWebExtension<T>(extension: T & Record<Exclude<keyof T, keyof WebExtension>,
  never>): T` rejects any other top-level key at compile time. Also `ToolRenderProps`, `ToolRenderer`,
  `ToolStatus`, `ToolInteraction`, `ToolInteractionState`, `ToolPlacement`, `ToolSummary`,
  `ToolChrome`, `ToolProminence`, `ToolWidth`, `ComposerSuggestionsReader` and the helpers `strArg`,
  `numArg`, `resultText`. The built-in-only fields and their types (`title`, `description`,
  `globalOverlay`, `commands`, `shortcuts`, `GlobalOverlayProps`, `ExtensionCommand`, `ExtensionChord`,
  `ExtensionShortcut`, `ExtensionShortcutKey`, `MessageKey`) and the dropped helpers
  (`languageFromPath`, `parseToolResultContent`, `toolValueText`, `ParsedToolResultContent`) do not
  appear in the generated declarations at all: `src/types/web.ts` is a curated façade re-exporting
  named members, never `export *`, and so are `src/types/ui/*.ts`.
- `./resources` promises `FramedResourcePreview`, `ResourcePreview`, `useResourceScope` and
  `useOptionalResourceHost`, whose `ResourceHost` is narrowed to `markdown` (`{ text, className? }`),
  `openFile` and `openComparison`; the two previews' props are the in-repo ones in full (`reveal`,
  `htmlViewport`, `frameFocus`, `sideLabels`, `reviewable`, `onFullscreen` included, their small value
  types inlined in the façade). `./ui/button` promises `Button`, `IconButton`, `withIconClass` and their
  prop / variant types; `./ui/theme` `onThemeSwap`; `./ui/utils` `cn`.
- Each subpath's `default` condition is a generated stub that reads the host object (so a non-SDK
  bundler gets the same runtime error as an SDK build), never code of its own.
- The exact export names per specifier are the allow-list, generated into `assets/shared-modules.json`
  (also exported as `./shared-modules.json`); the props, variants and names in the declarations are the
  rest of the v1 promise, together with the implicit contract the installed-extensions section lists
  (TooltipProvider, locale store, portals, `html[data-theme]`, semantic variables and utility names,
  spacing/radius scales, typography classes, Tailwind major and layer order, React major).
  `src/types/conformance.ts` holds each façade's value exports equal to its allow-list entry, the
  narrowed `WebExtension` assignable to the built-ins' with exactly the built-in-only keys removed, and
  `ToolRegistrationOptions` / `ToolRenderProps` equal to the in-repo ones.
- `bin` `thinkrail-extension` — a committed launcher, `bin/thinkrail-extension.js`, importing
  `dist/cli.js`, so a workspace install links it before the SDK is built: `thinkrail-extension build
  [--prefix <a-z>] [--entry <file>] [--css <file>] [--cwd <dir>] [--no-minify]`. Exit codes: 0 on
  success and for `--help` / `-h` (usage on stdout), 1 when the build fails (`thinkrail-extension:
  <message>`, no stack), 2 on a usage error — an unknown command, option or extra argument, a
  missing option value, or an output path that collides with an input (§ The build command) — with
  the message and the usage on stderr. Also `./theme.css`
  (the theme file) and `assets/extension.css` (the stylesheet template).
- Versioning: the package's `major.minor` is the extension API it builds (`EXTENSION_API_VERSION` in
  `src/shared.ts`); patch releases change no promise, so an extension depends on `~<major.minor>.0`
  (`~1.0.0`) — a caret range would take a later minor whose build stamps a newer `api` an older app
  refuses. The first changeset is a major bump from `0.0.0` to `1.0.0`. Enforced twice from one
  rule, `tools/version.ts` (`versionMismatch`): `tools/shared.test.ts` fails when `package.json`'s
  `major.minor` differs from `EXTENSION_API_VERSION`, and `check:extension-packages` fails when the
  packed SDK's version differs from the `api` of its packed `shared-modules.json` or when a README or
  the agent skill documents any SDK
  range but `~<api>.0`. The one exemption is the unreleased `0.0.0`.

## The build command

- Reads `package.json` from `--cwd` (default: the current folder) and validates the `thinkrail`
  manifest with a copy of the host's rules ([[module-extension-api]] `./installed`), held to them by the
  shared manifest cases (`tools/manifestCases.test.ts`). It is stricter in one way only: `api` must
  **equal** the SDK's API (a bundle can only promise the names the SDK knew). Beyond the manifest it
  checks the package: the `server` file present and pi packages / `typebox` never in `dependencies`
  (they must be peers), with or without a server half — a web-only package would install a second pi
  for nothing. Warnings: a missing keyword, a missing SDK dependency for a server half, unknown
  manifest keys and any `image` — still valid, but neither the showcase nor ThinkRail shows preview images
  ([[module-thinkrail-extensions]] § Catalog). A
  server-only extension has nothing to build.
- **Bundler: rolldown** (a dependency of the SDK, the same version Vite 8 brings to the app). It runs
  under Node and Bun, so the command does too; the spike's `Bun.build` was rejected because an outside
  author may not have Bun, and the Bun 1.4.2 bare-`react` CJS-wrapping bug is Bun-only (the virtual ids
  keep a `\0thinkrail-host:` prefix anyway). The entry is `web/index.tsx` / `web/index.ts` or
  `--entry`; the output is the manifest's `web`, one minified ESM file (`codeSplitting: false`), JSX
  pinned to the automatic production runtime, `process.env.NODE_ENV` defined as production, tsconfig
  ignored.
- Every shared specifier — also when imported from inside `node_modules` — resolves to a generated
  module that imports one runtime check (host object present, `api` major equal, else a thrown error
  naming both versions) and re-exports the manifest's names (`default` too for the three React
  specifiers). Re-exporting every listed name costs about 1 KB per bundle, because rolldown keeps
  property reads; narrowing to the names an extension imports is a deferred optimisation. `react/jsx-dev-runtime` maps onto the production `jsx`. Rejected with a hint, naming the
  importer: `react-dom/client`, `react/compiler-runtime` / `react-compiler-runtime` (the React Compiler
  is not supported in v1), any other `react` / `react-dom` subpath, `./server` and unknown SDK subpaths
  (an unshared `./ui/*` one — dialog, textarea, … — says the extension brings its own and names the shared
  UI modules), the private `@thinkrail/ui|extension-api|resource-renderers` names (the hint derives from
  `SHARED_SPECIFIERS`: the SDK counterpart when it is shared, else that counterpart's own rejection, else
  the shared SDK modules), and CSS imported from JavaScript.
- **Names outside the allow-list.** A named import (or re-export) of a name a shared specifier does not
  export fails the build with the name, the specifier, its importer, the API version and the specifier's
  names — from rolldown's `MISSING_EXPORT`, inside `node_modules` too, since such an import is an ESM link
  error anyway. A namespace member read statically (`React.someName`) that is not exported is rolldown's
  `IMPORT_IS_UNDEFINED`: the same error in the extension's own code, a warning (`It is undefined at
  runtime.`) when a dependency reads it, because a dependency may be feature-detecting. A default import
  or a computed member (`React[name]`) is not checked: the default export is the host's module object,
  which holds only the allow-listed names, so anything else reads `undefined`. Both texts are parsed from
  the pinned rolldown's messages (ANSI stripped); `src/builder/build.test.ts` fails if they change.
- A bundle imports nothing, since the app loads it as one file and a browser cannot resolve a bare
  specifier. Every other bare specifier is resolved through rolldown first: one that does not resolve is
  a build error naming it and its importer (install it or remove the import) instead of rolldown's
  `UNRESOLVED_IMPORT` warning and a kept import. A Node built-in is external without side effects, so
  one only unused code imports is dropped. Then the output is parsed and any import left — a used
  built-in or anything another path leaves — fails the build before it is written.
- **Outputs never touch inputs.** Before anything is removed or written, every path is resolved —
  the web entry (`--entry` or the default), `--css`, the manifest's `server` file, `package.json`, and
  the `web` / `styles` outputs — through `realpath` (for an output, of its deepest existing ancestor,
  so a symlinked folder or a link to an input counts), compared case-insensitively when the package's
  file system is (`PACKAGE.JSON` names the same inode as `package.json`). An output that equals, or is
  an ancestor or descendant of, an input or the other output, that is an existing directory, or that
  resolves outside the package is an `ExtensionUsageError` (exit 2) naming both paths, and nothing is
  written. The manifest already keeps paths inside the package and distinct by suffix; the check
  catches what that cannot — `--entry` / `--css` / `server` equal to an output, links and case. The
  same check runs again after building, before any rename, against every module rolldown loaded
  (`this.getModuleIds()` in `generateBundle`, tree-shaken ones included — a chunk's `moduleIds` omit
  them) and every stylesheet Tailwind read (`onDependency`), since those are known only then.
- **Atomic outputs.** The bundle and the stylesheet are written to hidden temporary files beside their
  targets (`.<name>.<pid>-<random>.tmp`) and renamed over them only when both have built; on any
  failure the temporaries are removed and the previous `web` / `styles` stay as they were, never
  half-written and never deleted. The CLI also removes them on `SIGINT` / `SIGTERM` before re-raising
  the signal (`discardStagedOutputs`), so an interrupted build leaves nothing in `dist/` to be
  published.
- The stylesheet: when the manifest declares `styles`, `--prefix` (lowercase letters, Tailwind's rule) is
  **required** — there is no default, because the author writes it into every class. The template's
  Tailwind and theme imports are rewritten to absolute paths inside the SDK (the extension need not
  resolve `tailwindcss` itself), `@source` is the entry's folder, `--css` appends the author's file, and
  `@tailwindcss/node` + `@tailwindcss/oxide` compile and lightningcss minifies. The output holds only the
  prefixed utilities, pointing at the app's runtime variables. The app's `tr-*` typography classes are
  used unprefixed and come from the app's sheet.

## Frozen API snapshots

`api/<major>.<minor>.api.md` is the committed surface of one extension API version: the allow-list as
JSON and every generated declaration file (`dist/**/*.d.ts` — `./server`, `./web`, `./resources`,
`./ui/*` and their shared chunks, whose names carry no hash so the text is stable), rendered by
`tools/apiSnapshot.ts` (`bun run api:snapshot`). The declaration text is the type digest: it is what an
author's compiler reads, and rolldown-plugin-dts and tsgo are pinned, so it changes only when the surface
or the pinned toolchain does. `tools/apiSnapshot.test.ts` builds the SDK into a temporary folder and
fails on **any** difference from the snapshot of the current `EXTENSION_API_VERSION`, with a message
that a removal or change needs a new API major, an addition a minor bump of `EXTENSION_API_VERSION`
(in `extension-api` and `src/shared.ts`) and a new snapshot, and that the old one stays. A missing
snapshot fails too, and every name an earlier minor of the same major promised — each runtime export
and each name an entry's `.d.ts` declares or exports (`lostSince`; shared chunks excepted) — must still
be there, so a minor can add but never remove even when its own snapshot is written fresh. A change
*inside* a kept type across minors is left to review of the new snapshot's diff.
`bun run api:snapshot` writes a snapshot only when the file is absent; `--rewrite` replaces one, which is
legitimate only while that API is unreleased (the SDK is still `0.0.0`, as for 1.0 today) or for a
reprint-only toolchain diff; `--print` shows the current surface. The snapshot is not shipped.

## Generated assets and how they stay in step

- `assets/shared-modules.json` — `tools/generate.ts` writes `SHARED_MODULE_EXPORTS`, after importing
  each specifier's in-repo module (`tools/sources.ts`) under `NODE_ENV=production` and failing if any
  allow-listed name is missing from it. The three React specifiers promise React's whole stable public
  API, so for them it also fails on a public export the list neither holds nor leaves out
  (`WHOLE_PUBLIC_API_EXCEPT`: `react-dom`'s deprecated `useFormState`; `default`, `__*`, `unstable_*`
  and `experimental_*` never count) — a React upgrade that adds a name is a decision (an API minor or an
  exception), not a silent gap. What a module exports beyond the list never reaches the manifest, the
  stubs or the host. `tools/generate.test.ts` reruns it and fails on drift, and checks the
  manifest equals the allow-list and the package's `exports` are exactly the SDK specifiers plus
  `./server`, `./shared-modules.json`, `./theme.css` and `./package.json`.
- `assets/thinkrail-theme.css` — the app's `@theme` blocks from `apps/web/src/styles` and `index.css`
  (comments stripped, radius rewritten from `static` to `inline`) plus its `@custom-variant`s; the same
  test rebuilds it from the app's sources at test time.
- Declarations (`tools/build.ts`, also `prepack`, output `dist/`, never committed): tsgo emits from the
  in-repo sources (`tsconfig.dts.json`) and rolldown-plugin-dts bundles them, inlining third-party and
  private types and keeping React (and, for `./server`, pi) external. `@thinkrail/locales` is replaced by
  a stub — `Translator` is a plain string function, since an installed extension's text is its own.
  Every type entry is a curated façade naming its members (§ Public surface): `./resources`
  (`src/types/resources.ts`) even forks its types, because bundling the real package dragged monaco and
  hast globals into authors' programs and v1 promises only the tab actions and markdown of
  `ResourceHost`; `./web` and `./ui/*` re-export named members of the in-repo modules.
  `src/types/conformance.ts` type-checks the forked `./server` and `./resources` types against the
  in-repo sources (mutual assignability and equal key sets, per union variant), each façade's value
  exports against the allow-list, and the narrowed `./web` contract against the built-ins' one. The build
  fails if any output imports a private `@thinkrail/*` package, declares globals or keeps a triple-slash
  reference.

## Boundary

- **Allowed deps:** runtime — `rolldown`, `tailwindcss`, `@tailwindcss/node`, `@tailwindcss/oxide`; peers
  — `@types/react` / `@types/react-dom` 19 and pi, all optional; dev-only, to generate declarations and
  assets — `extension-api`, `ui`, `resource-renderers` (their own `contracts` / `locales` imports resolve
  from them; `tsconfig.dts.json` includes the contracts sources by path), React. Shipped code uses
  `node:` builtins and standard ESM only. The packed manifest still lists the dev dependencies (the
  private ones as `0.0.0`); npm never installs them for a consumer.
- **Forbidden:** importing the host (`server`, `shared`, `apps/*`); a runtime import of any private
  package; pi values. Nothing in `apps/*` or `packages/server` imports the SDK. Enforced by
  `scripts/check-module-boundaries.ts`, which also keeps the shipped sources (`src/**` outside
  `src/types/`, `bin/**`) free of workspace imports.

## Release and verification

Released with the portable pi packages ([[module-pi-extensions]] § Release): `scripts/pi-packages.ts`
lists this package and every public `extension-examples/*` package as publishable (dependencies first, so
the SDK precedes a sample), and `.github/workflows/release-pi-packages.yml` runs the gate below and builds
the SDK before `release:publish`, since a sample's `prepack` builds with the SDK's `dist/`. Each package
needs the manual bootstrap publish (`bun run release:pack extension-sdk`, `… palette`) before Trusted
Publishing can take over. `bun pm pack` runs `prepack` without `node_modules/.bin` on `PATH`, so a sample's
`prepack` is `npm run build`.

Gates:

- `bun test` in the package — manifest validation and the shared manifest cases, the build's bundle,
  stylesheet, runtime check, rejections and path safety, the CLI, asset drift, the runtime constants'
  drift from `extension-api/installed`, the frozen API snapshot and the version coupling; `typecheck`,
  including the conformance types.
- `bun run check:extension-packages` (`scripts/check-extension-packages.ts`, CI job `pi-packages`) — packs
  the SDK and the samples with `bun pm pack`, checks the version coupling (§ Public surface,
  Versioning), checks each tarball (no tests or repository sources, no
  `workspace:` / `catalog:` versions, no Bun-only API in shipped JavaScript, every `bin` / `exports` /
  manifest path present, a sample pinned to this SDK version without pi or typebox as dependencies), then
  writes a tiny extension into a temp folder **outside the repository** that uses every shared module,
  installs the tarballs and the catalog's React, types, pi and typebox there with npm, type-checks it
  with the catalog TypeScript and TypeScript 5.9, builds it under Node and under Bun (identical output),
  asserts each bundle — the sample's packed one too — has no React or UI-kit code, loads inside a fake
  1.0 host and refuses a missing host and another major, that each stylesheet holds only its prefix's
  utilities, and that each server half imports to a descriptor under Bun.
