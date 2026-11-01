---
id: module-web-scripts
type: submodule-design
status: active
title: apps/web build-time scripts — the typography, colour and spacing pipelines
parent: module-web
---

# `apps/web/scripts`

Build-time tooling for `apps/web`. **Nothing here ships**: these modules run under Bun on a developer's
machine or in CI, never in the browser bundle. They read files from `src/`, write generated files back
into `src/`, and exit with a status code.

The directory holds the provider-glyph pipeline, the adoption-guard source scan, and the React Compiler
census: a diagnostic whose baseline is a ratchet gate. The typography, colour and spacing pipelines live
in [[module-design-tokens]] (`packages/design-tokens/scripts`); the web `*:generate` / `*:check` scripts
delegate to them, and `*:check` then runs this app's adoption guard. They live here rather than in `src/` because
they are *generators*: they use `node:fs` and `node:path`, which must never reach browser-bundled code.

## What it owns

| File | Role |
|---|---|
| `providerGlyphs.ts` | the library: the **only** pi-provider-id → vendor-mark mapping, plus the reader that accepts a vendored SVG only when it is a 24×24, path-only, `currentColor` glyph (layered marks keep their per-path opacity) and the renderer that shares one constant per mark. Source set: the dev-only `@lobehub/icons-static-svg` (MIT; the marks stay their owners' trademarks). |
| `generate-provider-glyphs.ts` | CLI. Writes `src/chat/generated/providerGlyphs.ts`; `--check` fails when it is stale. The generated module is Biome-ignored like `styles/generated`. |
| `providerGlyphs.test.ts` | pins that every mapped mark exists in the vendored set and that coloured, oddly sized or non-path SVGs are rejected rather than flattened. |
| `compiler-census.ts` | CLI. Runs `babel-plugin-react-compiler` with a logger over app, shared UI, and extension web sources (tests, stories and generated data excluded) and prints every function the compiler bails out on as `file:line: [fn] category: reason`, plus totals; `--json` prints the full census. Run: `bun run --cwd apps/web compiler:census [--json]`. `--write` renders the bailed-out functions to `compiler-census.baseline.txt` as `file fnName`, line-free so edits above them don't churn it. `fnName` is lexical, never positional: the binding a function is assigned to (through wrapping calls like `memo(…)`), else its own name, qualified by its named enclosing functions (`factory.Row`). Two compiler units in one file with the same identity fail the census, because neither a line nor an ordinal survives an insertion above them. `--check` (`bun run check:compiler`, CI) fails on any drift and names each function that newly bails out or now compiles. A new bail-out is fixed, or accepted by regenerating (`bun run compiler:census:generate`). |
| `compiler-census.baseline.txt` | The committed census baseline. |
| `compiler-census.test.ts` | pins that a function's baseline identity survives inserting a sibling before it, that nested functions are qualified by their owners, and that indistinguishable compiler units are rejected. |

`designSources.ts` owns the shared adoption-guard and compiler-census source scan: app source, `packages/ui`, and every
`thinkrail-extensions/*/web` source tree, excluding tests, generated output, and installed dependencies.
The same SDK/extension roots are explicit Tailwind `@source` directives in the app stylesheet. Extension
sources name recursive file globs: a wildcard directory ending in `*/web` alone does not discover the
nested files, silently dropping extension-only classes such as fullscreen zoom. The browser zoom probe
checks rendered dimensions, not just the zoom label, to pin actual CSS generation. Each token `*:check`
command checks generated output and its corresponding adoption guard, so moving a primitive
out of the app cannot hide token misuse or make a live token look unused.

Public surface: the `providerGlyphs.ts` and `designSources.ts` exports. There is no `index.ts` barrel — the CLIs are entry points
invoked by name from `package.json`, and the one importer outside this directory
(`src/styles/*.test.ts`) imports the library directly, which keeps the tests and the generator provably
in agreement about the same functions.

## Boundary

- **Allowed deps:** `node:fs`, `node:path`, `node:module` (resolving the vendored glyph set), the dev-only
  `@lobehub/icons-static-svg` files read as *data*, and `@thinkrail/design-tokens/scripts/generatedFiles`
  (the one definition of "stale", shared with the token generators).
- **Forbidden:** runtime imports of React, Tailwind, `src/`, or any other `@thinkrail/*` module, any runtime
  (non-dev) dependency, and any network or shell access. Adoption guards read source as data; generators
  read only their declared inputs. A generator that needed one of those would be
  the wrong shape.
- **Census exception:** `compiler-census.ts` also uses `@babel/core` and `babel-plugin-react-compiler`
  and reads authored TypeScript from the shared source scan as *text*, so extracting a component into
  the SDK or an extension does not silently remove it from the report. It must pass the compiler the same options as
  `reactCompilerPreset()` in `vite.config.ts` and mirror the preset's file filter, so its counts match
  the real build. Build-time compiler validations differ from the lint rules (for example
  `StaticComponents` is lint-only), so its counts differ from an oxlint React scan by design.
- **Imported by:** `apps/web/package.json` scripts (`provider-glyphs:generate` / `:check`,
  `compiler:census:generate` / `:check`, the latter as the root `check:compiler`; `compiler:census` itself is
  web-only) and the `src/styles/*Usage.test.ts` adoption guards (`designSources.ts`). Nothing in the shipped
  app may import from here.
- **Writes:** `src/chat/generated/`, plus the census's `compiler-census.baseline.txt`. The directory is
  committed and excluded from biome in `biome.json`.

Design and rationale for each system itself: [../src/styles/TYPOGRAPHY.md](../src/styles/TYPOGRAPHY.md)
(`web-typography`), [../src/styles/COLOR.md](../src/styles/COLOR.md) (`web-color`), and
[../src/styles/SPACING.md](../src/styles/SPACING.md) (`web-spacing`).
