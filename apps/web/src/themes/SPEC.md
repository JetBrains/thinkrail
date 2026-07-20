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
  `applyTheme`, `resolveTheme`, `getThemes`, the first-paint hint pair, and the manifest/descriptor
  types plus the Shiki registration.
- **Allowed external deps:** `@thinkrail/contracts` for the opaque `ThemeId` and configured default;
  browser DOM/storage APIs and Vite's build-time glob; Shiki types only, to type the generic
  registration.
- **Forbidden:** server/shared/pi; store, transport, panels, shell, or component state; runtime theme
  registration or discovery of any kind; executable theme code; selectors/layout or arbitrary CSS
  supplied by a manifest.

## Manifest contract

A theme is exactly one `*.theme.json` file. Schema version 1 is strict and self-contained: id,
label/order, light-or-dark appearance, normal-or-high contrast metadata, a complete semantic UI palette,
all 16 terminal ANSI colors, and a complete semantic syntax palette. Color values are canonical
six/eight-digit hex; the two selected-text foreground overrides may explicitly be `null` to retain the
consumer's native foreground. There is no inheritance or partial overlay. The engine owns repetitive
derivations (alpha tints and appearance-level effects), TextMate/Monaco scope mapping, and CSS-token
mapping, so those mechanics never leak into manifests. Typography, spacing, radii, fonts, and motion
remain product tokens, not theme values.

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
