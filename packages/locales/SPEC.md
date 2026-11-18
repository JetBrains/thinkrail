---
id: module-locales
type: module-design
status: draft
title: locales — UI string catalogs and the shared i18next instance
parent: architecture
references: [submodule-server-locales, submodule-web-i18n]
tags: [i18n]
---

## Responsibility

The single owner of ThinkRail's UI strings and of the rules every locale source obeys
([[architecture]] Decision 23). It ships the bundled catalogs — `en.json` is the English source of truth
and the file translators start from, and each `<tag>.json` beside it is a translation (currently
Spanish, Japanese, Polish, Russian, Simplified Chinese, and Traditional Chinese (Taiwan)) — and the pure
functions that validate a catalog, name a file's language, and pick the language to render. Its `./react`
entry holds the **one** i18next instance every browser surface (`apps/web`, `packages/ui`, extension web
halves) renders through, so they cannot drift onto separate instances.

## Public surface

- **Root `@thinkrail/locales`** (browser- and server-safe, no React; pure except the translation loader
  and its cache):
  - `EN` — the English catalog; `MessageKey` — its key union (plural suffixes `_one`/`_other`/… fold
    into the base key).
  - `BUNDLED_LOCALES` — the tags shipped with this build (`en` first, then the `TRANSLATIONS` registry);
    `loadBundledCatalog(tag)` — fetches a translation on demand, shares a download already running, and
    caches it; a network error, an HTTP error, a body that is not JSON (the host answers a missing asset
    with `index.html`) or not an object rejects as `TranslationLoadError` (original error as `cause`),
    caches nothing, and the next call retries; `bundledCatalog(tag)` — the
    catalog if already loaded (English always is). Docs and tests derive the shipped list from
    `BUNDLED_LOCALES` rather than naming it, so a new bundled language changes only its catalog, the
    `TRANSLATIONS` entry, and the README's list.
  - `SYSTEM_LOCALE` (`"system"`), `canonicalLocale(tag)`, `languageName(tag)` (own-language name via
    `Intl.DisplayNames`, first letter upper-cased), `DESKTOP_MENU_KEYS` and `DESKTOP_DIALOG_KEYS` — the keys the
    desktop's native menu, error dialogs, and startup splash render, one list each for the desktop and the web that pushes
    their translations.
  - `localeTagFromFileName(name)` — `de.json` → `"de"`, canonicalized through `Intl.getCanonicalLocales`;
    `null` for a non-`.json`, dot-prefixed, or non-BCP-47 name.
  - `validateCatalog(raw)` — `{ ok: true, strings } | { ok: false, error: "not-object" }`. The value
    must be a JSON object. Dropped, silently: non-string and empty values (English shows instead); a string
    for a known key whose `{{placeholder}}` set or indexed-markup set (`<0>`, `</0>`, `<1/>`) differs from
    English's (a plural form `key_<category>` is compared with English `key_other`, and `{{count}}` may be
    present or absent in any form, so a translator can show or omit the number); any tag that is not a
    bare indexed marker (no attributes, no named tags — a catalog must not
    override a code-owned component's props such as a link's `href`; tags are found with react-i18next's own
    quote-aware parser pattern, and a `<` followed by `{{` is rejected so interpolation can never complete a
    tag). Values containing `$t(` nesting are dropped. Unknown keys are kept as data (a file
    may be older or newer than the app); key lookups use own properties only, so `constructor` or
    `__proto__` are ordinary keys. The bundled English catalog passes this same validation.
  - `completePlurals(tag, strings)` — for every English plural family a catalog translates, fills each
    CLDR category `tag` needs (`Intl.PluralRules`) but lacks from that family's `_other` (else any
    present form), so a partly translated counter stays in its language instead of falling back to
    English. `applyLocale` runs it on every overlay.
  - `resolveLocale(preference, available, systemLanguages)` — `"system"` walks `systemLanguages` and
    takes the first exact available tag, else its base language, else a tag written in the same script;
    an explicit tag is used only when available; otherwise `"en"`. The script level exists because a
    system locale usually carries a region the catalog does not name: `zh-Hans-CN` reaches `zh-CN`
    (both maximize to `zh-Hans`) where a base-language comparison alone stops at `zh` and misses it.
    Scripts never cross: `zh-HK` and `zh-Hant` maximize to `zh-Hant` and reach the Taiwan catalog
    `zh-TW`, never the Simplified one; without a Traditional catalog they fall through to `en`. The
    fallback chain keeps that line too: a string `zh-TW` lacks falls back through `zh`, which names no
    bundled catalog, to English, not to Simplified Chinese.
  - `baseLanguage(tag)` and `fallbackChain(tag)` (`[tag, base, "en"]`, deduped).
