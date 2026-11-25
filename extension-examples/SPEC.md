---
id: module-extension-examples
type: module-design
status: draft
title: Sample installable extensions (extension-examples/)
parent: architecture
depends-on: [module-extension-sdk]
references: [module-thinkrail-extensions]
tags: [extensions, sdk, publishing]
---

## Responsibility

The workspace root for ThinkRail extensions written **the way an outside author writes them**: each
package here is installed at runtime under [[module-thinkrail-extensions]] § Installed extensions,
never composed by the host's registry files. A sample is the end-to-end proof of the SDK, the walkthrough
of the authoring guide and the fixture of the installed-extension E2E and artifact tests, so it must be
deterministic and need no network and no API key.

## Boundary

- **Allowed deps:** the public entries of `@thinkrail/extension-sdk` ([[module-extension-sdk]]) —
  `./server`, `./web`, `./resources`, `./ui/button`, `./ui/theme`, `./ui/utils`, and of those only the
  names extension API v1 allow-lists (the SDK's declarations hold nothing else, so `tsc` enforces it) —
  and its build command as a dev dependency; server halves import SDK types only and default-export
  descriptors with `satisfies ServerExtension`. React and its types; ordinary npm
  packages declared exactly. pi packages and `typebox` are peer dependencies (dev dependencies for the
  repository's own tests), as the installed-extension contract requires.
- **Forbidden:** every other `@thinkrail/*` package (the host, `contracts`, `ui`, `extension-api`,
  `resource-renderers`, `locales`, other examples) and the SDK's internals. Nothing in `apps/*` or
  `packages/*` imports a sample. Inside a sample, `server/**` and `web/**` never import each other.
- Enforced by `scripts/check-module-boundaries.ts` ([[module-repo-scripts]]).

## Identity and distribution

npm name `@thinkrail/example-extension-<name>` under our scope — deliberately not the private
built-ins' `@thinkrail/ext-*` pattern — directory `extension-examples/<name>/`. The descriptor `name` on
both halves equals the package name, the extension's identity. A sample is published like the portable pi
packages ([[module-pi-extensions]] § Release): `version: 0.0.0` and `private` until its first changeset, `files`
whitelisting the server source and the built `dist/`. Its web output is built in `prepack` (`npm run build`, because `bun pm pack` runs lifecycle scripts
without `node_modules/.bin` on `PATH`) and in its tests, never committed. `turbo.json` in the package makes `typecheck` and `test` wait for the SDK's build,
because the SDK's declarations and bin are build outputs.

## Members

| package | what it shows |
| --- | --- |
| `palette` (`@thinkrail/example-extension-palette`) | One agent tool, `color_palette`: a five-colour palette from a base hex colour and a harmony, as text, CSS custom properties and `details`. One card: swatches drawn as SVG, copy buttons (the app's `Button` / `IconButton`, Remix Icon bundled), `palette:`-prefixed utilities. One boolean setting, `contrast` (default on, with its own title and description): the tool adds WCAG contrast ratings to its text and `details`, and the card shows them. The tool is registered through `sessionExtensions` because only per-session services read a setting. |
