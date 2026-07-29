---
id: web-typography
type: submodule-design
status: active
title: ThinkRail typography system — scale, weights, mono usage
parent: module-web
---

# Typography system

The durable reference for `apps/web`'s typography: the type scale and its semantic tiers, the weight
policy, and where mono is allowed. (For the *as-implemented* picture — every declared style, the
hardcoded values that remain and why, duplicates, and where this spec and the code disagree — see the
companion audit `TYPOGRAPHY-AUDIT.md`. It is descriptive; this file stays normative.) Components express all of it through token utilities (see
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
| — | — | *(no 11px or 9px proportional tier exists — `text-xs` is the single compact proportional size)* |
| `--font-lg` | 18px | large display (wordmark) |
| `--line-height` | 1.6 | global — and the line-height of **every** size tier (see below) |

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

Each tier declares **both halves** of its style: `--text-<tier>` *and* `--text-<tier>--line-height`
(pinned to `var(--line-height)`). Tailwind pairs every size with a default line-height (xs 1.333,
sm 1.4286, base 1.5, lg 1.5556); mapping only the size would leave those defaults owning a typography
property this design system owns — so the pairs are declared explicitly and the documented 1.6 is what
actually renders at every tier. A per-usage `leading-*` utility sets `--tw-leading` and still wins.
This "every property of a tier declared in one place" shape is deliberate: it is what a token source
(the planned typography JSON — family, size, weight, line-height, tracking, transform per role) can
generate without the implementation smuggling in framework defaults.

## Utilities (`@utility` in `index.css`)

- `text-mono` = `--font-mono` @ `--font-mono-size` (11px): terminal, fenced code, tool output, diffs,
  technical badges, keycaps.
- `text-base-mono` = `--font-mono` @ `--font-body` (13px): ONLY inline code inside `text-base`
  long-form content.
- `text-eyebrow` = `--font-xs` (10px) @ 400, `tracking-wider`, `uppercase`, line-height `--line-height`:
  THE eyebrow / section-label role — panel labels, rail group headings, settings sub-group headings,
  menu group headings, plan sections, the workspace-ready eyebrow, the Specs role chip. Carries the
  whole type style; the call site adds only colour (`text-muted` / `text-hint` / `text-text` /
  conditional). **Reserved for eyebrow/section-label content**: a pill or badge that merely looks
  similar (the "Soon" pill, the Welcome card tag) spells its own
  `text-xs uppercase tracking-wider` — same primitives, no borrowed semantic role.
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
- **600** — dialog titles (shadcn `DialogTitle`, `text-md leading-none`); Welcome card titles (the
  dialog-title *weight* at the card's own `text-sm` — `main`'s card rewrite made them smaller than a
  dialog title, and matching the weight is what makes them read as titles); markdown h1–h6 + table
  `th`; alert titles. The `ask_user_question` card's question titles are dialog-title analogs and keep
  600 (user-confirmed).

Surfaces `main` added or rewrote after this branch opened were swept to match on merge: the
empty-workspace screen's eyebrow + entity heading (`CenterTabs`), the skills-dialog eyebrows, the
template-settings eyebrow + template names, and the new-workspace project row's active state.
**Remaining 500s, deliberately untouched** — not sanctioned, just out of this PR's scope: form-field
labels (`TemplateEditorDialog`), the privacy toggle's row label, the chat plan strip label, and the
completed-todo group title (`TodoList`, where 500 marks a *done* row — the odd one). The
entity-consistency pass should rule on them.
- **800** — `text-brand` only.

Disabled = `opacity-50`, no token.

## Line-height / tracking

1.6 everywhere by default — both as the `global.css` body value and as each size tier's declared
line-height (see Tailwind mapping above), so a tier's line-height never comes from the framework.
Per-usage overrides: `leading-none` on dialog/card titles; `leading-tight` on the hero, the header
scope block, and rail rows; `leading-snug` on card subtitles; `leading-relaxed` on tool output;
`leading-[1.65]` on the markdown-preview prose root (the one untokenised value — see
`TYPOGRAPHY-AUDIT.md` §3.4). `tracking-wider` on uppercase eyebrows; 0.5px tracking lives inside
`text-brand` only.

## Rendering

`global.css` body: `-webkit-font-smoothing: antialiased` + `-moz-osx-font-smoothing: grayscale`.
Both are macOS-only effects; no `optimizeLegibility` — document, don't hack other platforms.

## Third-party parity

Monaco (all editors + diff panes via `panels/monacoSetup.ts` `sharedEditorOptions()`): fontSize from
`--font-mono-size`, family from `--font-mono`. xterm: fontSize parsed from `--font-mono-size`, family
from `--font-mono`.

## Mono usage policy

Mono is strictly for **code and technical content**: terminal, editor, code blocks, tool output, diff
code and the diff header's path, inline code, shell commands, slash-command syntax, keycaps. Identity
and label text is **proportional** — branches and refs, project/workspace names, skill names, model
names/ids, tags, metadata and UI labels. Mono is never used to make a label look technical; the
survivors that once did are swept (see the note at the end of this section). Sanctioned exceptions:

- Login OTP code: `font-(family-name:--font-mono) text-lg tracking-widest` — intentional emphasis.
- Markdown **fenced** code blocks: `font-(family-name:--font-mono) text-[0.85em]` — document content
  that scales with the prose skin, deliberately NOT the fixed `text-mono` tier (user-confirmed).
- Composer slash-command names and the ExtUiDialog JSON editor: `text-mono` — command syntax and a
  code-editing surface (user-confirmed exceptions to the "no mono for names" rule).
- The diff header's path and the new-workspace `/` hint: `text-mono` — a path labelling code, and
  command syntax.

Swept, and **do not reintroduce mono**: the rail workspace-branch sub-line (`ProjectTree`), the
branch-picker refs + its trigger (`NewWorkspaceDialog`), the empty-workspace screen's branch line
(`CenterTabs`), skill names (`SkillsDialog`), TODO notes (`TodoList`), the Welcome card tag and the
"Soon" pill (the last two now `text-xs uppercase tracking-wider`). These were the "known survivors";
repairing the dead font-family form (below) would have turned them genuinely monospace for the first
time, so they were made proportional instead — which is also how they have always *rendered*. That
also settles the branch question the repair surfaced: **all three branch surfaces are proportional**
(header line, rail sub-line, empty-workspace screen), consistent with "a branch is metadata".

### Naming a font family (the form that silently fails)

Use `font-(family-name:--font-mono)`, or a `text-mono` / `text-base-mono` / `text-brand` utility.
**Never** the bare `font-[var(--font-mono)]`: that arbitrary value is ambiguous and Tailwind compiles it
as a *weight* — `font-weight: var(--font-mono)` — which the browser drops, leaving the element in the
inherited proportional face while the class list claims otherwise. It went unnoticed in 28 call sites
(tool cards, keycaps, the header branch line, the brand wordmark), which is why several "mono" surfaces
were never monospace and the brand face never applied. `styles/fontClasses.test.ts` fails on the bare
form.

## Typographic roles

| Role | Canonical | Used in |
|---|---|---|
| Page/brand heading | `text-brand` + per-usage size | header wordmark, welcome hero |
| Dialog title | `text-md` 600 `leading-none text-text` | all dialogs (shadcn `DialogTitle`) |
| Card title | `text-sm` 600 `text-text` (dialog-title weight, card size) | welcome cards |
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
| Eyebrow | `text-eyebrow` + a colour | section labels, group headings, plan sections, Specs role chip |
| Label pill | `text-xs uppercase tracking-wider` + a colour | "Soon", the Welcome card tag |
| Technical badge | `text-mono` pill | keycap (`↵`) |
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
