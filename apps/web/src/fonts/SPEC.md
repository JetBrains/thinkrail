---
id: submodule-web-fonts
type: submodule-design
status: active
title: fonts — user font preference applied as typography tokens
parent: module-web
depends-on: [module-contracts, web-typography]
references: [submodule-web-themes, submodule-server-fonts]
tags: [ui, typography]
---

## Responsibility

Turns the host's font settings (`interfaceFont`, `codeFont`, `codeFontSize`, `terminalFontSize`, `codeLigatures`,
`fontWeightOffset` — [[module-contracts]]) and the host's custom font files into the user-adjustable
typography tokens on `:root`, and tells code surfaces when the result changed. It is the only writer of
those tokens; the defaults themselves stay in `typography.json` ([[web-typography]]).

## Boundary

- **Owns:** composing a role's stack from its choice; writing exactly the user tokens
  (`--tr-font-family-{interface,code}`, `--tr-font-size-code`, `--tr-font-size-terminal`, `--tr-code-row-height`,
  `--tr-font-weight-offset`, `--tr-font-ligatures-code`) on `document.documentElement`; the custom
  `FontFace` registry; per-device probes (renders here? monospaced?); the versioned first-paint hint; the
  weight preview used while the Settings slider drags.
- **Public surface:** `index.ts` only — `initializeFonts`, `applyFontPreference`,
  `previewFontWeightOffset`, `installUserFonts`, `subscribeFontFaces` / `fontFacesRevision`,
  `bundledFaces`, `probeFont`, `weightResponse`, `textWeightRange`, `sharesHostFonts`, `writeFontsHint`,
  `DEFAULT_FONT_PREFERENCE`, `previewStack`, `refFamily` / `roleFamily` (a ref, or no choice, to its
  family name), `namedFamilies` (every named family a set of choices uses), and the `FontProbe` / `WeightResponse` /
  `BundledFaces` types. The preference is the contracts' `FontSettings`, normalized by
  `normalizeFontSettings` like the host and the store.
- **Allowed deps:** `@thinkrail/contracts`; `clientPreferences` (native-stable hint storage);
  `constants` (the branding storage prefix); browser DOM, CSSOM, canvas and `FontFace` APIs.
- **Forbidden:** store, transport, panels, shell; any typography value other than the tokens above; face
  names — bundled faces are read back from the generated `--tr-font-family-<role>-default` tokens.

## Runtime contract

A default value is **removed**, never restated: a role at its bundled default with no fallbacks clears
its family token so the generated `var(--tr-font-family-<role>-default)` applies, and the same holds for
size, weight and ligatures. A chosen stack is the chosen family, then the fallbacks, then the role's
bundled stack; a fallback on the default face keeps the bundled face first, because the bundled stack ends
in a generic family that would swallow anything after it. A bundled face chosen for the other role is
referenced by that role's first bundled family.

Application is atomic from consumers' view: every token is written first and the `data-fonts` revision on
`<html>` is published last and only when it changes, mirroring `data-theme`. `@thinkrail/ui/fonts`'s
`onFontsChange` is the subscription; xterm, Monaco, Pierre and Mermaid re-read the tokens on it. The
revision also moves when the custom faces change, since a replaced file re-measures text without any token
changing, and the face revision is published beside it as `data-font-faces`, so `watchFont` consumers
(xterm, Mermaid) re-measure a family whose name did not change. `--tr-code-row-height` is recomputed in JS (the code size × the default line height,
rounded) because CSS `round()` is missing before Safari 15.4 and Pierre's virtualizer needs a whole pixel.

Custom faces are registered as `FontFace`s from the host's versioned `/fonts/` URLs with `display: block`,
keyed by URL so a replaced file swaps its face and an unchanged one is never re-registered; they load
lazily, and a measuring consumer waits for its face through `@thinkrail/ui/fonts`' `fontsLoaded`. A custom family shadows a
same-named installed one in this document.

Probes are cached per face revision — the registry's own counter, bumped and announced through
`subscribeFontFaces` whenever a face is added or removed — because Settings renders a new custom-font
snapshot before the shell's effect has unregistered a removed face, and a probe taken in that window would
otherwise outlive the face. Token-only changes (a slider tick) keep the cache. Probes measure canvas text
against three generic families: a family "renders here" when it changes at
least one of them, and is monospaced when `i` and `M` runs match. Measurement is the authority on this
device; the host's monospace flag is only used where nothing renders. A custom file is the exception: its
parsed `post.isFixedPitch` / PANOSE flag decides, unmeasured, because the face loads lazily and Settings
lists it before it has loaded — a monospaced file that declares neither shows only in the Interface list.

`weightResponse` answers whether the weight knob can move a family on this device: it loads the family at the
body text's range (`textWeightRange` — the current body weight less the applied offset, ± the slider's
limits) and compares canvas ink at the low end, the base and the high end. Ink rather than width, because a
monospaced face keeps its advances at every weight. Both ends differing is `smooth`, one is `steps`, neither
is `fixed` — a static face with no weight between regular and bold, which CSS font matching resolves to the
same face across the whole range.

Verified in Chromium and Firefox (unit, e2e, and per-pixel weight checks); WebKit — WKWebView, WebKitGTK —
is unconfirmed for `font-weight: calc(<base> + var(--tr-font-weight-offset))` and the `FontFace` `display`
descriptor, both specified there. `sharesHostFonts()` is true in the
desktop shell and on a loopback origin, where an installed family that does not render Latin is a symbol
font rather than a missing one.

The first-paint hint (`thinkrail-fonts`, version 2) holds the preference and only the custom files it
names, in the stable preference adapter (localStorage in a browser); `initializeFonts` applies it before
React, like the theme hint. Version 1 migrates through legacy font normalization; version 2 always
normalizes as modern even if a size is absent. Unknown versions use defaults; the shell rewrites it once
the host's settings and custom-font snapshot are known. Below `FONTS_PROTOCOL_VERSION` the shell clears custom faces and applies the defaults.

The weight preview writes `--tr-font-weight-offset` directly while the slider drags; the committed value
arrives through `settings.changed`, and a failed save re-applies the last applied preference.
