---
id: module-design-tokens
type: module-design
status: active
parent: architecture
depends-on: [module-contracts]
references: [web-color, web-spacing, web-typography]
title: Design tokens (theme palettes, semantic tokens, generated CSS)
---

## Responsibility

The single source of ThinkRail's visual language, shared by every UI host (`apps/web`, `apps/mobile`):
the bundled theme palettes and their manifest contract, the three design-system sources
(`styles/colors.json`, `styles/spacing.json`, `styles/typography.json`), the generators that turn them into
committed CSS (`styles/generated/`), and the one function that writes a palette onto a document root.
It knows nothing about catalogs, preferences, user themes, or any app's layout — those stay with the host
(`apps/web/src/themes` for the IDE).

## Public surface

- `src/index.ts` (barrel): the manifest contract (`parseThemeManifest`, `assertThemeManifest`,
  `isThemeIdSlug`, the key lists and types), `bundledThemeSources()` (the Vite build-time glob over
  `themes/*.theme.json`; call it only from bundled code), and `applyPalette(root, manifest)` with the
  `paletteVariable` / `ANSI_VARIABLES` / `SYNTAX_VARIABLES` naming it applies.
- `./styles.css`: imports fonts, the CJK fallbacks, typography, colours, spacing, shape and motion in that order. A host imports it right
  after `@import "tailwindcss"`; the generated files carry their own `@theme inline` maps, so a host gets
  the semantic utilities (`bg-container-workspace-bg`, `tr-text-ui`, `p-8`) and nothing of Tailwind's stock
  palette.
- `./themes/*`, `./styles/*`: the raw JSON/CSS as data, for tests and the website.
- `./scripts/*`: the build-time libraries (`colors`, `spacing`, `typography`, `generatedFiles`) for the host
  adoption guards and generators. Dev-time only: nothing that ships imports them.

## Boundary

- **Allowed deps:** `@thinkrail/contracts` (theme ids), the fontsource packages named as `selfHosted`
  in `typography.json` (the generated `fonts.css` imports them, so they resolve from here), Vite's
  `import.meta.glob` types. Scripts use `node:fs` / `node:path` only and run under Bun.
- **Forbidden:** React, stores, transport, DOM beyond `applyPalette`'s custom-property write, any app's
  layout tokens (panel/topbar heights stay in `apps/web/src/styles/tokens.css`), and theme
  selection/persistence.
- **Usage rules live with the host.** Which utilities a component may name, and the adoption guards that
  enforce it, are [`COLOR.md`](../../apps/web/src/styles/COLOR.md),
  [`SPACING.md`](../../apps/web/src/styles/SPACING.md) and
  [`TYPOGRAPHY.md`](../../apps/web/src/styles/TYPOGRAPHY.md); the generators here enforce only source
  validity and drift (`*:check`).

## Shape

`styles/cjk.css` declares `TR Kana` / `TR Han` / `TR Hangul`: Apple's Hiragino, PingFang and Apple SD Gothic
Neo by `local()` only, each limited by `unicode-range` to its own scripts, named in the interface and brand
stacks before `-apple-system`. Geist has no CJK and iOS 26 WebKit's `-apple-system` claims glyphs it cannot draw,
so CJK otherwise rendered as boxes on the phone; naming PingFang in the stack unrestricted would also take
every other script Geist lacks (Greek came out full-width). Nothing is downloaded; other systems skip them.

`styles/shape.css` replaces Tailwind's radius scale with four steps (`@theme static`, reset first): `sm`
(4px) is the default corner for standalone controls; `xs` (2px) is the text-run tier, a tint behind running
text where `sm` would read as a chip; `md` (6px) is the outer corner of a surface nesting `sm` children;
`lg` (8px) is reserved for large independent elevated surfaces (dialogs, message bubbles). Nothing above
8px; `rounded-full` is a pill/circle, not a step.

## Motion

