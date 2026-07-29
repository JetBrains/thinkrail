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
ships is *generated* from it. No component may declare a typography value, and no hand-written utility
may add one.

```
styles/typography.json            the source (validated by typography.schema.json)
styles/typography.schema.json     the contract: primitives + fully-resolved semantic styles
scripts/typography.ts             load / validate / render — the only place CSS names are derived
scripts/generate-typography.ts    writes the CSS; `--check` fails when it is stale
scripts/validate-typography.ts    schema + referential + policy validation
styles/generated/typography.css   GENERATED, committed, never edited by hand
```

| Command | What it does |
|---|---|
| `bun run typography:generate` | regenerate `styles/generated/typography.css` |
| `bun run typography:validate` | validate the JSON (schema, references, policies) |
| `bun run typography:check` | fail if the committed CSS is stale — pre-commit + `apps/web build` |

`bun test` adds the guard rails: `styles/typography.test.ts` (source + generated output) and
`styles/typographyUsage.test.ts` (adoption). `e2e/typography.spec.ts` asserts *computed* styles on the
real surfaces (wordmark, hero, dialog/card titles, entity rows, branch metadata, eyebrow, Monaco,
xterm, both markdown surfaces).

## Primitives vs semantic styles

**Primitives** are the raw vocabulary — flat id → value maps. They are the only numbers in the system:

| Group | Ids |
|---|---|
| `fontFamilies` | `interface` (Geist Variable, all proportional UI + reading text) · `code` (JetBrains Mono Variable, code only) · `brand` (the brand display face; today the interface stack, so a licensed face is a one-token swap) |
| `fontWeights` | `regular` 400 · `medium` 500 · `semibold` 600 · `brand` 800 |
| `fontSizes` | `s10` `s11` `s12` `s13` `s14` `s18` `s44` (px) |
| `lineHeights` | `compact` 1.25 · `code` 1.5 · `default` 1.6 |
| `letterSpacings` | `normal` · `wide` 0.05em · `widest` 0.1em · `brand` 0.5px |

**Semantic styles** are what components use. Each names seven primitive references and nothing else, so
it resolves deterministically — there is no inheritance, no per-usage branching, no fallback:

```json
"title": { "dialog": {
  "fontFamily": "interface", "fontSize": "s14", "fontWeight": "semibold",
  "lineHeight": "compact", "letterSpacing": "normal",
  "textTransform": "none", "fontStyle": "normal"
} }
```

`textStyles` groups: **brand** (`wordmark`, `hero`) · **title** (`dialog`, `card`, `section`,
`compact`, `entity`) · **ui** (`default`, `entity`, `entityCompact`, `metadata`, `helper`, `status`,
`empty`, `emptyQuiet`, `eyebrow`, `labelPill`, `action`, `emphasis`) · **body** (`reading`,
`supporting`) · **code** (`text`, `inline`, `block`, `otp`). `proseStyles` is the shared markdown set.

The JSON holds **no** CSS selectors, class strings, component paths, usage lists, rationale or audit
data. Rationale lives in this file; `TYPOGRAPHY-AUDIT.md` is a historical record that defines nothing.

## How components consume it

The generator derives one class per semantic style, mechanically:

| Source id | Generated class |
|---|---|
| `brand.wordmark` / `brand.hero` | `.tr-brand-wordmark` / `.tr-brand-hero` |
| `title.dialog` · `title.card` · `title.section` · `title.compact` · `title.entity` | `.tr-title-dialog` · `.tr-title-card` · `.tr-title-section` · `.tr-title-compact` · `.tr-title-entity` |
| `ui.default` | `.tr-text-ui` |
| `ui.metadata` · `ui.helper` · `ui.status` · `ui.empty` · `ui.emptyQuiet` | `.tr-text-metadata` · `.tr-text-helper` · `.tr-text-status` · `.tr-text-empty` · `.tr-text-empty-quiet` |
| `ui.entity` · `ui.entityCompact` · `ui.eyebrow` · `ui.labelPill` · `ui.action` · `ui.emphasis` | `.tr-text-entity` · `.tr-text-entity-compact` · `.tr-text-eyebrow` · `.tr-text-label-pill` · `.tr-text-action` · `.tr-text-emphasis` |
| `body.reading` / `body.supporting` | `.tr-text-reading` / `.tr-text-supporting` |
| `code.text` · `code.inline` · `code.block` · `code.otp` | `.tr-code-text` · `.tr-code-inline` · `.tr-code-block` · `.tr-code-otp` |
| `proseStyles.*` | `.tr-prose` + one element selector each |

Primitive tokens are also emitted as custom properties — `--tr-font-family-code`,
`--tr-font-size-s11`, `--tr-line-height-default`, … — for the surfaces that cannot use a class.

Rules at a call site:

