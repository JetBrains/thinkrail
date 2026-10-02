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

The directory holds four pipelines — typography, colour, spacing and provider glyphs — built the same way, plus one
read-only diagnostic, the React Compiler census. They live here rather than in `src/` because
they are *generators*: they use `node:fs` and `node:path`, which must never reach browser-bundled code.

## What it owns

| File | Role |
|---|---|
| `typography.ts` | the library: load → validate → render CSS. The **only** place CSS custom-property names, semantic class names and prose root class names are derived. |
| `generate-typography.ts` | CLI. Writes `src/styles/generated/typography.css` and `src/styles/generated/fonts.css` (the `@import`s for the self-hosted faces); `--check` fails instead of writing when a committed file is stale. |
| `validate-typography.ts` | CLI. Validates `src/styles/typography.json` and prints a summary. The enforced gate. |
| `colors.ts` | the library: load → validate → render. The **only** place a colour derivation (a palette alias or an alpha step) is written. |
| `generate-colors.ts` | CLI. Writes `src/styles/generated/colors.css` — the roles, the appearance-level effects, and the Tailwind map; `--check` fails when it is stale. |
| `spacing.ts` | the library: load → validate → render. It enforces step identity and is the only place the generated spacing-CSS shape and `--spacing: 1px` (number = px) base are derived; the step lengths live only in `spacing.json`. |
| `spacing.test.ts` | Pins the spacing source validator's closed root/metadata shapes and value types against the schema. |
| `generate-spacing.ts` | CLI. Writes `src/styles/generated/spacing.css` — the `--space-<n>` tokens + the Tailwind base; `--check` fails when it is stale. |
| `providerGlyphs.ts` | the library: the **only** pi-provider-id → vendor-mark mapping, plus the reader that accepts a vendored SVG only when it is a 24×24, path-only, `currentColor` glyph (layered marks keep their per-path opacity) and the renderer that shares one constant per mark. Source set: the dev-only `@lobehub/icons-static-svg` (MIT; the marks stay their owners' trademarks). |
| `generate-provider-glyphs.ts` | CLI. Writes `src/chat/generated/providerGlyphs.ts`; `--check` fails when it is stale. The generated module is Biome-ignored like `styles/generated`. |
| `providerGlyphs.test.ts` | pins that every mapped mark exists in the vendored set and that coloured, oddly sized or non-path SVGs are rejected rather than flattened. |
| `generatedFiles.ts` | what every generate CLI does with a rendered file: `--check` reports drift, otherwise write. The **only** definition of "stale", so the three pipelines and the tests cannot disagree. |
| `generatedFiles.test.ts` | pins that definition — content drift and a missing file are stale, a CRLF working tree is not. |
| `compiler-census.ts` | CLI. Runs `babel-plugin-react-compiler` with a logger over `src/` (tests excluded) and prints every function the compiler bails out on as `file:line: [fn] category: reason`, plus totals; `--json` prints the full census. Run: `bun run --cwd apps/web compiler:census [--json]`. Read-only; not a gate. |

`designSources.ts` owns the shared adoption-guard scan: app source, `packages/ui`, and every
`thinkrail-extensions/*/web` source tree, excluding tests, generated output, and installed dependencies.
The same SDK/extension roots are explicit Tailwind `@source` directives in the app stylesheet. Extension
sources name recursive file globs: a wildcard directory ending in `*/web` alone does not discover the
nested files, silently dropping extension-only classes such as fullscreen zoom. The browser zoom probe
checks rendered dimensions, not just the zoom label, to pin actual CSS generation. Each token `*:check`
command checks generated output and its corresponding adoption guard, so moving a primitive
out of the app cannot hide token misuse or make a live token look unused.

Public surface: the `typography.ts`, `colors.ts`, `spacing.ts`, `providerGlyphs.ts`, `generatedFiles.ts` and `designSources.ts` exports. There is no `index.ts` barrel — the CLIs are entry points
invoked by name from `package.json`, and the one importer outside this directory
(`src/styles/*.test.ts`) imports the library directly, which keeps the tests and the generator provably
in agreement about the same functions.

## Boundary

- **Allowed deps:** `node:fs`, `node:path`, `node:module` (resolving the vendored glyph set), the three JSON sources + their schemas, the dev-only `@lobehub/icons-static-svg` files read as *data*, and two further reads
  taken as *data*, never as imports: `src/themes/schema.ts` (for `colors.ts`, so the roles and
  `THEME_COLOR_KEYS` cannot drift) and `apps/web/package.json` (for `typography.ts`, so a `selfHosted`
  entry and the installed font packages cannot drift).
- **Forbidden:** runtime imports of React, Tailwind, `src/`, or any `@thinkrail/*` package, any runtime
  (non-dev) dependency, and any network or shell access. Adoption guards read source as data; generators
  read only their declared inputs. A generator that needed one of those would be
  the wrong shape.
- **Census exception:** `compiler-census.ts` also uses `@babel/core` and `babel-plugin-react-compiler`
  and reads every `src/**/*.{ts,tsx}` file as *text*. It must pass the compiler the same options as
  `reactCompilerPreset()` in `vite.config.ts` and mirror the preset's file filter, so its counts match
  the real build. Build-time compiler validations differ from the lint rules (for example
  `StaticComponents` is lint-only), so its counts differ from an oxlint React scan by design.
- **Imported by:** `apps/web/package.json` scripts (`typography:generate` / `:validate` / `:check`,
  `colors:generate` / `:check`, `spacing:generate` / `:check`, `provider-glyphs:generate` / `:check`, re-exported from the root `package.json`; `compiler:census` is web-only), and
  `src/styles/typography.test.ts` + `src/styles/typographyUsage.test.ts` +
  `src/styles/colorUsage.test.ts` + `src/styles/spacingUsage.test.ts`. Nothing in the shipped app may import from here — the generated
  CSS is the interface.
- **Writes:** `src/styles/generated/` and `src/chat/generated/` only (the census writes nothing). Both directories are committed (so every typography, colour, spacing
  or glyph change is reviewable as a diff) and excluded from biome in `biome.json`.

## Invariants

- **The built-in-palette reset leads the `@theme inline` block.** `colors.ts` emits
  `--color-*: initial;` *before* our own entries so Tailwind's stock palette (`bg-red-500`,
  `text-white`) stops being a utility at all — stock utilities compile happily otherwise: hardcoded,
  un-themeable, and invisible in review. The order is load-bearing: a reset emitted in a later block
  would wipe our entries too.
