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
  `ToolResponse`. Runtime is `dist/server.js`; pi types come from the optional peer
  `@earendil-works/pi-coding-agent`.
- `./web`, `./resources`, `./ui/<m>` for `attention-line`, `button`, `dialog`, `fonts`, `keyboard`,
  `textarea`, `theme`, `utils` — **type declarations** of the shared set. At runtime these specifiers are
  the app's own modules on `globalThis.__thinkrailExtensionHost = { api, modules }`, keyed by exactly these
  specifiers plus `react`, `react/jsx-runtime` and `react-dom`. Each subpath's `default` condition is a
  generated stub that reads the host object (so a non-SDK bundler gets the same runtime error as an SDK
  build), never code of its own.
- The exact export names per specifier are `assets/shared-modules.json` (also exported as
  `./shared-modules.json`); the props, variants and names in the declarations are the rest of the v1
  promise, together with the implicit contract the installed-extensions section lists (TooltipProvider,
  locale store, portals, `html[data-theme]`, semantic variables and utility names, spacing/radius scales,
  typography classes, Tailwind major and layer order, React major).
- `bin` `thinkrail-extension` (`bin/thinkrail-extension.js`, a committed launcher importing
  `dist/cli.js`, so a workspace install links it before the SDK is built): `thinkrail-extension build [--prefix <a-z>] [--entry <file>] [--css <file>] [--cwd <dir>]
  [--no-minify]`; `./theme.css` (the theme file) and `assets/extension.css` (the stylesheet template).
- Versioning: the package's `major.minor` is the extension API it builds (`EXTENSION_API_VERSION` in
  `src/shared.ts`); patch releases change no promise. The first changeset is a major bump from `0.0.0`
  to `1.0.0`.

## The build command

- Reads `package.json` from `--cwd` (default: the current folder) and validates the `thinkrail`
  manifest: `api` must **equal** the SDK's API (a bundle can only promise the names the SDK knew), at
  least one of `server` / `web`, `styles` only with `web`, every path relative and inside the package,
  `web` ending in `.js`, `styles` in `.css`, `image` an `https://` URL, the `server` file present, and
  pi packages / `typebox` never in `dependencies` (they must be peers). A missing keyword, a missing SDK
  dependency for a server half and unknown manifest keys are warnings. A server-only extension has
  nothing to build.
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
  specifiers). `react/jsx-dev-runtime` maps onto the production `jsx`. Rejected with a hint, naming the
  importer: `react-dom/client`, `react/compiler-runtime` / `react-compiler-runtime` (the React Compiler
  is not supported in v1), any other `react` / `react-dom` subpath, `./server` and unknown SDK subpaths,
  the private `@thinkrail/ui|extension-api|resource-renderers` names (pointing at the SDK specifier), and
  CSS imported from JavaScript.
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
  assets — `extension-api`, `ui`, `resource-renderers`, `contracts`, `locales`, React. Shipped code uses
  `node:` builtins and standard ESM only.
- **Forbidden:** importing the host (`server`, `shared`, `apps/*`); a runtime import of any private
  package; pi values. Nothing in `apps/*` or `packages/server` imports the SDK. Planned: enforced by
  `scripts/check-module-boundaries.ts` once the boundary wiring of this delivery lands.

## Release and verification

Published through the repository's Changesets / npm Trusted Publishing flow with the portable pi packages
([[module-pi-extensions]] § Release; the first version needs the manual bootstrap publish). Gates:
package tests (`bun test`: manifest validation, the build's bundle/stylesheet/runtime check and
rejections, the CLI, asset drift); `typecheck` (including conformance); and, planned with the
publishing wiring of this delivery, `bun run check:extension-packages`, which packs the SDK and the samples, installs the tarballs into a temp
fixture outside the repository with npm, type-checks and builds a tiny extension there under Node and
under Bun, and asserts the bundle has no React or UI-kit code and the stylesheet only prefixed utilities.
