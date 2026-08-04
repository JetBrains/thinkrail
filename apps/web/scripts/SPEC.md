---
id: module-web-scripts
type: submodule-design
status: active
title: apps/web build-time scripts — the typography and colour pipelines
parent: module-web
---

# `apps/web/scripts`

Build-time tooling for `apps/web`. **Nothing here ships**: these modules run under Bun on a developer's
machine or in CI, never in the browser bundle. They read files from `src/`, write generated files back
into `src/`, and exit with a status code.

The directory holds two pipelines — typography and colour — built the same way. They live here rather than in `src/` because
it is a *generator*: it uses `node:fs` and `node:path`, which must never reach browser-bundled code.

## What it owns

| File | Role |
|---|---|
| `typography.ts` | the library: load → validate → render CSS. The **only** place CSS custom-property names, semantic class names and prose root class names are derived. |
| `generate-typography.ts` | CLI. Writes `src/styles/generated/typography.css` and `src/styles/generated/fonts.css` (the `@import`s for the self-hosted faces); `--check` fails instead of writing when a committed file is stale. |
| `validate-typography.ts` | CLI. Validates `src/styles/typography.json` and prints a summary. The enforced gate. |
| `colors.ts` | the library: load → validate → render. The **only** place a colour derivation (a palette alias or an alpha step) is written. |
| `generate-colors.ts` | CLI. Writes `src/styles/generated/colors.css` — the roles, the appearance-level effects, and the Tailwind map; `--check` fails when it is stale. |

Public surface: the `typography.ts` and `colors.ts` exports. There is no `index.ts` barrel — the two CLIs are entry points
invoked by name from `package.json`, and the one importer outside this directory
(`src/styles/*.test.ts`) imports the library directly, which keeps the tests and the generator provably
in agreement about the same functions.

## Boundary

- **Allowed deps:** `node:fs`, `node:path`, the two JSON sources + their schemas, and two further reads
  taken as *data*, never as imports: `src/themes/schema.ts` (for `colors.ts`, so the roles and
  `THEME_COLOR_KEYS` cannot drift) and `apps/web/package.json` (for `typography.ts`, so a `selfHosted`
  entry and the installed font packages cannot drift).
- **Forbidden:** React, Tailwind, anything under `src/` other than the two JSON files, any
  `@thinkrail/*` package, and any network or shell access. A generator that needed one of those would be
  the wrong shape.
- **Imported by:** `apps/web/package.json` scripts (`typography:generate` / `:validate` / `:check`,
  `colors:generate` / `:check`, re-exported from the root `package.json`), and
  `src/styles/typography.test.ts` + `src/styles/typographyUsage.test.ts` +
  `src/styles/colorUsage.test.ts`. Nothing in the shipped app may import from here — the generated
  CSS is the interface.
- **Writes:** `src/styles/generated/` only. That directory is committed (so every typography or colour
  change is reviewable as a diff) and excluded from biome in `biome.json`.

## Invariants

- **The JSON is the only source.** `typography.ts` derives every emitted name mechanically, so a new
  token, style or prose system needs no change here. If adding a style requires editing this directory,
  the naming rule was wrong.
- **Generation is deterministic and idempotent.** Same input → byte-identical output; no clock, no
  randomness, no environment reads. That is what makes `--check` a usable drift gate in pre-commit,
  `apps/web build` and CI.
- **`validate()` is the gate, not the JSON Schema.** `typography.schema.json` is the editor-facing
  contract (`$schema` in the source gives completion + inline errors); the toolchain has no JSON Schema
  validator. Shape checks, referential integrity and the policies Schema cannot express — mono is
  code-only, `title.card` == `title.dialog`, every prose system owns the same element set, the document
  heading ladder never inverts — all live in `validate()`. Changing one means checking the other.
- **A generated file is never hand-edited.** The header of the emitted CSS says so, and `typography:check`
  enforces it.

Design and rationale for the system itself: [../src/styles/TYPOGRAPHY.md](../src/styles/TYPOGRAPHY.md)
(`web-typography`).