- **Typography = exactly one semantic class.** Never compose `font-*`, `text-<size>`, `leading-*`,
  `tracking-*`, `uppercase`.
- **Colour stays at the call site** (`text-muted`, `text-hint`, conditional actives). Active/selected
  state is a **colour** change — never a weight change.
- Spacing, truncation, layout, hover and state classes are unaffected.

```tsx
<span className="tr-text-eyebrow text-muted">Projects</span>
<h2 className="tr-title-dialog text-text">{title}</h2>
<code className="tr-code-text text-hint">{command}</code>
```

## The shared prose system

Chat markdown and the spec/file preview render **one** typography. Both mount `.tr-prose`; a "prose
skin" now carries only spacing, measure and chrome (`chat/Markdown.tsx` = bubble rhythm,
`panels/MarkdownPreview.tsx` = document rhythm, heading rules, table chrome).

| Element | Style |
|---|---|
| body, blockquote, lists | 14px / 400 / 1.6 |
| `strong` | 14px / 500 |
| h1 | 18px / 600 / 1.25 |
| h2 | 14px / 600 / 1.25 |
| h3 | 12px / 600 |
| h4, h5 | 12px / 500 |
| h6 | 10px / 500 / uppercase + wide |
| inline code | 13px JetBrains Mono |
| fenced code | 11px JetBrains Mono / 1.5 |
| table body / header | 12px / 400 · 12px / 600 |

Below h3 the hierarchy is weight, spacing, colour and transform — not more sizes. There is **one**
reading line-height (1.6): the old prose-only 1.65 and the em ladder (`2em` … `0.85em`) are gone.
Never add a typography class to a prose skin; change `proseStyles` instead.

## Fonts

Self-hosted variable faces, imported by `styles/fonts.css` (`@fontsource-variable/geist`,
`@fontsource-variable/jetbrains-mono`), fingerprinted into `dist/assets` and embedded in the binary —
**no font CDN**, so an offline host renders the real system. Both faces are variable, so 800 and
italics are real, not synthetic. Pinned by `e2e/fonts.spec.ts`.

`tokens.css` keeps `--font`, `--font-mono`, `--font-accent`, `--font-mono-size` and `--line-height` as
**aliases** onto the generated tokens, purely so `global.css` and non-CSS consumers have a stable name;
the values are owned by the JSON. Cabinet Grotesk is retired and must not return (it was never loaded).

## Mono policy

`code` is for **code and technical content only**: editor and terminal text, code blocks, inline code,
diffs and technical file paths, shell commands, slash-command syntax, JSON/code editing surfaces,
keycaps, and the OTP exception. It is **never** used for project or workspace names, branch or base
refs, model names or ids, skill names, labels, tags, ordinary metadata or statuses — those are
proportional. Validation enforces this: a monospace family on a non-code style fails
`typography:validate`.

## Weight policy

- **400** — ordinary UI, body, entity, metadata and status text.
- **500** — buttons (`ui.action`), in-page section titles, compact titles, inline emphasis
  (`ui.emphasis`), prose h4–h6 and `strong`.
- **600** — dialog titles, card titles, alert titles, prose h1–h3 and table headers.
- **800** — brand only.

Disabled = `opacity-50`, no token.

## Permitted exceptions

The allowlist is deliberately tiny, and each entry is enforced by name in
`styles/typographyUsage.test.ts`:

| Surface | Why it cannot use a semantic class |
|---|---|
| `panels/monacoSetup.ts` | Monaco takes `fontFamily` / `fontSize` / `lineHeight` as JS options — it reads `--tr-font-family-code`, `--tr-font-size-s11`, `--tr-line-height-default`, so it cannot drift from a code block |
| `panels/TerminalInstance.tsx` | xterm, same reason (same two tokens) |
| `chat/tools/visualize/mermaid.ts` | mermaid's theme config takes a family string |
| `index.css`, `styles/tokens.css`, `styles/global.css`, `styles/fonts.css` | the mapping/alias layers themselves |

The OTP code is **not** an exception any more: it is the named `code.otp` style (`.tr-code-otp`).

## Adding or changing a style

1. Edit `styles/typography.json` — a new primitive, or a new entry under `textStyles` / `proseStyles`.
   Reuse primitives; add one only when no existing value fits.
2. `bun run typography:validate`, then `bun run typography:generate`, and **commit the generated CSS**.
3. Use the generated class at the call site (colour stays separate).
4. `bun test` (source + adoption guards) and `bun run e2e -- e2e/typography.spec.ts` for computed styles.

Do **not**: add a typography utility to `index.css`, declare a font property in a component, or edit
`styles/generated/typography.css`. The pre-commit hook and `apps/web build` run `typography:check`, so
stale generated CSS cannot land.

This primitives + semantic-tokens + schema + generator shape is the pattern a **colours** JSON should
mirror; nothing here is Tailwind-specific, and Tailwind merely consumes the generated CSS.