- **`@thinkrail/locales/react`** (browser): the initialized i18next instance (`i18n`), `useT()` — the
  `Translator` for render, a value that is **replaced whenever the language or its strings change** (a
  `useSyncExternalStore` subscription), so anything computed from it, including React Compiler caches,
  recomputes; `localeOf(t)` — the language a translator was issued for, for `Intl` formatting at render;
  `currentTranslator()` / `t` / `currentLocale()` — the same, read at call time, for event-time code only
  (handlers, effects, store actions, toasts); `<T>` (react-i18next `Trans` driven by `useT()`'s translator;
  it escapes interpolated values before markup is parsed and unescapes text nodes after, so a value such as
  a branch named `feature/<b>x</b>` renders literally); and `applyLocale(tag, overlays)` which loads any
  bundled catalog the fallback chain still lacks, then removes and re-adds `bundled ∪ overlay` for every
  chain member (so a deleted overlay's strings disappear), switches language and publishes the new
  translator. It applies before returning when nothing in the chain needs loading. An overlay outside the
  chain is installed without its bundled catalog, which loads on the apply that selects it. A call that a
  newer one superseded installs nothing. If a catalog fails to load, it applies what it has, switches to the
  first chain language that has strings (an empty overlay has none; English covers the gap), and rejects;
  a later apply retries the download. i18next runs with `load: "currentOnly"` and the explicit `fallbackChain`, so it consults exactly
  `tag → base → en` (never an unlisted script fallback).

## Format

Flat i18next JSON v4: one level of `"dotted.named.key": "text"`; `{{name}}` interpolation;
`key_one`/`key_other` (and other CLDR categories) plurals resolved through `Intl.PluralRules`; `<0>…</0>`
indexed markup only for `<T>` strings. No metadata block. The instance runs with `keySeparator: false`,
`nsSeparator: false` and `escapeValue: false` (React escapes); a live file edit re-renders because
`applyLocale` publishes a new translator. It initializes **synchronously with English at import**, so any surface — including tests with
no setup — renders English.

Keys are named by surface (`settings.language.title`, `chat.composer.placeholder`), never English text: a
wording fix must not orphan translations. `en.json` stays sorted; a bundled translation holds a sorted
subset of its keys plus the CLDR categories its language needs that English lacks (Spanish adds `_many`),
so the files diff cleanly.

## Boundary

- **Allowed deps:** none in the workspace; external `i18next`, `react-i18next` (`./react` only), `react`
  (peer).
- **Consumers:** `apps/web`, `packages/ui`, `thinkrail-extensions/*/web` (both entries);
  `packages/server` and `apps/desktop` (root only).
- **Forbidden:** wire types, transport, stores, file-system access (the host reads files), any
  knowledge of where local files live.

## Get right

- English output is the contract tests pin: a catalog edit that changes English wording is a product
  change, reviewed like one. Plural pairs carry real English singulars (`"1 group"`, never `"1 groups"`).
- **A bundled translation is partial by design and guarded by a test, not at runtime.** A string it lacks
  renders English through the chain, so it can ship incomplete and fill in later. The Russian catalog
  covers all four CLDR categories for its plural families but not every key — the search palette's and
  its command and keyboard strings are deliberately English for now, and a few newer strings lag; a new
  key lands in `en.json` first and is translated in Russian in the same change unless its feature is left
  English on purpose. The loader validates a downloaded body with `validateCatalog`, which
  rejects a non-object, and `completePlurals` runs only on local files, so a catalog test requires every bundled translation to pass `validateCatalog`
  with nothing dropped, to hold only sorted `en.json` keys — plus a plural form for a category English
  lacks when the language needs one — and to carry every plural form its language needs. Changing an
  English string's placeholders or markup, or removing a key, therefore fails in the same change, and
  that change updates or deletes the translation (deleting falls back to English). A rewording that
  changes the meaning deletes the translation too, rather than leaving it stale.
- **Only English is in the startup bundle.** Each translation is a JSON asset (`new URL(…,
  import.meta.url)`) fetched on demand, so a user downloads only the one they pick. Never `import()` it:
  Chromium caches a failed module import per URL, so a failed chunk could not retry without a reload. Never
  value-import a translation catalog statically: one such import pulls every user's startup cost back up.
- **A literal the user must type stays verbatim.** A protocol answer, JSON key, flag, or command quoted
  inside translated prose keeps its exact spelling: OpenSSH accepts only `yes` for a host key, so
  `panels.prSetup.hostKeyHint` keeps `yes` in every catalog — a translated «sí» makes ssh re-prompt and
  the push stays broken. Translate the sentence, never the token.
- **Render reads the translator as a value, never the global.** The React Compiler caches each render
  expression by its own inputs, so a helper that reads the global `t` / `currentLocale()` (or a getter
  that does) keeps the old language after a switch. Every function evaluated at render — component and
  hook bodies, their `useMemo` / `useState` initializers, `.map`-style callbacks, store selectors, and
  every helper they reach — takes `useT()`'s `Translator` as a parameter (`layoutTabName(t, tab)`,
  `relativeTime(t, ms, now)`), and catalog-labelled data carries keys (`ResourceRenderer.labelKey`,
  `MCP_STATE_KEY`) that consumers translate. `check:i18n` enforces this with a typed reachability check.
  Rejected: remounting the app on a language change — it discarded unsent attachments and plan input and
  re-ran lifecycle effects such as terminal attachment, which can take a terminal from another client.
