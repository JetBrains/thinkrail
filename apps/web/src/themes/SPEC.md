---
id: submodule-web-themes
type: submodule-design
status: active
title: themes — bundled manifest catalog and application
parent: module-web
depends-on: [module-contracts, module-design-tokens]
tags: [ui, themes]
---

## Responsibility

The browser-side theme engine: validates the bundled declarative theme manifests at bootstrap and the
user's theme files when the host reports them, owns the resulting catalog, and resolves/applies the
active palette atomically. The host owns only the opaque
fixed id plus fixed/system mode and optional light/dark pair; this module owns what those values mean on
this client, including operating-system color-scheme observation and same-appearance fallback. **Adding a
theme = adding one `*.theme.json` file** — to `bundled/` (a PR + rebuild) or, for a user, to
`~/.thinkrail/themes` (live, [[submodule-server-themes]]) — no code, contract, CSS, or test changes.

Six manifests ship: the standard **Dark** and **Light** (the configured default and its pair, unchanged),
**Minimal Dark** and **Minimal Light** (the quiet neutral surface hierarchy, restrained green accent and
neutral `bubbleAccent` of the Minimal interface study, sharing the standard pair's syntax and terminal
palettes), and the two High Contrast palettes with their stricter accessibility contract. Minimal is a
palette a user picks in Appearance and nothing more: every theme renders the same roles, so a component
never branches on the active theme or its contrast metadata to drop a fill or a border. What a palette
cannot express through the manifest keys is a product decision for all themes, not a theme.

## Boundary

- **Owns:** catalog construction (bundled + user) and fixed/system resolution; user-theme validation, its per-file issue
  list and its client-side cache; deterministic pair derivation and same-appearance fallback;
  operating-system color-scheme reads/subscription; the atomic theme switch (palette via the package's
  `applyPalette`, then `[data-theme]`); the versioned first-paint preference hint; Shiki's generic CSS-variable TextMate
  scope map; and the hex resolver + Monaco colour-key map that adapt that same definition for the strict
  desktop editor API.
- **Public surface:** `index.ts` only — `initializeThemes` (the synchronous bootstrap: bundled
  catalog plus cached user themes), `installUserThemes` / `clearUserThemes` / `getUserThemeIssues` /
  `onThemesChange` (the live user-theme catalog and its `UserThemeIssue` list),
  `applyTheme` / `resolveTheme`, preference-aware `applyThemePreference` /
  `resolveThemePreference`, `deriveSystemThemePair`, `readSystemAppearance`,
  `onSystemAppearanceChange`, `getThemes`, `readThemeHint` /
  `writeThemeHint`, and the manifest/descriptor/preference-result types plus the Shiki registration and its
  `resolveThinkrailShikiTheme` strict-consumer adapter.
- **Allowed external deps:** `@thinkrail/contracts` for the opaque ids, theme preference shapes and
  configured default; `@thinkrail/design-tokens` for the manifest contract, the bundled sources and
  `applyPalette`; browser DOM/media/storage APIs; Shiki types only, to type
  the generic registration.
- **Forbidden:** server/shared/pi; store, transport, panels, shell, or component state; reading files or
  discovering themes itself (user files arrive only through `installUserThemes`); executable theme code;
  selectors/layout or arbitrary CSS supplied by a manifest.

## Manifest contract

The `*.theme.json` manifest format, its schema evolution rule, the palette→variable naming, the
legibility floors and the bundled set are owned by [[module-design-tokens]]
(`packages/design-tokens/SPEC.md`). This module consumes them through that package's barrel.

**User theme files are held to the same schema but fail soft.** Each file is validated on its own; an
unusable one becomes a `UserThemeIssue` (the host's read codes, `invalid-theme`, `id-too-long`, or `duplicate-id`
between two user files) and the rest still load. The legibility and AAA gates above are merge gates for
our files and are deliberately not applied to user files — their contrast is the user's choice. The
user's file name carries no meaning; the id inside it does.

**User ids live in their own namespace.** The catalog id of a user theme is `user.<manifest id>` (so the
manifest id is at most 59 characters), and a bundled manifest may never use the `user.` prefix. Ids
persist in `AppConfig.theme` and the system pair, so the namespace is what keeps both sides free to
grow: a file copied from `dark.theme.json` without renaming its id is simply `user.dark`, never
shadowed by or shadowing the bundled Dark, and a theme we bundle later under any name can never
silently capture a user's saved choice. Rejected: reserving bundled ids per name (a new bundled theme
would turn an existing user theme into an error and re-point its saved config to ours) and requiring
authors to write the prefix themselves (the common copy-and-edit path would fail).

