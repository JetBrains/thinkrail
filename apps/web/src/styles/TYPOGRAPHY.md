---
id: web-typography
type: submodule-design
status: active
title: ThinkRail typography system — scale, weights, mono usage
parent: module-web
---

# Typography system

The durable reference for `apps/web`'s typography: the type scale and its semantic tiers, the weight
policy, and where mono is allowed. Components express all of it through token utilities (see
`apps/web/SPEC.md` → Styling & theming); this spec is what keeps those utilities from drifting.

(Two companion efforts are specced/reviewed separately and referenced where they touch type: the
**colour-system consolidation** — single neutral border, dead-token cleanup, inline-code background —
and the **entity-consistency pass** — welcome cards, empty states, status labels.)

## Type scale

Fixed-px tokens in `styles/tokens.css` `:root` (shared by every theme):

| Token | Value | Meaning |
|---|---|---|
| `--font-xs` | 10px | dense metadata/captions/helper/status chrome ONLY |
| `--font-sm` | 12px | THE default UI text |
| `--font-body` | 13px | the base body size (`--font-base` alias feeds spacing) |
| `--font-md` | 14px | reading text AND the heading size (two utility names, below) |
| `--font-mono-size` | 11px | the dense technical (mono) size |
| `--font-lg` | 18px | large display (wordmark) |
| `--line-height` | 1.6 | global |

(`--font-lg2`/`--font-xl`/`--font-xxl`, `--compact-font-base`, `--uppercase-*` exist but are unused —
kept untouched deliberately.)

Tailwind mapping (`src/index.css` `@theme inline`):

- `text-xs` → `var(--font-xs)` — 10px. Dense metadata, captions, helper text, status chrome ONLY.
- `text-sm` → `var(--font-sm)` — 12px. The default UI text: nav, trees, lists, dialogs, settings,
  buttons, forms, labels.
- `text-base` → `var(--font-md)` — 14px. Reading text ONLY: chat messages, markdown, documentation,
  page-level supporting copy. **Never UI controls.**
- `text-md` → `var(--font-md)` — 14px. The heading size (dialog/panel titles). Same value as
  `text-base`, different semantic role — both names stay.

## Utilities (`@utility` in `index.css`)

- `text-mono` = `--font-mono` @ `--font-mono-size` (11px): terminal, fenced code, tool output, diffs,
  technical badges, keycaps.
- `text-base-mono` = `--font-mono` @ `--font-body` (13px): ONLY inline code inside `text-base`
  long-form content.