- Persisted or wire identifiers never carry translated text. Defaults are stored language-neutral and
  worded at render: built-in layout preset names; an untitled chat stores an empty name; a default
  terminal stores the pattern `Terminal N` (its title is shared through the host with other clients, so
  numbering reads the pattern back); Changes / diff tab names derive from their scope; a plan document
  stores the raw chat name; the host-named default workspace keeps `DEFAULT_WORKSPACE_NAME`; chat turns
  carry kinds (the round closer, a failure's `error` / `truncated` kind) rather than English text, while a
  provider's or agent's own message is shown verbatim. Markers matched on save (MCP's hidden-value
  placeholder) stay literal.
- Placeholders never use an i18next option name (`count` aside): `t()` consumes `ordinal`, `context`,
  `lng`, … as options — `{{ordinal}}` switched a terminal-group label to ordinal plural rules and rendered
  its raw key. A catalog test rejects such names.

## Russian terminology

`ru.json` follows one glossary: git operations and GitHub entities stay Latin as in git, established
loanwords decline as Russian words, ThinkRail concepts stay Russian.

| English | Russian |
|---|---|
| push, pull, fetch, merge, rebase, squash, cherry-pick, stash, pull request, worktree, diff | Latin, indeclinable: «Push: {{count}} коммит», «Squash и merge», «Создать merge-коммит»; a merged PR is «принят» |
| commit (noun / verb), uncommitted | «коммит» (declined), «сделать коммит», «незакоммиченные изменения» / «Не закоммичено» |
| branch; workspace; workbench; checkout (working copy) | «ветка» (never «ветвь»); «рабочая область»; «рабочая зона»; «рабочая копия» |
| prompt / request | «промпт» / «запрос» |
| clone, remote, revert, hunk | «клонировать», «удалённый репозиторий» / «Удалённые», «отменить изменения в файле», «фрагмент» |

A Latin verb does not conjugate: buttons and menu items use the bare term («Push», «Merge в {{base}}»),
sentences wrap it («выполнить push», «после merge», «выполняется push»). Never write a Russian-row
term in Latin or give a Latin term an English plural («В этой branch нет commits», «Выполнить clone»,
«worktrees»).

## Deferred

Locale-aware number formats (token counts, cost and context percentages still use English separators),
composite phrases that embed a translated count fragment (`chat.trust.untrustedNotice` interpolates a "1
skill" list), RTL layout (`dir`), a first-paint locale hint (until the host answers and the translation
loads, a non-English language renders English for a moment), and translating server error text (errors would
move to codes the client renders).