`styles/motion.css` holds the shared `@theme` animations of components in [[module-ui]] and [[module-chat-ui]]: the
`loader-*` keyframes of `@thinkrail/ui/running-icon` (one 3.263s cycle) and `reveal` (a block appearing in
place). App-local animations stay in the app's
stylesheet.

## Generators

`bun run --cwd packages/design-tokens <system>:generate | :check` (also reachable from the root and
`apps/web` scripts) for `typography`, `colors`, `spacing`. Each library is load → validate → render and is
the only place its derivation is written — for typography that includes the user-adjustable tokens the web
`fonts` runtime overrides (`--tr-font-family-<id>` over its `-default`, `--tr-font-size-code` / `-dense`,
`--tr-font-weight-offset`, `--tr-font-ligatures-<id>`), and `generate-typography` also writes `fonts.css`,
the `@import`s for the self-hosted faces; `generatedFiles.ts` is the only definition of "stale".
`colors.ts` reads `src/schema.ts` as data so every `THEME_COLOR_KEYS` entry must be claimed by a role;
`typography.ts` reads this package's `package.json` so a `selfHosted` entry and an installed font cannot
drift. The generated directory is committed and Biome-ignored.

## Generator invariants

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
  prose element sets, the document heading ladder, the user-adjustable tokens' reserved ids and
  dense-below-code rule, and spacing step-name/value identity all live in `validate()`. Changing either contract means checking the other.
- **A generated file is never hand-edited.** The emitted CSS headers say so, and each pipeline's
  `*:check` command enforces it.

## Theme manifest contract

A theme is exactly one `*.theme.json` file. Schema version 2 is strict and self-contained: id,
label/order, light-or-dark appearance, normal-or-high contrast metadata, a complete semantic UI palette
(only the derived keys below may be omitted), all 16 terminal ANSI colors, and a complete semantic syntax
palette. Color values are canonical
six/eight-digit hex; the two selected-text foreground overrides may explicitly be `null` to retain the
consumer's native foreground. There is no inheritance or partial overlay. The engine owns appearance-level
effects, TextMate/Monaco scope mapping, and CSS-token mapping, so those mechanics never leak into
manifests. Typography, spacing, radii, fonts, and motion remain product tokens, not theme values; the
user's font choice is a separate host setting ([[submodule-web-fonts]]), so changing the theme never
changes a font.

**The manifest is a user-kept file format, so its schema evolves compatibly.** The parser accepts every
schema version released for user files (v2 is the first) and migrates older ones in code to the current
shape before validation, so a theme a user saved never breaks on upgrade. Consequently a key added in a
later version must be derivable from keys every earlier version already has — the way v2's `header`
equals the v1 `content` — or it cannot be added; a value a palette genuinely needs to vary starts as a
derived default. Compatibility is backward only: a file declaring a newer `schemaVersion` than the
running app knows, or carrying a key it does not know, is reported as `invalid-theme` rather than
guessed at.

**A manifest supplies the palette, not the roles.** It answers *which colour*; what each colour is
*for* is the semantic layer declared in `styles/colors.json` — `container-elevated-bg`,
`feedback-warning`, `text-subtle` — which is the only layer components name, and which owns the alpha
scale. The split is what lets a theme be a palette swap with no component change, and it is why this
module's variables (`--elevated`, `--border-strong`, `--muted`) are internal: reaching one from a component
bypasses the role it belongs to. See [`COLOR.md`](../../apps/web/src/styles/COLOR.md).

**One key per role that themes may vary independently.** Schema version 2 splits `header` out of
`content`, which previously wrote both `--bg-dark` and `--surface-content` and so pinned the app header
to the code canvas in every theme. Every bundled manifest ships `header` equal to its `content`, so the
split changed no pixel — it made a knob exist. The same move is what any future divergence needs: a role
can only vary between themes if the manifest has a key for it.