- `text-brand` = `--font-accent`, weight 800, 0.5px tracking: the canonical ThinkRail brand display
  style. Carries family/weight/tracking ONLY; each usage sets its own size + line-height — the Shell
  header wordmark (`text-brand text-lg text-primary`) and the Welcome hero (`text-brand text-[44px]
  leading-tight text-primary`, whose text is the shown project's name or `PRODUCT_NAME`). No other
  composed accent-font treatments may exist.

## Fonts

**Self-hosted and bundled** — `styles/fonts.css` imports the fontsource packages, vite fingerprints the
woff2 files into `dist/assets`, and the CLI embeds that output. There is **no font CDN**: the app runs
locally and often offline, and a `<link>` to fonts.googleapis.com meant an air-gapped host silently fell
back to system faces (`document.fonts` came back *empty*), first paint waited on a third party, and
every load contacted Google despite the analytics opt-out. Pinned by `e2e/fonts.spec.ts`.

Both faces are **variable**, which is what makes the weight policy honest — 800 and italics are real
faces, not the browser's synthetic bold/oblique:

- `--font`: "Geist Variable" (`wght` 100–900 + italic) — the only proportional face. Emphasis inside
  sentences changes **weight**, never family.
- `--font-mono`: "JetBrains Mono Variable" (`wght` 100–800 + italic).
- `--font-accent`: `var(--font)` — brand only, kept as a named role so a licensed display face can be
  dropped in at this one line. It named "Cabinet Grotesk" until that face was retired: it was never
  loaded, so the moment the accent class actually applied, the wordmark and hero rendered in generic
  `sans-serif`. Each stack keeps the static family name ("Geist", "JetBrains Mono") next, so a host with
  the font installed still matches before the generic fallbacks.

The static-name fallbacks are the only reason a size looks stable across hosts; never assume a face is
available because a family is *named* — assert it (`document.fonts`), as the e2e spec does.

## Weights

- **400** — ALL body/UI text, including entity names, list items, eyebrow labels, status labels, and
  active nav/tab states (**active = color, not weight**).
- **500** — buttons; in-page panel/section headings (`text-md`); settings sub-headings; toast/confirm
  (compact) titles; inline sentence emphasis; markdown `<strong>` (both prose skins carry an explicit
  `[&_strong]:font-medium` to beat preflight).
- **600** — dialog titles (shadcn `DialogTitle`); Welcome card titles (the exact dialog-title style);
  markdown h1–h6 + table `th`; alert titles. The `ask_user_question` card's question titles are
  dialog-title analogs and keep 600 (user-confirmed).
- **800** — `text-brand` only.

Disabled = `opacity-50`, no token.

## Line-height / tracking

Global 1.6; `leading-none` on dialog/card titles; `leading-tight` on the hero, the header scope
block, and rail rows; `leading-snug` on card subtitles; `tracking-wider` on uppercase eyebrows; 0.5px
tracking lives inside `text-brand` only.

## Rendering

`global.css` body: `-webkit-font-smoothing: antialiased` + `-moz-osx-font-smoothing: grayscale`.
Both are macOS-only effects; no `optimizeLegibility` — document, don't hack other platforms.

## Third-party parity

Monaco (all editors + diff panes via `panels/monacoSetup.ts` `sharedEditorOptions()`): fontSize from
`--font-mono-size`, family from `--font-mono`. xterm: fontSize parsed from `--font-mono-size`, family
from `--font-mono`.

## Mono usage policy

Mono is strictly for code/terminal/output/technical badges/keycaps. Branches, project/workspace
names, model names/ids are proportional — mono had leaked into identity text. Sanctioned exceptions
and survivors:

- Login OTP code: `font-(family-name:--font-mono) text-lg tracking-widest` — intentional emphasis.
- Markdown **fenced** code blocks: `font-(family-name:--font-mono) text-[0.85em]` — document content
  that scales with the prose skin, deliberately NOT the fixed `text-mono` tier (user-confirmed).
- Composer slash-command names and the ExtUiDialog JSON editor: `text-mono` — command syntax and a
  code-editing surface (user-confirmed exceptions to the "no mono for names" rule).
- Sanctioned mono outside the fixed tier, each keeping its own size — the complete list, so the roles
  table below has no unlisted exceptions: the rail workspace-branch sub-line (`ProjectTree`), the
  empty-workspace screen's branch line (`CenterTabs`), the branch-picker refs + the `/` hint
  (`NewWorkspaceDialog`), the diff header path (`DiffPane`), TODO notes (`TodoList`), skill names
  (`SkillsDialog`), the Welcome card tag badge (`WelcomePanel`, e.g. "spec-first").

### Naming a font family (the form that silently fails)

Use `font-(family-name:--font-mono)`, or a `text-mono` / `text-base-mono` / `text-brand` utility.
**Never** the bare `font-[var(--font-mono)]`: that arbitrary value is ambiguous and Tailwind compiles it
as a *weight* — `font-weight: var(--font-mono)` — which the browser drops, leaving the element in the
inherited proportional face while the class list claims otherwise. It went unnoticed in 28 call sites
(tool cards, keycaps, the header branch line, the brand wordmark), which is why several "mono" surfaces
were never monospace and the brand face never applied. `styles/fontClasses.test.ts` fails on the bare
form.

**Open tension** (deliberately not settled here): the roles table below calls a branch *metadata*
everywhere and the header branch line is proportional, yet **two** branch surfaces are sanctioned mono
above — the rail sub-line and the empty-workspace screen. Repairing the dead classes made that visible
instead of hiding it behind CSS that did nothing — unifying the three is the entity-consistency pass's
call.

## Typographic roles

| Role | Canonical | Used in |
|---|---|---|
| Page/brand heading | `text-brand` + per-usage size | header wordmark, welcome hero |
| Dialog title | `text-md` 600 `leading-none text-text` | all dialogs (shadcn `DialogTitle`) |
| Card title | = dialog title | welcome cards |
| Panel/section title | `text-md` 500 `text-text` | settings `<h3>`s (600 = modal, 500 = in-page) |
| Compact title | `text-sm` 500 | toasts, confirm popover |
| Entity name | `text-sm` 400 | all entity rows/labels (colors per the entity-consistency spec work) |
| Entity screen heading | `text-md` 400 `text-text` | empty-state workspace name |
| Supporting text (page) | `text-base` | welcome page, provider banner |
| Reading text | `text-base text-text` | chat messages, markdown body |
| Metadata/timestamps/refs | `text-xs text-hint` | branch rows, counts, times, ids |
| Status label (neutral) | `text-sm text-muted`, sentence case, no tracking | "Workspace ready", connection status |
| Helper text | `text-xs text-hint` | settings helpers, placeholders (`placeholder:text-hint`) |
| Empty state | `text-xs text-hint` (panels); rail placeholder deliberately `text-sm text-muted` | trees, changes, specs, terminals |
| Eyebrow | `text-xs uppercase tracking-wider`, `text-muted` or `text-hint` (both exist; not unified) | section labels, group headings |
| Technical badge | `text-mono uppercase` pill | SOON, spec-first, keycap |
| Inline code | `text-base-mono` (chat/markdown) / `text-mono` (in `text-sm` sentences) — background consolidation proposed in the colour-system PR | shared `Markdown.tsx`, `GithubSettings` |
| Code block | `text-mono` on `bg-elevated`/`bg-bg-dark` | tool output (markdown fenced blocks: em-based, see Mono policy) |

## Why (design rationale)

- `text-base` = 14px creates a real reading tier distinct from 12px UI text (chat was cramped at
  `text-sm`).
- Two mono tiers (11/13px) let inline code sit near long-form body size while dense technical text
  stays compact.
- `text-brand` names the brand display style so wordmark and hero can't drift.
- Weight policy (400 default): weight was doing hierarchy work that color/size should do; active
  states = color.
- Entity names are 400 `text-sm`; their size may grow only as a screen's primary heading; a branch is
  metadata everywhere; neutral status labels are plain secondary text.
