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
- `./web`, `./resources`, `./ui/<m>` for `attention-line`, `button`, `dialog`, `fonts`, `keyboard`,
  `textarea`, `theme`, `utils` — **type declarations** of the shared set. At runtime these specifiers are
  the app's own modules on `globalThis.__thinkrailExtensionHost = { api, modules }`, keyed by exactly these
  specifiers plus `react`, `react/jsx-runtime` and `react-dom`. The canonical list, API version and object
  name are `@thinkrail/extension-api/installed`'s ([[module-extension-api]]); shipped code may not import
  that private package, so `src/shared.ts` keeps a runtime copy (`SHARED_SPECIFIERS`,
  `EXTENSION_API_VERSION`, `HOST_OBJECT`) and `tools/shared.test.ts` fails when it differs in a value or
  in order. `./resources` promises
  `FramedResourcePreview`, `ResourcePreview`, `useResourceScope` and `useOptionalResourceHost`, whose
  `ResourceHost` is narrowed to `markdown` (`{ text, className? }`), `openFile` and `openComparison`;
  the two previews' props are the in-repo ones in full (`reveal`, `htmlViewport`, `frameFocus`,
  `sideLabels`, `reviewable`, `onFullscreen` included, their small value types inlined in the façade).
  Each subpath's `default` condition is a generated stub that reads the host object (so a non-SDK bundler
  gets the same runtime error as an SDK build), never code of its own.
- The exact export names per specifier are `assets/shared-modules.json` (also exported as
  `./shared-modules.json`); the props, variants and names in the declarations are the rest of the v1
  promise, together with the implicit contract the installed-extensions section lists (TooltipProvider,
  locale store, portals, `html[data-theme]`, semantic variables and utility names, spacing/radius scales,
  typography classes, Tailwind major and layer order, React major).
- `bin` `thinkrail-extension` — a committed launcher, `bin/thinkrail-extension.js`, importing
  `dist/cli.js`, so a workspace install links it before the SDK is built: `thinkrail-extension build
  [--prefix <a-z>] [--entry <file>] [--css <file>] [--cwd <dir>] [--no-minify]`. Exit codes: 0 on
  success and for `--help` / `-h` (usage on stdout), 1 when the build fails (`thinkrail-extension:
  <message>`, no stack), 2 on a usage error — an unknown command, option or extra argument, or a
  missing option value — with the message and the usage on stderr. Also `./theme.css`
  (the theme file) and `assets/extension.css` (the stylesheet template).
- Versioning: the package's `major.minor` is the extension API it builds (`EXTENSION_API_VERSION` in
  `src/shared.ts`); patch releases change no promise. The first changeset is a major bump from `0.0.0`
  to `1.0.0`.

## The build command

- Reads `package.json` from `--cwd` (default: the current folder) and validates the `thinkrail`
  manifest with a copy of the host's rules ([[module-extension-api]] `./installed`), held to them by the
  shared manifest cases (`tools/manifestCases.test.ts`). It is stricter in one way only: `api` must
  **equal** the SDK's API (a bundle can only promise the names the SDK knew). Beyond the manifest it
  checks the package: the `server` file present and pi packages / `typebox` never in `dependencies`
  (they must be peers), with or without a server half — a web-only package would install a second pi
  for nothing. Warnings: a missing keyword, a missing SDK dependency for a server half, unknown
  manifest keys and an `image` that is not an `https://` URL (the catalog does not show it). A
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
  is not supported in v1), any other `react` / `react-dom` subpath, `./server` and unknown SDK subpaths,
  the private `@thinkrail/ui|extension-api|resource-renderers` names (pointing at the SDK specifier), and
  CSS imported from JavaScript.
- A bundle imports nothing, since the app loads it as one file and a browser cannot resolve a bare
  specifier. Every other bare specifier is resolved through rolldown first: one that does not resolve is
  a build error naming it and its importer (install it or remove the import) instead of rolldown's
  `UNRESOLVED_IMPORT` warning and a kept import. A Node built-in is external without side effects, so
  one only unused code imports is dropped. Then the output is parsed and any import left — a used
  built-in or anything another path leaves — fails the build before it is written.
- The stylesheet: when the manifest declares `styles`, `--prefix` (lowercase letters, Tailwind's rule) is
  **required** — there is no default, because the author writes it into every class. The template's
  Tailwind and theme imports are rewritten to absolute paths inside the SDK (the extension need not
  resolve `tailwindcss` itself), `@source` is the entry's folder, `--css` appends the author's file, and
  `@tailwindcss/node` + `@tailwindcss/oxide` compile and lightningcss minifies. The output holds only the
  prefixed utilities, pointing at the app's runtime variables. The app's `tr-*` typography classes are
  used unprefixed and come from the app's sheet.

## Generated assets and how they stay in step

- `assets/shared-modules.json` — `tools/generate.ts` imports each specifier's in-repo module
  (`tools/sources.ts`) under `NODE_ENV=production` and lists its value exports; `./resources` is the
  picked subset `FramedResourcePreview`, `ResourcePreview`, `useOptionalResourceHost`,
  `useResourceScope`. `tools/generate.test.ts` reruns it and fails on drift.
- `assets/thinkrail-theme.css` — the app's `@theme` blocks from `apps/web/src/styles` and `index.css`
  (comments stripped, radius rewritten from `static` to `inline`) plus its `@custom-variant`s; the same
  test rebuilds it from the app's sources at test time.
- Declarations (`tools/build.ts`, also `prepack`, output `dist/`, never committed): tsgo emits from the
  in-repo sources (`tsconfig.dts.json`) and rolldown-plugin-dts bundles them, inlining third-party and
  private types and keeping React (and, for `./server`, pi) external. `@thinkrail/locales` is replaced by
  a stub — `Translator` is a plain string function, since an installed extension's text is its own.
  `./resources` is a curated façade (`src/types/resources.ts`): bundling the real package dragged monaco
  and hast globals into authors' programs, and v1 promises only the tab actions and markdown of
  `ResourceHost`. `src/types/conformance.ts` type-checks the forked `./server` and `./resources` types
  against the in-repo sources (mutual assignability and equal key sets, per union variant). The build
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
  stylesheet, runtime check and rejections, the CLI, asset drift, the runtime constants' drift from
  `extension-api/installed`; `typecheck`, including the conformance types.
- `bun run check:extension-packages` (`scripts/check-extension-packages.ts`, CI job `pi-packages`) — packs
  the SDK and the samples with `bun pm pack`, checks each tarball (no tests or repository sources, no
  `workspace:` / `catalog:` versions, no Bun-only API in shipped JavaScript, every `bin` / `exports` /
  manifest path present, a sample pinned to this SDK version without pi or typebox as dependencies), then
  writes a tiny extension into a temp folder **outside the repository** that uses every shared module,
  installs the tarballs and the catalog's React, types, pi and typebox there with npm, type-checks it
  with the catalog TypeScript and TypeScript 5.9, builds it under Node and under Bun (identical output),
  asserts each bundle — the sample's packed one too — has no React or UI-kit code, loads inside a fake
  1.0 host and refuses a missing host and another major, that each stylesheet holds only its prefix's
  utilities, and that each server half imports to a descriptor under Bun.