- **A plain-alias role never redeclares its own palette variable.** A role whose name *is* its palette
  key (`primary` → `--primary`) publishes the palette variable directly and emits no `:root` line:
  `--primary: var(--primary)` is a computed-value-time self-reference (invalid), masked today only
  because the runtime writes the palette as an inline style that outranks `:root`.
- **The JSON is the only source.** `typography.ts` derives every emitted name mechanically, so a new
  token, style or prose system needs no change here. If adding a style requires editing this directory,
  the naming rule was wrong.
- **Generation is deterministic and idempotent.** Same input → byte-identical output; no clock, no
  randomness, no environment reads. That is what makes `--check` a usable drift gate in pre-commit,
  `apps/web build` and CI. Line endings are the one exception, because they belong to the checkout
  rather than the content: `.gitattributes` pins the working tree to LF, and every comparison against
  a committed file goes through `normalizeEol` so a CRLF clone cannot report drift that is not there.
- **`validate()` is the gate, not the JSON Schema.** The schemas are editor-facing contracts (`$schema`
  in each source gives completion + inline errors); the toolchain has no JSON Schema validator. Every
  validator mirrors its schema's closed root and nested object shapes before enforcing policies Schema
  cannot express. Referential integrity, mono-is-code-only, `title.card` == `title.dialog`, matching
  prose element sets, the document heading ladder, and spacing step-name/value identity all live in
  `validate()`. Changing either contract means checking the other.
- **A generated file is never hand-edited.** The emitted CSS headers say so, and each pipeline's
  `*:check` command enforces it.

Design and rationale for each system itself: [../src/styles/TYPOGRAPHY.md](../src/styles/TYPOGRAPHY.md)
(`web-typography`), [../src/styles/COLOR.md](../src/styles/COLOR.md) (`web-color`), and
[../src/styles/SPACING.md](../src/styles/SPACING.md) (`web-spacing`).
