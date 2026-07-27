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
  leading-tight text-primary`). No other composed accent-font treatments may exist.

## Fonts

- `--font`: "Geist" — the only proportional face. Emphasis inside sentences changes **weight**, never
  family.
- `--font-mono`: "JetBrains Mono".
- `--font-accent`: "Cabinet Grotesk" — brand only; known unloaded fallback, left as-is.

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

- Login OTP code: `font-[var(--font-mono)] text-lg tracking-widest` — intentional emphasis.
- Markdown **fenced** code blocks: `font-[var(--font-mono)] text-[0.85em]` — document content that
  scales with the prose skin, deliberately NOT the fixed `text-mono` tier (user-confirmed).
- Composer slash-command names and the ExtUiDialog JSON editor: `text-mono` — command syntax and a
  code-editing surface (user-confirmed exceptions to the "no mono for names" rule).
- Known unswept survivors, do not "fix": the rail workspace-branch sub-line (`ProjectTree`) and the
  branch-picker refs (`NewWorkspaceDialog`).

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
