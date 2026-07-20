---
id: submodule-web-themes
type: submodule-design
status: active
title: themes — manifest registry and application
parent: module-web
depends-on: [module-contracts]
tags: [ui, themes, extensions]
---

## Responsibility

The browser-side theme engine: validates declarative ThinkRail theme manifests, maintains the available
catalog, resolves/applies the active palette, and exposes the registration seam through which bundled
(and eventually extension-provided) themes enter the UI. The host owns only the selected opaque id; this
module owns what that id means visually.

## Boundary

- **Owns:** the versioned `ThemeManifest` contract + JSON schema; the bundled manifest set; registry,
  resolution, and catalog subscriptions; atomic CSS-custom-property application; the first-paint cache;
  the semantic syntax-variable contract, and Shiki's generic CSS-variable TextMate scope map (Monaco
  consumes the same palette through its fixed adapter).
- **Public surface:** `index.ts` only — manifest/descriptor types plus the synchronous
  `initializeBundledThemes` bootstrap, `registerTheme`, catalog snapshot + subscription,
  resolution/application, and first-paint hint APIs. Registration accepts untrusted data
  and validates before mutating the catalog.
- **Allowed external deps:** `@thinkrail/contracts` for the opaque `ThemeId` and configured default;
  browser DOM/storage APIs and Vite's bundled-manifest discovery; Shiki types only where needed to type
  the generic registration.
- **Forbidden:** server/shared/pi; store, transport, panels, shell, or component state; fetching,
  discovering, installing, or trusting extension packages; executable theme code; selectors/layout or
  arbitrary CSS supplied by a manifest.

## Manifest contract

A bundled theme is exactly one `*.theme.json` file. Schema version 1 is strict and self-contained: id,
label/order, light-or-dark appearance, normal-or-high contrast metadata, a complete semantic UI palette,
all 16 terminal ANSI colors, and a complete semantic syntax palette. Color values are canonical
six/eight-digit hex; the two selected-text foreground overrides may explicitly be `null` to retain the
consumer's native foreground. There is no inheritance or partial overlay. The engine owns repetitive
derivations (alpha tints and appearance-level effects),
TextMate/Monaco scope mapping, and CSS-token mapping, so those mechanics never leak into manifests.
Typography, spacing, radii, fonts, and motion remain product tokens, not theme extension points.

Bundled files are discovered as a set rather than named in a code catalog. Runtime and JSON-schema
validation agree; duplicate ids, unknown schema versions, malformed values, and incomplete palettes are
rejected all-or-nothing. The configured default id must resolve to one valid bundled manifest.

## Runtime contract

Application is atomic from consumers' perspective: resolve the requested id (default on unavailable),
write the complete variable set, `color-scheme`, and semantic contrast metadata, then publish the change
through `data-theme` last. Selected-text foregrounds are removed when their manifest values are `null`.
Generic consumers can therefore rebuild after that signal without observing half of a palette. The
requested id is retained across fallback, so registering it later activates it; disposing an active
registration falls back safely. Registry snapshots are deterministic and subscribable, allowing a
mounted picker to follow registrations without knowing their source.

Local storage remains a render hint only. The host-synced config always reconciles it after connect.
Unknown/removed ids are not destructively rewritten in persistence.

## Extension seam

`registerTheme(manifest)` is the only extension-facing assumption made now. Bundled discovery uses the
same path. Extension packaging/discovery, host-to-web transport, namespaces, trust/signing, lifecycle UX,
precedence, and external-format adapters are deliberately outside this module's current contract.
Duplicate registrations cannot shadow an existing theme.

Shiki uses one web-only TextMate registration whose colors are semantic CSS variables (an explicitly
supported Shiki mode); Monaco reads the same semantic palette. Thus adding a theme never adds a Shiki
import, CSS selector, or editor-specific catalog entry, and a swap needs no Shiki re-highlight.
