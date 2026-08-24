---
id: submodule-web-themes
type: submodule-design
status: active
title: themes — bundled manifest catalog and application
parent: module-web
depends-on: [module-contracts]
tags: [ui, themes]
---

## Responsibility

The browser-side theme engine: validates the bundled declarative theme manifests at bootstrap, owns the
resulting fixed catalog, and resolves/applies the active palette atomically. The host owns only the
selected opaque id; this module owns what that id means visually. **Adding a theme = adding one
`bundled/*.theme.json` file** (a PR + rebuild) — no code, contract, CSS, or test changes.

## Boundary

- **Owns:** the versioned `ThemeManifest` contract + JSON schema; the bundled manifest set; catalog
  construction and resolution; atomic CSS-custom-property application; the first-paint cache; the
  semantic syntax-variable contract, and Shiki's generic CSS-variable TextMate scope map (Monaco
  consumes the same palette through its fixed adapter).
- **Public surface:** `index.ts` only — `initializeBundledThemes` (the synchronous bootstrap),
  `applyTheme`, `resolveTheme`, `getThemes`, `onThemeSwap` (subscribe to a completed theme change — this
  module owns the `data-theme` signal, so it owns the way to observe it; Monaco/xterm/mermaid all re-read their
  palettes through it rather than each hand-rolling a MutationObserver), the first-paint hint pair, and the
  manifest/descriptor types plus the Shiki registration.
- **Allowed external deps:** `@thinkrail/contracts` for the opaque `ThemeId` and configured default;
  browser DOM/storage APIs and Vite's build-time glob; Shiki types only, to type the generic
  registration.
- **Forbidden:** server/shared/pi; store, transport, panels, shell, or component state; runtime theme
  registration or discovery of any kind; executable theme code; selectors/layout or arbitrary CSS
  supplied by a manifest.

## Manifest contract

A theme is exactly one `*.theme.json` file. Schema version 2 is strict and self-contained: id,
label/order, light-or-dark appearance, normal-or-high contrast metadata, a complete semantic UI palette,
all 16 terminal ANSI colors, and a complete semantic syntax palette. Color values are canonical
six/eight-digit hex; the two selected-text foreground overrides may explicitly be `null` to retain the
consumer's native foreground. There is no inheritance or partial overlay. The engine owns appearance-level
effects, TextMate/Monaco scope mapping, and CSS-token mapping, so those mechanics never leak into
manifests. Typography, spacing, radii, fonts, and motion remain product tokens, not theme values.

**A manifest supplies the palette, not the roles.** It answers *which colour*; what each colour is
*for* is the semantic layer declared in `styles/colors.json` — `container-elevated-bg`,
`feedback-warning`, `text-subtle` — which is the only layer components name, and which owns the alpha
scale. The split is what lets a theme be a palette swap with no component change, and it is why this
module's variables (`--elevated`, `--border-strong`, `--muted`) are internal: reaching one from a component
bypasses the role it belongs to. See [`styles/COLOR.md`](../styles/COLOR.md).

**One key per role that themes may vary independently.** Schema version 2 splits `header` out of
`content`, which previously wrote both `--bg-dark` and `--surface-content` and so pinned the app header
to the code canvas in every theme. Every bundled manifest ships `header` equal to its `content`, so the
split changed no pixel — it made a knob exist. The same move is what any future divergence needs: a role
can only vary between themes if the manifest has a key for it.

`accentHover` is the second instance: the primary button needed a hover *fill* rather than a faded
resting fill, and the alpha scale cannot express one (a tint of the accent is translucent, not darker).
The alternative — pinning the primary button to a brand constant outside the palette — would have made
it the one control a theme cannot restyle, and would have let it drift from `accent` (the same colour it
had always been) on any theme that tunes its accent. So the accent is a **pair**: `accent` resting,
`accentHover` hovered, `onAccent` the label on both.

**The manifest→variable name is derived, not mapped.** A key writes to its kebab-cased name —
`borderStrong` → `--border-strong`, `editorSelection` → `--editor-selection`. `runtime.ts` applies that
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
**both** accent fills (`accent` and `accentHover`), so a theme cannot darken its hover step far enough
to swallow the primary button's own label. Legibility alone proved insufficient: High Contrast Light
once shipped its `hover` fill — the palette source of the selected/hovered control roles — at 1.05:1
against its own sidebar, an invisible selection with every check green, so the suite also pins
hover-vs-surface **distinguishability** (≥ 1.15 against every resting surface — `content` included,
because PlanPane and the workbench backdrop host hovered controls there, which Light's original
`hover == content` palette made invisible). A new manifest that reads poorly fails to merge; see
[`styles/COLOR.md`](../styles/COLOR.md) for the reasoning.

**A `contrast: "high"` manifest is held to AAA (7.0) resting and full AA (4.5) even on hover**, `hint`
excepted. High contrast is the entire reason those two themes exist, so the ordinary AA floor is the
wrong gate for them: it lets one decay into a merely-adequate theme while every check stays green. That
is not hypothetical — when the palette went green, High Contrast Light's `accent` fell from 8.98 to 5.17
and its `success` from 7.39 to 5.08, and nothing failed. The stricter floor is what makes "high contrast"
a property the suite enforces rather than a label in the manifest.

Bundled files are discovered by a build-time glob rather than named in a code catalog, and validated
all-or-nothing at bootstrap. The files are our own, so any invalid or duplicate manifest — or a missing
configured default — **fails loudly** (unit tests catch it before merge). Runtime and JSON-schema
validation agree.

## Runtime contract

The catalog is fixed once `initializeBundledThemes` runs (pre-React, in `main.tsx`); a new theme appears
after a rebuild/restart. Application is atomic from consumers' perspective: resolve the requested id
(default on unavailable), write the complete variable set, `color-scheme`, and semantic contrast
metadata, then publish the change through `data-theme` last, so generic consumers (Monaco/xterm/mermaid)
can rebuild after that signal without observing half a palette. Selected-text foregrounds are removed
when their manifest values are `null`.

Local storage remains a render hint only. The host-synced config always reconciles it after connect.
Unknown ids (an older build, a stale hint) resolve to the bundled default visually without destructively
rewriting the persisted selection.

Shiki uses one web-only TextMate registration whose colors are semantic CSS variables (an explicitly
supported Shiki mode); Monaco reads the same semantic palette and picks its base from
appearance/contrast metadata, never a known theme id. Thus adding a theme never adds a Shiki import, CSS
selector, or editor-specific catalog entry, and a swap needs no re-highlight.

## Non-goals (deliberate)

Users cannot add themes except through a source PR. Runtime registration, extension packaging/loading,
hot discovery, external theme formats, and trust/precedence models are all out of scope; if that ever
changes, the seam to reintroduce is a validated registration path in front of the same catalog.
