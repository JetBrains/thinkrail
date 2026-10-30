---
id: web-typography
type: submodule-design
status: active
title: ThinkRail typography — one JSON source, generated CSS, semantic styles
parent: module-web
---

# Typography system

**`styles/typography.json` is the sole source of truth for typography.** Every font family, size,
weight, line-height, letter-spacing, transform and semantic text style lives there; the CSS the app
ships is *generated* from it. No component may declare a typography value, no hand-written utility may
add one, and no other file may hold an alias onto one — change the type of anything by editing the JSON.
The few [user-adjustable tokens](#user-adjustable-tokens) take their **defaults** from it too; the user's
font settings override them at runtime, and only on `:root`.

```
styles/typography.json            the source (see typography.schema.json for the shape)
styles/typography.schema.json     the editor-facing contract: primitives + fully-resolved styles
scripts/typography.ts             load / validate / render — the only place CSS names are derived
scripts/generate-typography.ts    writes the CSS; `--check` fails when it is stale
scripts/validate-typography.ts    the enforced gate: shape + referential + policy validation
styles/generated/typography.css   GENERATED, committed, never edited by hand
```

| Command | What it does |
|---|---|
| `bun run typography:generate` | regenerate `styles/generated/typography.css` |
| `bun run typography:validate` | validate the JSON (shape, references, policies) |
| `bun run typography:check` | fail if the committed CSS is stale or adoption violates the token contract — pre-commit + `apps/web build` |

`bun test` also runs the guard rails: `styles/typography.test.ts` (source + generated output) and
`styles/typographyUsage.test.ts` (adoption across app source, `packages/ui`, and every extension web
half, using the shared source scanner). `e2e/typography.spec.ts` asserts *computed* styles on the
real surfaces (hero, dialog/card titles, entity rows, branch metadata, eyebrow, Monaco, xterm, Pierre,
both markdown surfaces, the `<body>` base) and that each user-adjustable token reaches exactly the
surfaces it governs.

> **On the schema.** `typography.schema.json` is the contract an editor reads via `$schema` — it gives
> completion and inline errors while you edit. It is **not** the gate: there is no JSON Schema validator
> in the toolchain, and the shape checks plus every policy below are implemented in
> `scripts/typography.ts` → `validate()`. Change one and check the other.

## Primitives vs semantic styles

**Primitives** are the raw vocabulary — flat id → value maps. They are the only numbers in the system:

| Group | Ids |
|---|---|
| `fontFamilies` | `interface` (Geist Variable, all proportional UI + reading text) · `code` (JetBrains Mono Variable, code only; both `userSelectable`, `code` with `ligatures: none`) · `brand` → **Orbitron Variable** (self-hosted `@fontsource-variable/orbitron`, a distinct display face for the brand role — `wordmark` + `hero`; it was formerly a `$ref` to `interface`). Orbitron is **latin-only** and `brand.hero` renders a project's own name, so the stack falls back to the *interface* face before any system font — a non-Latin name lands on Geist (cyrillic/latin-ext/vietnamese, already bundled) rather than on whatever the OS supplies |
| `fontWeights` | `light` 370 · `regular` 400 · `medium` 500 · `semibold` 600 · `brand` 400 · `button` 470 — the bases the weight offset shifts (`fontWeightOffset.exclude`: `brand`) |
| `fontSizes` | `s10` `s11` `s12` `s13` `s14` `s16` `s18` `s20` `s24` `s44` (px); `codeSize` names the code size (`s13`) |
| `lineHeights` | `compact` 1.25 · `metadata` 1.25 (12px→15px) · `ui` 1.3 (14px→18.2px) · `code` 1.4 · `relaxed` 1.4 (13px→18.2px) · `default` 1.3 (14px→18.2px) · `reading` 1.45 (14px→20.3px) |
| `letterSpacings` | `normal` · `loose` 0.02em · `wide` 0.05em · `widest` 0.1em · `brand` 0.5px |

The leading scale is deliberately **dense** (1.25–1.4): Geist’s x-height at 14px is 7.4px (cap height 9.9px), so
the former 1.5–1.6 left an empty band between lines taller than the letters themselves — it read as
near double spacing. Reading prose — `body.reading`: chat, user messages, documents — is the deliberate exception at
`reading` 1.45: at the dense value long replies read as a compressed wall, so reading text keeps more leading
than UI chrome. Monaco and the Pierre diff surface read `--tr-line-height-default` and stay dense; both use a whole-pixel code row (Pierre's virtualizer needs the exact row height). `codeRow` in `typography.json` names its font size — the default dense code size — and line height, and the generator emits the pre-rounded `--tr-code-row-height`, which Pierre's CSS and its virtualizer both read, because CSS `round()` is missing before Safari 15.4. Values are short exact decimals on purpose: the production minifier rounds custom properties to
five decimals, so a repeating ratio such as 18/14 can never land on a whole pixel (it shipped as `17.9999px`).

**Semantic styles** are what components use. Each names seven primitive references and nothing else, so
it resolves deterministically — there is no inheritance, no per-usage branching, no fallback:

```json
"title": { "dialog": {
  "fontFamily": "interface", "fontSize": "s14", "fontWeight": "semibold",
  "lineHeight": "compact", "letterSpacing": "normal",
  "textTransform": "none", "fontStyle": "normal"
} }
```

A style may instead be an **alias** — `{ "$ref": "title.dialog" }` — meaning *identical to that style*.
The rules, all enforced by `typography:validate`:

- a **canonical definition** carries the complete set of seven values;
- an **alias** carries `$ref` and nothing else;
- a `$ref` must name a **canonical definition** — never another alias, so **chains are forbidden** and
  resolution is one direct lookup;
- a missing target, or a `$ref` pointing at itself, is rejected;
- **two canonical definitions may not hold identical values** — that is a missing `$ref`;
- aliases still emit their own semantic CSS class, so `.tr-title-card` and `.tr-title-dialog` are
  separate classes backed by one definition.

`textStyles` groups: **brand** (`hero` — the Welcome text identity; the shell logo is supplied vector
artwork) · **heading** (`xl`, `lg`, `md`, `sm` — the shared document heading scale) · **title**
(`dialog`, `card`→dialog, `section`, `compact`, `entity`→body.reading)
· **ui** (`default`, `metadata`, `eyebrow`, `labelPill`→eyebrow, `caption` — the 10px/compact uppercase
badge and tile-initial style (row status badges, the topbar project initial), where `eyebrow`'s 18px line would
not fit, `action`→title.compact, `button` — the shared button label, `ui.default` one weight step heavier, `emphasis`→title.compact) · **body** (`reading`) · **code** (`text` — the base 13px inline code style, `block` — fenced code at the user's code size, `editor` — code at the dense editor size, `document`, `otp`, `textSmall` — an 11px code style for
inline code in table cells). `proseSystems` holds one entry per markdown surface, almost entirely aliases
into the above. Dead aliases are not retained: prose points directly to the semantic style it uses.

**23 canonical definitions + 30 aliases = 53 styles.**

One prose rule is deliberately *not* a semantic style: `<strong>` / `<b>` gets **weight only**
(`--tr-font-weight-medium`), emitted by the generator into each prose system. A complete style there
would override the size and line-height of whatever element the bold text sits inside.

The JSON holds **no** CSS selectors, class strings, component paths, usage lists, rationale or audit
data. Rationale lives in this file.

## The `<body>` base

`rootStyle` is the typography of text that carries no semantic class — and it is **a `$ref`, never
values** (today `{ "$ref": "ui.default" }`, so 14px/370 interface with a 20px line height). The generator emits it as a
`body { … }` rule inside `@layer base`, which puts it *below* every semantic class in the cascade: it is
a floor, never something a component relies on.

Why it matters that it is a reference: while the base held its own numbers, unclassed text rendered at a
size no semantic style named, so a class name that silently stopped resolving looked plausible instead of
obviously wrong. `styles/global.css` therefore declares **colour and rendering only** — no family, size,
weight or line-height.

Tailwind's preflight defaults (`--font-sans` / `--font-mono` in `index.css` `@theme inline`) point at the
same generated tokens, so even an element the system has not reached — a bare `<pre>` — renders in a face
the system chose. The `font-sans` / `font-mono` utilities that mapping also enables are banned at call
sites.

## How components consume it

The generator derives one class per semantic style, mechanically:

| Source id | Generated class |
|---|---|
| `brand.hero` | `.tr-brand-hero` |
| `heading.xl` · `heading.lg` · `heading.md` · `heading.sm` | `.tr-heading-xl` · `.tr-heading-lg` · `.tr-heading-md` · `.tr-heading-sm` |
| `title.dialog` · `title.card` · `title.section` · `title.compact` · `title.entity` | `.tr-title-dialog` · `.tr-title-card` · `.tr-title-section` · `.tr-title-compact` · `.tr-title-entity` |
| `ui.default` · `ui.metadata` | `.tr-text-ui` · `.tr-text-metadata` |
| `ui.eyebrow` · `ui.labelPill` · `ui.caption` · `ui.action` · `ui.button` · `ui.emphasis` | `.tr-text-eyebrow` · `.tr-text-label-pill` · `.tr-text-caption` · `.tr-text-action` · `.tr-text-button` · `.tr-text-emphasis` |
| `body.reading` | `.tr-text-reading` |
| `code.text` · `code.block` · `code.editor` · `code.document` · `code.otp` · `code.textSmall` | `.tr-code-text` · `.tr-code-block` · `.tr-code-editor` · `.tr-code-document` · `.tr-code-otp` · `.tr-code-text-small` |
| `proseSystems.<id>.*` | `.tr-prose-<id>` + one element selector each |

Primitive tokens are also emitted as custom properties — `--tr-font-family-code`,
`--tr-font-size-code-dense`, `--tr-line-height-default`, … — for the surfaces that cannot use a class.

**Cascade layers.** Three levels, all deliberate: the token block is unlayered (custom properties have
nothing to compete with), the `<body>` base sits in `@layer base`, the semantic classes in
`@layer components`. Tailwind v4 orders its layers `theme, base, components, utilities`, so a semantic
class beats the base while a Tailwind utility at a call site still overrides the single property it names
— that is what keeps `italic` and `leading-tight` / `leading-snug` working next to a semantic class.
Emitting the classes unlayered would outrank every utility and silently win instead.

Rules at a call site:

- **Typography = exactly one semantic class.** Never compose `font-*`, `text-<size>`, `tracking-*` or
  `uppercase`. The exceptions are `italic` and `leading-*`: a call site may add one to override that
  single property (see *Cascade layers*), which is why a few rows and empty states carry them.
- **Colour stays at the call site**, as a semantic colour token (`text-text-muted`,
  `text-text-subtle`, conditional actives) — see [COLOR.md](./COLOR.md). Active/selected state is a
  **colour** change — never a weight change.
- **`<pre>` and `<code>` always name a style**, even inside a container that already has one. Preflight
  targets those elements directly, and a directly-matching rule beats an inherited family, so a bare
  `<pre>` renders in a *different* mono face from its `tr-code-text` parent. Pinned by
  `typographyUsage.test.ts`.
- Spacing, truncation, layout, hover and state classes are unaffected.

```tsx
<span className="tr-text-eyebrow text-text-muted">Projects</span>
<h2 className="tr-title-dialog text-text-default">{title}</h2>
<code className="tr-code-text text-text-subtle">{command}</code>
```

**When the element is not yours.** A third-party component that renders its own inner DOM (cmdk's group
heading) cannot be given a class through an arbitrary variant — `[&_[x]]:tr-text-eyebrow` produces
nothing, because Tailwind silently drops class names it does not know. Pass a node instead
(`heading={<span className="tr-text-eyebrow">Remote</span>}`), or leave the element to the `<body>` base.
`typographyUsage.test.ts` fails on any `tr-` class the generator does not emit, which is how that whole
failure mode is caught now.

## The prose systems

Markdown renders through `proseSystems`: one entry per surface, each owning the **same fixed element
set** (validation rejects a system that is missing one, or that adds an element with no selector), each
naming its own type. Two exist:

| | `chat` (`.tr-prose-chat`) | `doc` (`.tr-prose-doc`) |
|---|---|---|
| mounted by | `chat/Markdown.tsx` | `resource-renderers/support/MarkdownPreview.tsx` |
| body, blockquote, lists | 14 / 370 / 1.45 | 14 / 370 / 1.45 |
| h1 | 18 / 600 | **24 / 600** |
| h2 | 14 / 600 | **20 / 600** |
| h3 | 12 / 600 | **18 / 600** |
| h4 | 12 / 500 | **16 / 600** |
| h5 | 12 / 500 | 14 / 600 |
| h6 | 10 / 500 uppercase | 12 / 600 uppercase |
| inline code | 13 mono | 13 mono |
| fenced code | code size (13) mono / 1.4 (`code.block`) | code size (13) mono / 1.4 (`code.document`) |
| table body / header | 12 / 370 · 12 / 600 | 14 / 370 · 14 / 600 |
| table cell inline code | **11 mono / 1.5** (`code.textSmall`) | 13 mono (`code.text`) |
| `strong` / `b` | weight 500 only | weight 500 only |

**Why two.** A chat bubble is a stream of short messages: headings there are separators, and a 24px h1
inside a bubble shouts. A rendered file is a document: its headings have to be visibly larger than its
paragraphs or the structure disappears. One shared scale cannot be both — with body copy at 14px and a
compact scale, four of six heading levels land at or below body size, which is what the `doc` system
exists to fix. Validation enforces it: `doc.h1`–`doc.h4` must each be **larger than `doc.body`**, and the
ladder h1→h6 must never invert. `h5` sits at body size and `h6` below it, both semibold and `h6`
uppercase — the convention every markdown renderer settles on, since documents essentially never nest
that deep.

The two systems share their canonical definitions: `chat.h1` and `doc.h3` are both `{ "$ref":
"heading.md" }`, body copy everywhere is `body.reading`. Only 3 of the 28 prose entries are canonical
definitions of their own.

`strong` / `b` gets **weight 500 only** in both systems — family, size, line-height, tracking, transform
and colour inherit from the enclosing element, so bold in a heading keeps the heading's size and bold in
a cell keeps the table's.

A "prose skin" at a call site carries only spacing, measure and chrome (`chat/Markdown.tsx` = bubble
rhythm, `resource-renderers/support/MarkdownPreview.tsx` = document rhythm, heading rules, table chrome). Never add a
typography class or value to a skin; change `proseSystems` instead. Adding a third surface means adding a
JSON entry — the generator, the naming and the guards all follow.

## Fonts

Self-hosted variable faces. The packages are declared per family as `selfHosted` in the JSON and
`styles/generated/fonts.css` is emitted from them (`@fontsource-variable/geist`,
`@fontsource-variable/jetbrains-mono`), fingerprinted into `dist/assets` and embedded in the binary —
**no font CDN**, so an offline host renders the real system. Both faces are variable, so 800 and
italics are real, not synthetic. Pinned by `e2e/fonts.spec.ts`.

**Swapping a family is a one-file change**: edit the family's `stack` + `selfHosted` here, `bun add` the
new package, `typography:generate`. No face name is written anywhere else — the tests read it back from
the generated output (`e2e/fixtures/typography.ts`), and `validate` rejects both a `selfHosted` package
that is not a dependency and a font dependency no family claims. The one other copy of the stacks lives
in `apps/website` (a standalone leaf that cannot import ours); `apps/website/src/fonts.test.ts` fails
when it drifts from this file.

`tokens.css` holds **no typography at all** — not a value and not an alias. It used to carry `--font`,
`--font-mono`, `--font-accent`, `--font-mono-size` and `--line-height` as aliases onto the generated
tokens; every one of them is gone, because a second name for a value is the thing that drifts. The
consumers that cannot use a class read the `--tr-*` tokens directly. Cabinet Grotesk is retired
repo-wide and must not return.

## User-adjustable tokens

The user's font settings (the host's `AppConfig` font fields) change type through a fixed set of
custom properties. The generator emits each with the JSON's default; **only the web `fonts`
module (`apps/web/src/fonts`) writes them, only on `:root`, and only these** — components never set a
typography value; the font picker's preview rows are the one [permitted exception](#permitted-exceptions).
`typographyUsage.test.ts` pins the writers by name.

| Token | Default (JSON) | Reaches |
|---|---|---|
| `--tr-font-family-interface` | `var(--tr-font-family-interface-default)` (`userSelectable`) | every interface style, the `<body>` base, preflight |
| `--tr-font-family-code` | `var(--tr-font-family-code-default)` (`userSelectable`) | every code style, Monaco, xterm, Pierre, mermaid, preflight |
| `--tr-font-size-code` | `var(--tr-font-size-s13)` (`codeSize`) | fenced code in both prose systems (`code.block`, `code.document`), the terminal |
| `--tr-font-weight-offset` | `0` | every weight primitive but `fontWeightOffset.exclude` (`brand`): `calc(<base> + offset)` |
| `--tr-font-ligatures-code` | `none` (`fontFamilies.code.ligatures`) | `font-variant-ligatures` of every style on the code family; Pierre via `.pierre-code-surface` |
| `--tr-code-row-height` | `14px` (`codeRow`, pre-rounded) | Pierre's rows and virtualizer; the runtime rewrites it, rounded in JS, with the code size |

Derived, never written: `--tr-font-size-code-dense` = `calc(var(--tr-font-size-code) - 2px)` (Monaco,
Pierre, `code.editor`) — the 2px is `codeSize.fontSize` minus `codeRow.fontSize`, so no number lives
outside the primitives — and the `-default` stacks, which a user stack ends in and the runtime reads the
bundled face from. Derived tokens resolve where they are declared, so an override must land on `:root`;
the family tokens are read by each style directly, which is what lets the font picker scope one on a row.
A style names the code sizes as `"fontSize": "code"` / `"codeDense"`; validation reserves those ids, `offset`
and `<family>Default`, and keeps the dense size below the code size. A JS reader gets the dense token
unresolved (`calc(13px - 2px)`), so it resolves it through an element's computed `font-size`.

- **Code size split.** Blocks and the terminal take the code size; Monaco and Pierre stay 2px smaller;
  inline code — `code.text` (13px) in prose and UI, `code.textSmall` (11px) — keeps its fixed size, so it
  stays in proportion with the text around it.
- **Ligatures default off** for every code surface (chat and document code blocks used to draw
  JetBrains Mono's); the setting turns them on. xterm never draws them.
- **Brand is fixed.** The `brand` family is not selectable and spells its interface fallback faces
  literally, and its weight is excluded from the offset, so no user setting reaches the wordmark or hero.
- **Host defaults mirror the JSON.** `DEFAULT_CONFIG`'s `codeFontSize`, `codeLigatures` and
  `fontWeightOffset` equal these defaults (the runtime writes nothing at a default); `typography.test.ts`
  pins them.

## Mono policy

`code` is for **code and technical content only**: editor and terminal text, code blocks, inline code,
diffs and technical file paths, shell commands, slash-command syntax, JSON/code editing surfaces,
keycaps, raw tool output, and the OTP exception. It is **never** used for project or workspace names,
branch or base refs, model names or ids, skill names, labels, tags, ordinary metadata or statuses —
those are proportional. Validation enforces this: a monospace family on a non-code style fails
`typography:validate`, as does a code style on a proportional family, as does a monospace `rootStyle`.
The policy governs the JSON defaults; a user may still pick a monospaced interface font at runtime.

## Weight policy

- **370** (`light`) — ordinary UI, body, entity, metadata and status text (interface family).
- **400** (`regular` / `brand`) — monospace / code text (`code.*`) and brand display text (`brand.*`).
- **470** (`button`) — the shared `Button` / `IconButton` label (`ui.button`, owned by `packages/ui`
  `buttonVariants`): the 14px interface face one weight step (+100) above ordinary UI text so an action
  label reads as an action, still lighter than titles. Call sites never set it; it travels with the button.
- **500** — non-button action text (`ui.action`), in-page section titles, compact titles, inline emphasis
  (`ui.emphasis`), uppercase labels (`ui.eyebrow`/`labelPill`), chat prose h4–h6 and `strong`.
- **600** — dialog titles, card titles, alert titles, every `heading.*`, chat prose h1–h3, document
  prose h1–h6 and table headers.

The user's weight offset shifts every one of these together (brand excepted), so the hierarchy holds.

Disabled control colors come from `control-disabled-bg` / `control-disabled-text`; disabled non-control
text uses `text-disabled`. Typography does not encode disabled state, and controls do not use opacity to
simulate it.

## Permitted exceptions

The allowlist is deliberately tiny, and each entry is enforced by name in
`styles/typographyUsage.test.ts`:

| Surface | Why it cannot use a semantic class |
|---|---|
| `resource-renderers/support/monacoSetup.ts` | Monaco takes `fontFamily` / `fontSize` / `fontWeight` / `fontLigatures` / `lineHeight` as JS options — it resolves the generated `.tr-code-editor` style through `@thinkrail/ui/fonts`' `resolveFont` (the dense size is an unresolved `calc()` token) and reads `--tr-line-height-default`, so it cannot drift from Pierre's dense rows |
| `resource-renderers/renderers/code/pierreVirtualizer.ts` | Pierre's virtualizer takes its row height as a JS metric — it reads the generated `--tr-code-row-height`, the same value `.pierre-code-surface` gives `--diffs-line-height` |
| `panels/TerminalInstance.tsx` | xterm, same reason — it resolves the generated `.tr-code-block` style (family, code size, weight) through `resolveFont`, re-reads it on `onFontsChange`, and owns row height through its own `lineHeight` option rather than a CSS line-height |
| `thinkrail-extensions/visualize/web/mermaid.ts` | mermaid's theme config takes a family string (`--tr-font-family-code`) |
| `panels/FontPicker.tsx` | each picker row draws its family in that face by scoping `--tr-font-family-interface` on the row element — the one token write outside `fonts/`, and never on `:root` |
| `index.css`, `styles/tokens.css`, `styles/global.css` | the mapping layers themselves; `.pierre-code-surface` passes the code family, the dense size, the code row height and the code ligatures (`font-variant-ligatures`, which Pierre's Shadow DOM inherits; its `--diffs-font-features` stays unset) into Pierre's Shadow DOM, and `.xterm .xterm-rows` pins `font-variant-ligatures: none`, because xterm's DOM renderer joins same-styled cells into one text run and the terminal never draws ligatures |

The OTP code is **not** an exception any more: it is the named `code.otp` style (`.tr-code-otp`).

## Adding or changing a style

1. Edit `styles/typography.json` — a new primitive, or a new entry under `textStyles` / `proseSystems`.
   Reuse primitives; add one only when no existing value fits. **If the style you need already exists,
   write `{ "$ref": "<that.style>" }`** rather than repeating its values — validation rejects a second
   canonical definition with identical values, and rejects an alias that points at another alias. Split
   an alias into its own definition only when the two actually diverge.
2. `bun run typography:validate`, then `bun run typography:generate`, and **commit the generated CSS**.
3. Use the generated class at the call site (colour stays separate).
4. `bun test` (source + adoption guards) and `bun run e2e -- e2e/typography.spec.ts` for computed styles.

Do **not**: add a typography utility or `--text-*` mapping to `index.css`, add a font alias to
`tokens.css`, declare a font property in a component, or edit `styles/generated/typography.css`. The
pre-commit hook and `apps/web build` run `typography:check`, so stale generated CSS cannot land.

This primitives + semantic-tokens + schema + generator shape is the pattern a **colours** JSON should
mirror; nothing here is Tailwind-specific, and Tailwind merely consumes the generated CSS.
