---
id: submodule-web-i18n
type: submodule-design
status: draft
title: i18n — active language and local catalogs in the web client
parent: module-web
depends-on: [module-locales, module-contracts]
tags: [i18n]
---

## Responsibility

Turns the synced `AppConfig.locale` preference, the browser's languages, the bundled catalogs, and the
host's local files ([[submodule-server-locales]]) into the one active language of the shared i18next
instance ([[module-locales]] `./react`). Components never do this themselves: they call `useT()`.

## Boundary

- **Hydration:** `transport` reads `locales.list` after each welcome from a v89+ host and again on every
  `locales.changed` nudge, installing the snapshot with `installLocalLocales` (an older host installs
  `null`, so only bundled languages exist). This module only derives from the store.
- **Owns:** the `languageOptions` derivation (System + every available tag with its own-language name via
  `Intl.DisplayNames` and its source: `builtin`, `local`, `builtin+local`, or a broken/missing entry),
  the effective-tag derivation (`resolveLocale` over the browser's `navigator.languages`, re-read on
  `languagechange`), and the one apply effect — install overlays, switch language, set `<html lang>`,
  push the desktop menu and dialog labels through the optional `__THINKRAIL_NATIVE_MENU__` bridge (`pushNativeMenuLabels`).
- **Public surface (barrel):** `useLocaleSync()` (mounted once by `main.tsx`'s `App`),
  `useSystemLanguages()`, `localeSignature`, `retryLocale()`, and the pure `languageOptions`,
  `effectiveLocale`, `availableLocales`, `localOverlays`.
- **Allowed deps:** `store`, `@thinkrail/locales`, `@thinkrail/contracts` (types).
- **Forbidden:** rendering UI (the Language page lives in `panels`), reading files, a second i18next
  instance.

## Get right

- **Apply only on a real change.** The effect applies when `localeSignature` — the effective tag plus the
  strings of exactly its fallback chain — changes; an unrelated file's edit or a repeated `locales.list`
  does nothing. Applying publishes a new translator, so every component rendering through `useT()`
  re-renders and recomputes ([[module-locales]] § Render reads the translator as a value).

- English is installed synchronously before first paint, so nothing renders keys while the host
  connects; a bundled translation file and local strings arrive later and re-render in place. When an
  apply settles, `<html lang>` and the desktop labels follow `currentLocale()`, the language that really
  renders: after a failed download, the first chain language with strings (English unless a local file
  covers it). The next language or catalog change retries the download, and so does `retryLocale()`,
  which the Language page calls when the already selected row is clicked again. `useLocaleSync` leaves the
  rejection unhandled on purpose, so the global unhandled-rejection reporter sends it to error tracking as
  `TranslationLoadError`.
- A selected local tag that disappears (file deleted, now broken, or a host without
  `LOCALES_PROTOCOL_VERSION`) renders English while the preference stays untouched, and returns when the
  file does.
- Dates and numbers use `currentLocale()`, never a hardcoded `"en-US"` or the bare browser default.