The primary control has an explicit opaque-fill contract: `accentSolid` is its resting fill,
`accentHover` its hover fill, and `onAccent` the label on both. The separate `accent` remains the
foreground/ring/border and tint source. This lets a palette vary opaque controls without silently
changing every accent tint: the Minimal palettes align their resting fill with their accent, while the
standard Light keeps its brighter independent solid fill. The destructive control has the same contract
on the danger hue: `danger` is its resting fill (and the feedback colour), `dangerHover` its hover fill, and
`onDanger` the label on both — `schema.test.ts` holds `onDanger` to AA on both fills and keeps the hover
step distinguishable (≥ 1.15) from the resting fill. `dangerHover` and `onDanger` joined v2 after user
files shipped, so by the compatibility rule above both are optional and derived from keys every v2 file
has: `dangerHover` defaults to `danger` darkened 12% toward black (the step every bundled theme uses)
and `onDanger` to the palette's own `text` or `background`, whichever reads better on both fills.
Bundled manifests still set both explicitly.

**The manifest→variable name is derived, not mapped.** A key writes to its kebab-cased name —
`borderStrong` → `--border-strong`, `editorSelection` → `--editor-selection`. `applyPalette` (`src/palette.ts`) applies that
rule when it writes the palette to the document root, and `scripts/colors.ts` applies the same rule when
it resolves a role's `from`; neither consults a table, because the table *was* the drift path (and its
names — `--blue` for `info`, `--border2` for `borderStrong` — had stopped describing what they held).
There is no `palette` section in `colors.json` and no generated TypeScript: `generate-colors.ts` emits
exactly one artifact, `styles/generated/colors.css` (the roles, the per-appearance `effects`, and the
Tailwind `@theme inline` map). What keeps the two lists honest is coverage, not a mapping — the
generator refuses to run unless **every** `THEME_COLOR_KEYS` entry is claimed by at least one role, so a
key added to the manifest schema and forgotten in `colors.json` cannot reach a build, and a role naming
a key that does not exist fails the same gate.

**A manifest must also be legible, not merely complete.** `schema.test.ts` enforces WCAG AA on every
resting surface (`background`, `content`, `sidebar`, `header`, `elevated`, `input`) and a lower 3.0
floor on the transient `hover` surface — the latter being our line rather than the standard's, so that
a theme borrowed from elsewhere keeps its signature colours. `accent` and `success` are exempt from
`input` alone: neither is ever rendered as text on a control. Separately, `onAccent` must clear AA on
**both** primary fills (`accentSolid` and `accentHover`), so a theme cannot darken its hover step far enough
to swallow the primary button's own label. Legibility alone proved insufficient: High Contrast Light
once shipped its `hover` fill — the palette source of the selected/hovered control roles — at 1.05:1
against its own sidebar, an invisible selection with every check green, so the suite also pins
hover-vs-surface **distinguishability** (≥ 1.15 against every resting surface — `content` included,
because PlanPane and the workbench backdrop host hovered controls there, which Light's original
`hover == content` palette made invisible). A new manifest that reads poorly fails to merge; see
[`COLOR.md`](../../apps/web/src/styles/COLOR.md) for the reasoning.

**A `contrast: "high"` manifest is held to AAA (7.0) resting and full AA (4.5) even on hover**, `hint`
excepted. High contrast is the entire reason those two themes exist, so the ordinary AA floor is the
wrong gate for them: it lets one decay into a merely-adequate theme while every check stays green. That
is not hypothetical — when the palette went green, High Contrast Light's `accent` fell from 8.98 to 5.17
and its `success` from 7.39 to 5.08, and nothing failed. The stricter floor is what makes "high contrast"
a property the suite enforces rather than a label in the manifest.

Bundled files are discovered by a build-time glob rather than named in a code catalog, and validated
all-or-nothing at bootstrap. The files are our own, so any invalid or duplicate manifest, missing
configured default, or catalog without at least one light and one dark manifest **fails loudly** (unit
tests catch it before merge). Runtime and JSON-schema validation agree.

