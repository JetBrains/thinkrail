---
id: submodule-web-fonts
type: submodule-design
status: active
title: Client-local font preferences
parent: module-web
references: [web-typography, module-ui]
---

## Responsibility

Own three independent client-local family preferences: interface, code and terminal. Empty names mean
the generated default; names are single installed families, not CSS stacks or remote URLs. They are
trimmed, bounded to 200 characters, reject control characters and commas, and are quoted/escaped before
use. Font existence is intentionally not inferred: browser font detection is unreliable for fallback
and missing glyphs; the UI explains the native CSS fallback instead.

Initialization runs before React, snapshots the generated default family tokens, restores the versioned
preference and applies it. Runtime writes prepend only the selected family, retaining each original
fallback stack; reset removes the override. Tokens are updated before publishing `data-fonts` on the
root. CSS consumers inherit directly; strict consumers use `@thinkrail/ui/typography`'s `onFontChange`
and read the tokens, without depending on this module. Only family changes publish the signal.

## Boundary

The `index.ts` barrel exposes the preference types, validation, read/subscribe/update and initialization
seams. A single external snapshot owns client preference state. Settings use `useSyncExternalStore`;
the host-synchronized app store and wire carry no font preference.

Persistence uses the existing native stable-preference adapter when injected, otherwise origin-local
localStorage. The preference applies to this client across projects, not all devices connected to the
host. Malformed or inaccessible storage restores defaults without blocking boot; failed writes still
apply in memory and return a failure for the settings notice. No font enumeration, import, font-size or
ligature control is provided.