## Runtime contract

`initializeThemes` runs pre-React in `main.tsx`; after it, only `installUserThemes` changes the catalog
(the bundled set is fixed until a rebuild). The shell installs each host snapshot before re-applying the
preference; re-applying republishes `data-theme` even for an unchanged id, so an edited active theme
rebuilds Monaco/xterm like a swap. Writing the first-paint hint also caches the user manifests that
preference names (the fixed id and both pair slots — at most three, never the whole folder), and
`initializeThemes` installs them, so a user theme paints on first frame instead of flashing the default
before the host answers; the next snapshot replaces them, and a welcomed host below the user-theme
protocol clears them (`clearUserThemes`). A cache value over 64 K characters is dropped rather than
written, trading a first-paint flash for staying well inside the desktop per-value cap. The bound matters on desktop, where this cache
shares the native preference store's per-value and whole-document caps with every other preference. Deleting the active theme's file resolves
like any unavailable id below. Fixed mode resolves `AppConfig.theme`. System mode reads
`matchMedia("(prefers-color-scheme: dark)")` and resolves that appearance's configured slot; a missing,
failing, or non-matching media API means light. The query is the one cross-platform path for ordinary
browsers and native system webviews on Windows, Linux, and macOS—there is no native appearance branch and
`prefers-contrast` is deliberately ignored.

A configured system slot is usable only when its manifest exists and declares the required appearance.
Otherwise resolution keeps the opaque host value intact and chooses the lowest-order normal manifest of
that appearance, then the lowest-order manifest of that appearance, with label/id tie-breaking. On first
enable, the resolved fixed theme fills its own slot; the opposite slot chooses the lowest-order theme with
matching contrast, then the same normal/any fallback. A persisted pair is reused on later enables.
Every fallback and derived opposite slot is chosen from the **bundled** manifests only — the ones that
passed the contrast gates — so a user theme that happens to sort first (a copy of Dark at order 10
labelled "Arctic") never becomes the theme a user did not pick.

Application is atomic from consumers' perspective: write the complete variable set, `color-scheme`, and
semantic contrast metadata, then publish the effective manifest id through `data-theme` last, so generic
consumers (Monaco/xterm/mermaid) can rebuild after that signal without observing half a palette.
The catalog-independent `onThemeSwap` subscription lives in `@thinkrail/ui/theme`; app and extension
consumers use it rather than hand-rolling MutationObservers. Theme selection and application stay here.
Selected-text foregrounds are removed when their manifest values are `null`. In system mode one media-query
listener reapplies locally on `change`; it never writes config or affects another client, and its owner must
clean it up when preference or component lifetime changes.

The first-paint hint is a versioned snapshot of fixed id, mode, and optional pair—not the last effective
id. A legacy string parses as fixed mode; malformed data becomes the fixed Dark default. Startup resolves
the snapshot synchronously against the current media query, so a schedule change while the app was closed
is reflected on first paint. The host-synced config always reconciles it after the first welcome; until
then the shell retains and observes the hint instead of overwriting it with store defaults. Storage uses
the native shell's already-injected stable preference adapter when present and localStorage otherwise,
which survives Electrobun's changing loopback origins without giving the launcher theme semantics.

Shiki uses one web-only TextMate registration whose colors are semantic CSS variables (an explicitly
supported Shiki mode). Chat consumes that registration directly and needs no re-highlight. Monaco passes the
same registration through `resolveThinkrailShikiTheme`, which canonicalizes every available CSS variable to
hex, omits an unavailable value so Monaco's inherited base remains usable, and attaches the token-owned editor
UI map; the panel supplies `cssColorToHex` so themes retain no dependency back into `lib`. Monaco picks its
base from appearance/contrast metadata, never a known theme id, and replaces the resolved registration under
one fixed name after an atomic theme swap. Thus adding a theme never adds a Shiki import, CSS selector, or
editor-specific catalog entry. Unit coverage pins exact and wrong-appearance resolution, both fallback tiers,
pair derivation, absent-signal light behavior, legacy/versioned hints, media-listener cleanup, and complete
hex resolution of the shared syntax map.

## Deferred

Open, not excluded: partial overlays or inheritance from a bundled theme, import of external formats
(shadcn/tweakcn CSS, VS Code themes), extension-packaged themes (the seam is a source tag on the same
`themes.list` files, filtered by the existing extension switch), an in-app editor, and contrast warnings
for user themes. Until then a user theme is one complete manifest.

## Non-goals (deliberate)

A user theme never replaces or shadows a bundled one — the `user.` namespace above is the decision.
Operating-system contrast following and schedule/time-zone UI are out of scope.
