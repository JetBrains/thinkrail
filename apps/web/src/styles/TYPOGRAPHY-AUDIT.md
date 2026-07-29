---
id: web-typography-audit
type: submodule-design
status: active
title: Typography audit — every text style in apps/web, as implemented
parent: module-web
references:
  - web-typography
tags:
  - audit
  - typography
---

# Typography audit (as-implemented)

An **audit only** — a full inventory of every text style `apps/web` actually renders, the hardcoded
values that survive outside the token system and why, and where the system duplicates itself or loses
hierarchy. **Nothing here changes code, tokens, or branding.** No recommendation in §8 has been
applied.

Companion documents:

- `TYPOGRAPHY.md` — the *intended* system (scale, weight policy, mono policy). Normative.
- **This file** — the *observed* system, and every place the two disagree. Descriptive.

Where they disagree, this file names the drift; it does not silently "fix" `TYPOGRAPHY.md`.

## 0. Scope & method

- **Tree audited:** branch `design/typography` @ `bf0ab47` — i.e. **after** the typography sweep of
  PR #137 and after `main` (`71fcc91`) was merged in. So the findings below are what ships *if #137
  lands as-is*, not the older `main` state.
- **Surface:** `apps/web/src` only (frontend). `apps/website` is a separate app with its own type
  system and is referenced once, in §4, where its brand-font fallback differs from the app's.
- **Method:** static extraction of every class/style token from every string literal in `**/*.ts(x)`
  plus the CSS layer (`styles/tokens.css`, `index.css`, `styles/global.css`), then grouping by the
  distinct *combination* of family + size + weight + tracking + leading + transform + colour.
  Provenance ("why does this still exist") comes from `git log -L` on each site and from the sweep's
  own file list (`git diff bb503d0..a9e0a58` — 36 paths under `apps/web/src`, of which 31 are
  component/TS files and 5 are the CSS/spec layer).
- **Reproduce:** the two throwaway scripts used are reproduced in Appendix A — the numbers in this
  document are counted, not estimated.
- **Known method limits (read before trusting a count):**
  1. Grouping is per *string literal*. A `className` assembled from several literals (`cn(a, b)`,
     ternaries) is counted as several partial combos, so a few rows below carry two colour tokens
     (`text-muted text-text` = the active/inactive pair) or two weights. Such rows are marked
     *conditional*.
  2. Styles inherited rather than declared (a `text-xs` container styling its children) are counted
     at the declaration site, not at each visual occurrence. The real number of *visually distinct*
     text renderings is therefore higher than 78.
  3. Third-party text rendered by Monaco, xterm, mermaid and shiki is configured in JS, not classes;
     it is inventoried separately in §2.9.

**Headline count:** 78 distinct declared typography combinations across 72 of the 159 `.ts(x)` files,
expressed through 5 size utilities + 3 composite utilities + **12 distinct hardcoded size expressions
at 25 sites**.

## 1. The token layer

### 1.1 Size tokens (`styles/tokens.css` → `:root`)

| Token | Value | Mapped to a utility? | Used? |
|---|---|---|---|
| `--font-xs` | 10px | `text-xs` | ✅ 150 uses |
| `--font-sm` | 12px | `text-sm` | ✅ 97 uses |
| `--font-body` | 13px | only inside `text-base-mono` | ⚠️ 1 indirect use |
| `--font-md` | 14px | `text-base` **and** `text-md` | ✅ 3 + 9 uses |
| `--font-mono-size` | 11px | inside `text-mono`; read by Monaco + xterm | ✅ |
| `--font-lg` | 18px | `text-lg` | ✅ 2 uses |
| `--font-lg2` | 20px | — | ❌ **dead** |
| `--font-xl` | 25px | — | ❌ **dead** |
| `--font-xxl` | 40px | — | ❌ **dead** |
| `--font-base` | 13px (re-written to 13px at runtime by `utils/fontScale.ts`) | — | ⚠️ spacing only (`--space-*` derive from it) + `global.css` body |
| `--compact-font-base` | 9px (written at runtime, never read) | — | ❌ **dead write** |
| `--uppercase-size` | 13px | — | ❌ **dead** |
| `--uppercase-weight` | 500 | — | ❌ **dead** |
| `--uppercase-spacing` | 0.5px | — | ❌ **dead** |
| `--line-height` | 1.6 | `global.css` body; read by Monaco | ✅ |

Seven of fifteen size-ish tokens are dead. `TYPOGRAPHY.md` already declares four of them
("kept untouched deliberately"); `--compact-font-base`, `--uppercase-*` are undeclared dead weight,
and `--compact-font-base` is actively *written* on every boot by `applyFontScale()` for no reader.

`utils/fontScale.ts` is a parameterised scale (`applyFontScale(base = 13, compactBase = 9)`) with
exactly one call site (`main.tsx`, no arguments) and no UI — so the app has a font-scale mechanism
that cannot currently be scaled.

### 1.2 Family tokens

| Token | Declared stack | Intended role |
|---|---|---|
| `--font` | `"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | the only proportional face |
| `--font-mono` | `"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", monospace` | technical text |
| `--font-accent` | `"Cabinet Grotesk", sans-serif` | brand display only |

See §4 — one of these three is never loaded.

### 1.3 The utility layer (`index.css`)

Mapped into Tailwind (`@theme inline`): `text-xs` `text-sm` `text-base` `text-md` `text-lg`,
`--font-sans → --font`.
Hand-written (`@utility`): `text-mono` (mono @ 11px), `text-base-mono` (mono @ 13px),
`text-brand` (accent family + weight 800 + 0.5px tracking, **no size**).

Deliberate collision: `text-base` and `text-md` are the **same 14px value** under two names
(reading tier vs heading tier). Nothing enforces the distinction — see §6.1.

## 2. Style inventory — every distinct combination

Sizes resolve as: `text-xs` 10px · `text-sm` 12px · `text-base`/`text-md` 14px · `text-lg` 18px ·
`text-mono` 11px mono · `text-base-mono` 13px mono. Weight is 400 unless stated (`font-medium` 500,
`font-semibold` 600, `text-brand` 800). Line-height is the global 1.6 unless stated. Tracking is 0
unless stated. Counts are declaration sites.

The 78 machine-distinct combinations are presented below as **60 numbered rows**: a row folds pure
colour variants of one identical style (e.g. `text-xs` at `text-red`/`text-green`/`text-gold`) and the
*conditional* rows where one literal carries an active/inactive colour pair. Nothing is dropped — the
folded variants are named inside their row, and §9 requires the showcase to render all 78.

### 2.1 Display / brand

| # | Style | Family | Size | Weight | LH | Tracking | Transform | Colour | Sites |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `text-brand text-[44px] leading-tight text-primary` | accent | **44px (hardcoded)** | 800 | tight | 0.5px | — | `--primary` | `panels/WelcomePanel.tsx:144` (hero) |
| 2 | `text-brand text-lg text-primary` | accent | 18px | 800 | 1.6 | 0.5px | — | `--primary` | `shell/Shell.tsx:54` (wordmark) |

Only two brand usages exist, both via `text-brand` — the one place the system is fully consolidated.

### 2.2 Titles (dialog / card / section / screen)

| # | Style | Size | Weight | Notes | Sites |
|---|---|---|---|---|---|
| 3 | `text-md font-semibold leading-none text-text` | 14px | 600 | the canonical dialog title | `components/ui/dialog.tsx:66` (every dialog) |
| 4 | `text-md font-semibold text-text` | 14px | 600 | dialog-title analog inside a chat card | `chat/tools/AskUserQuestionCard.tsx:542,803` |
| 5 | `text-md font-medium text-text` | 14px | 500 | in-page settings/section heading | `panels/{PrivacySettings:24,GithubSettings:43,ProvidersSettings:111,AppearanceSettings:29,TemplatesSettings:221}`, `panels/CenterTabs.tsx:257` |
| 6 | `text-sm font-medium text-text` | 12px | 500 | compact title | `panels/ConfirmPopover:63`, `panels/WelcomePanel:259` (**card title**), `panels/TemplatesSettings:379`, `panels/PrivacySettings:33`, `panels/ProvidersSettings:157`, `chat/TemplateEditorDialog:197`, `chat/tools/visualize/{DiagramCard:19,ComparisonCard:20}`, `components/ErrorBoundary:85` |
| 7 | `text-sm font-medium` (colour from context) | 12px | 500 | toast title | `components/ui/toast.tsx:50` |
| 8 | `font-medium text-text` (size inherited) | — | 500 | inline emphasis / label | `chat/TemplateEditorDialog:295`, `panels/{PrivacySettings:62,68, useOpenProject:98, ProjectTree:311, MarkdownPreview(strong)}` |

`CenterTabs:257` (#5) is the *workspace screen heading* — 14px/500, where `TYPOGRAPHY.md` specifies
"entity screen heading = `text-md` **400**". `WelcomePanel:259` (#6) is the *welcome card title* —
12px/500, where `TYPOGRAPHY.md` specifies "card title = **dialog title** = 14px/600". Both are
spec-vs-code drift, not judgement calls (see §6.2).

### 2.3 Body / reading

| # | Style | Size | Notes | Sites |
|---|---|---|---|---|
| 9 | `text-base text-text` | 14px | the reading tier | `chat/turns.tsx:61,103` (chat messages), `panels/ProviderWarningBanner.tsx:42` |
| 10 | `text-[length:var(--font-md)] leading-[1.65] text-pretty text-text` | 14px | markdown-preview prose root — **token via arbitrary value**, and **1.65 ≠ the global 1.6** | `panels/MarkdownPreview.tsx:19` |
| 11 | `text-sm` (bare, colour inherited) | 12px | the default UI text | 23 sites across 18 files |
| 12 | `text-sm text-text` | 12px | UI text, explicit colour | 31 sites across 20 files |
| 13 | `text-sm text-muted` | 12px | secondary UI text | 9 sites (incl. `ui/dialog.tsx:76` DialogDescription, `ui/toast.tsx:59`) |
| 14 | `text-sm text-hint` | 12px | tertiary UI text / empty states | 10 sites |
| 15 | `text-sm leading-tight` | 12px | rail row (2-line) | `panels/ProjectTree.tsx:267` |
| 16 | `text-sm text-red` / `text-sm text-green` | 12px | inline error / success | `chat/turns:170`, `chat/HistoryOverlay:485`, `auth/LoginDialog:93,88` |
| 17 | `text-sm capitalize text-text` | 12px | thinking-level value | `chat/ThinkingSelector.tsx:50` |
| 18 | `text-sm font-medium text-hint` | 12px/500 | todo-plan section | `chat/TodoList.tsx:169` |

The **composer textarea is `text-sm` (12px)** (`chat/Composer.tsx:786`) while the messages it produces
render at `text-base` (14px) — you type two pixels smaller than you read (§6.3).

### 2.4 Caption / metadata / helper

| # | Style | Size | Notes | Sites |
|---|---|---|---|---|
| 19 | `text-xs text-hint` | 10px | **the single most-used style in the app** | 56 sites across 26 files |
| 20 | `text-xs text-muted` | 10px | secondary metadata | 25 sites across 15 files |
| 21 | `text-xs` (bare) | 10px | inherited colour | 15 sites |
| 22 | `text-xs text-text` | 10px | high-contrast metadata + **tooltip body** | `ui/tooltip.tsx:19`, `chat/Composer:655`, `chat/tools/AskUserQuestionCard:573`, `chat/tools/visualize/ComparisonCard:42,52` |
| 23 | `text-xs italic text-hint` | 10px | "no output"/empty placeholders in tool cards | 8 sites (7 files) |
| 24 | `text-xs text-red` / `text-green` / `text-gold` / `text-primary` | 10px | status-coloured metadata | 9 / 2 / 1 / 1 sites |
| 25 | `text-xs leading-snug text-muted` | 10px | card subtitle | `panels/{NewWorkspaceDialog:499, WelcomePanel:260}` |
| 26 | `text-[10px] text-hint` | **10px hardcoded** | identical to #19 | `chat/HistoryOverlay.tsx:139,151,173` |
| 27 | `text-[11px] text-hint` / `text-[11px] text-muted` | **11px hardcoded, proportional** | no token exists at 11px proportional | `chat/HistoryOverlay.tsx:284,493,572` |
| 28 | `text-xs text-muted text-text` *(conditional)* | 10px | active/inactive pair | `chat/SkillsButton:32`, `chat/ChatView`, `panels/TemplatesSettings` |

### 2.5 Eyebrows / section labels (uppercase) — **9 variants**

| # | Style | Size | Weight | Tracking | Colour | Sites |
|---|---|---|---|---|---|---|
| 29 | `text-xs uppercase tracking-wider text-muted` | 10px | 400 | wider | muted | `panels/{ProvidersSettings:254,TerminalsPanel:38,ProjectTree:98}`, `ui/dropdown-menu.tsx:49` |
| 30 | `text-xs uppercase tracking-wider text-hint` | 10px | 400 | wider | hint | `chat/ThinkingSelector.tsx:34` |
| 31 | `text-xs uppercase tracking-wider` (bare) | 10px | 400 | wider | inherited | `panels/RightPanel.tsx:92` |
| 32 | `text-xs font-medium uppercase tracking-wider text-hint` | 10px | **500** | wider | hint | `panels/CenterTabs.tsx:254` |
| 33 | `text-xs font-medium uppercase tracking-wider text-muted` | 10px | **500** | wider | muted | `panels/TemplatesSettings.tsx:291` |
| 34 | `text-xs uppercase tracking-wide text-hint` | 10px | 400 | **wide** | hint | `chat/HistoryOverlay.tsx:502,525` |
| 35 | `text-xs font-medium uppercase tracking-wide text-text` | 10px | **500** | **wide** | text | `chat/SkillsDialog.tsx:197,313` |
| 36 | `text-[10px] uppercase tracking-wider text-hint` | **10px hardcoded** | 400 | wider | hint | `chat/TodoList.tsx:131,172` |
| 37 | `text-[9px] uppercase tracking-wider` | **9px hardcoded** | 400 | wider | inherited | `panels/SpecsPanel.tsx:171` |

Nine ways to render the same semantic thing ("a small uppercase group label"), differing only in
weight (400/500), tracking (`wide`/`wider`), colour (hint/muted/text/inherited) and size
(10px token / 10px literal / 9px literal). `--uppercase-size/-weight/-spacing` — tokens that exist
precisely for this role — are used by none of them.

### 2.6 Buttons / controls

| # | Style | Size | Weight | Sites |
|---|---|---|---|---|
| 38 | `font-medium` + `text-sm` (`h-8 px-md` / `h-7 px-sm`) | 12px | 500 | `components/ui/button.tsx:6,16,17` — the shared primitive (15 importers) |
| 39 | `text-sm font-medium text-on-accent` (hand-rolled primary button) | 12px | 500 | `chat/tools/AskUserQuestionCard.tsx:348,358`, `panels/NewWorkspaceDialog.tsx:566` |
| 40 | `font-medium text-primary` (link-ish action) | inherited | 500 | `chat/tools/AskUserQuestionCard:659`, `panels/NewWorkspaceDialog:612` |
| 41 | `text-sm` nav item (settings sidebar) | 12px | 400 | `panels/SettingsDialog.tsx:69` |
| 42 | `text-sm` command/menu item | 12px | 400 | `ui/command.tsx:25,66`, `ui/dropdown-menu.tsx:35` |

Three call sites (#39) re-declare the shared Button's exact type treatment instead of using `Button`.

### 2.7 Inputs

| # | Style | Size | Sites |
|---|---|---|---|
| 43 | `text-sm` textarea | 12px | `ui/textarea.tsx:9`, `chat/Composer.tsx:786` (+ its mirror div, `:693`) |
| 44 | `text-sm text-text placeholder:text-hint` `<input>` | 12px | `chat/tools/AskUserQuestionCard:723`, `chat/ExtUiDialog:60`, `chat/HistoryOverlay:559`, `chat/TodoList:81`, `auth/LoginDialog:164`, `chat/TemplateEditorDialog:184,222,235` (via a local `INPUT_CLASS` constant) |

Placeholders are uniformly `placeholder:text-hint` (9 sites) and inherit the field's size.

Inputs are the *most* consistent surface in the app — every one is `text-sm text-text` with a
`text-hint` placeholder. But there is **no `Input` primitive** in `components/ui/` (unlike `textarea`),
so that agreement is 5 copies of a literal plus one file-local `INPUT_CLASS` constant, held by
coincidence rather than by a shared component. There is also no `input` role in the scale — inputs are
just "default UI text", which is why the composer/message mismatch in §6.3 exists.

### 2.8 Badges / pills / keycaps — **5 variants**

| # | Style | Family | Size | Sites |
|---|---|---|---|---|
| 45 | `text-mono uppercase` | mono | 11px | `panels/SettingsDialog.tsx:87` ("Soon") |
| 46 | `font-[var(--font-mono)] text-[10px] uppercase tracking-wide text-primary` | mono | **10px hardcoded** | `panels/WelcomePanel.tsx:246` (card tag, e.g. "spec-first") |
| 47 | `text-[10px] text-on-accent` | **proportional** | **10px hardcoded** | `chat/tools/visualize/ComparisonCard.tsx:33` ("Recommended") |
| 48 | `text-[11px] font-medium text-primary` | proportional | **11px hardcoded** | `chat/tools/AskUserQuestionCard.tsx:730` (pill) |
| 49 | `text-xs` diff-stat badge | proportional | 10px | `panels/DiffStatBadge.tsx:17` |
| 50 | `text-mono` keycap (`↵`) | mono | 11px | `panels/NewWorkspaceDialog.tsx:569` |
| 51 | `text-[10px] text-hint` shortcut hint | proportional | **10px hardcoded** | `chat/HistoryOverlay.tsx:151,173` |

Same UI object (a small pill), five typographic treatments across mono/proportional and 10/11px.

### 2.9 Code / terminal / third-party surfaces

| # | Surface | Configuration | Resolves to |
|---|---|---|---|
| 52 | `text-mono` (tool output, code blocks, diffs) | `index.css` utility | JetBrains Mono 11px |
| 53 | `text-mono text-text` / `text-muted` / `text-hint` | same + colour | 11px mono |
| 54 | `text-mono leading-relaxed` | `chat/tools/{BashCard:13,EditCard:34}` | 11px mono, 1.625 |
| 55 | `text-base-mono` | `chat/Markdown.tsx:62` (inline code in prose) | 13px mono |
| 56 | `font-[var(--font-mono)] text-[0.85em]` | `chat/Markdown.tsx:68,95` (fenced blocks) | ~11.9px mono, **em-relative** |
| 57 | Monaco (all editors **and** diff panes) | `panels/monacoSetup.ts:76-86` — `fontSize` ← `--font-mono-size`, `fontFamily` ← `--font-mono`, `lineHeight` ← `--line-height` | 11px mono, 1.6 |
| 58 | xterm terminal | `panels/TerminalInstance.tsx:97-98` — same two tokens | 11px mono |
| 59 | mermaid diagrams | `chat/tools/visualize/mermaid.ts:39` — `fontFamily` ← `--font-mono`, **no size** | mono at mermaid's default size |
| 60 | shiki-highlighted code | inherits `text-mono` from its container | 11px mono |

Monaco and xterm are the only third-party surfaces reading the token layer for *both* family and
size; mermaid takes family only, so diagram label size is outside the system entirely.

### 2.10 Mono outside the mono utilities — **6 different mono sizes**

`font-[var(--font-mono)]` appears 13 times, bypassing `text-mono`/`text-base-mono`:

| Site | Effective size | Sanctioned by `TYPOGRAPHY.md`? |
|---|---|---|
| `auth/LoginDialog.tsx:132` (OTP, `text-lg tracking-widest`) | 18px | ✅ explicit exception |
| `chat/Markdown.tsx:68,95` (fenced code, `text-[0.85em]`) | em-relative | ✅ explicit exception |
| `panels/ProjectTree.tsx:274` (rail branch sub-line, `text-xs`) | 12px | ✅ named survivor |
| `panels/NewWorkspaceDialog.tsx:712,714,728` (branch-picker refs, `text-xs`) | 12px | ✅ named survivor |
| `panels/NewWorkspaceDialog.tsx:536` (the literal `/` in a caption) | 10px (inherits `text-xs`) | ⚠️ undocumented |
| `panels/CenterTabs.tsx:260` (workspace-ready branch line, `text-xs`) | 12px | ❌ undocumented |
| `panels/DiffPane.tsx:86` (diff header path, `text-xs`) | 12px | ❌ undocumented |
| `chat/SkillsDialog.tsx:394` (skill name, `text-sm`) | 12px | ❌ undocumented — and it's an *identity* name, which the mono policy forbids |
| `chat/TodoList.tsx:207` (todo note, `text-[10px]`) | 10px | ❌ undocumented |
| `panels/WelcomePanel.tsx:246` (card tag, `text-[10px]`) | 10px | ❌ undocumented |

Counting the utilities, mono renders at **10, 11, 12, 13, 18px and `0.85em`** — six sizes for a
two-tier policy.

## 3. Remaining hardcoded typography — and why it survives

25 sites carry a hardcoded size (12 distinct values). Grouped by *why*, since the reason determines
whether it is technical debt or a deliberate exception.

| Value | Sites | Verdict (below) |
|---|---|---|
| `text-[10px]` | 8 | drift — token exists (§3.2) |
| `text-[11px]` | 4 | scale gap (§3.3) |
| `text-[0.85em]` | 4 | sanctioned / prose (§3.1, §3.4) |
| `text-[9px]` | 1 | unmapped token (§3.3) |
| `text-[44px]` | 1 | sanctioned (§3.1) |
| `text-[2em]` `[1.5em]` `[1.25em]` `[1em]` `[0.875em]` `[0.9em]` | 6 | prose scale (§3.4) |
| `text-[length:var(--font-md)]` | 1 | duplicate spelling (§3.4) |

### 3.1 Sanctioned by the spec (leave alone)

| Value | Site | Why it exists |
|---|---|---|
| `text-[44px]` | `WelcomePanel:144` hero | `text-brand` deliberately carries **no size** — every brand usage sets its own. `TYPOGRAPHY.md` documents this exact value. |
| `text-[0.85em]` ×3 | `Markdown.tsx:68,95,102` fenced code | Document content must scale *with the prose*, so it is em-relative by design (user-confirmed in `TYPOGRAPHY.md`). |

### 3.2 A token exists with the identical value — pure drift (5 sites)

| Value | Site | Identical token |
|---|---|---|
| `text-[10px]` | `HistoryOverlay:139,151,173` | `text-xs` (`--font-xs` = 10px) |
| `text-[10px]` | `TodoList:131,172,207` | `text-xs` |
| `text-[10px]` | `ComparisonCard:33` | `text-xs` |
| `text-[10px]` | `WelcomePanel:246` | `text-xs` |

**Why they survive:** provenance explains it exactly. `HistoryOverlay` (Ctrl+R history search, #109,
2026‑07‑26), `TodoList` (chat TODO plans, 2026‑07‑21), `SkillsDialog`/`SkillsButton`/
`ProjectSkillsNotice` (skills manager, #94, 2026‑07‑24), `TemplatesSettings`/`TemplateEditorDialog`
(prompt templates, #110, 2026‑07‑26), `PrivacySettings` (analytics, 2026‑07‑26) and `DiffPane`
(2026‑07‑22) all landed on `main` **in parallel with** the typography sweep (2026‑07‑27, branch cut
from `bb503d0`). The sweep touched **31 component files**; none of those surfaces was among
them, and merging `main` into the branch resolved *text* conflicts, not *policy*. `ComparisonCard` and `WelcomePanel` *were*
swept — but the sweep's scope was weights, mono and tiers, explicitly **not** arbitrary px sizes, so
their literals passed through untouched.

### 3.3 No token exists for the value (4 sites)

| Value | Site | Gap |
|---|---|---|
| `text-[11px]` ×3 | `HistoryOverlay:284,493,572` | 11px **proportional** has no token. `--font-mono-size` is 11px but is the *mono* tier, and `text-mono` would change the family too. The proportional scale jumps 10 → 12. |
| `text-[11px]` | `AskUserQuestionCard:730` | same gap, in a pill |
| `text-[9px]` | `SpecsPanel:171` | 9px exists as `--compact-font-base` — but it is written by JS and **never mapped to a utility**, so there was nothing to reference. |

### 3.4 Deliberately relative (markdown prose skins)

`MarkdownPreview.tsx:22-42` implements a full em-relative heading scale — `text-[2em]`, `[1.5em]`,
`[1.25em]`, `[1em]`, `[0.875em]`, `[0.85em]`, plus `text-[0.9em]` for tables — all at
`font-semibold`, on a root of `text-[length:var(--font-md)] leading-[1.65]`.

**Why:** rendered documents need an internally-proportional scale that tracks the prose root, which
a fixed-px token scale cannot express. This is legitimate — but it is **entirely undocumented**:
`TYPOGRAPHY.md` sanctions em-relative sizing only for *fenced code*, and says markdown headings are
"600" without mentioning that their sizes live outside the scale. Two sub-findings:

- `text-[length:var(--font-md)]` reaches for the token through an arbitrary value where `text-base`
  is the same 14px — the file predates the `text-base` mapping (added 2026‑07‑10 vs the sweep).
- `leading-[1.65]` silently disagrees with the global `--line-height: 1.6`, and there is no
  `--line-height-prose` token to hold the intended difference.

### 3.5 Non-size hardcoding

- **Tracking:** `tracking-wider` (12), `tracking-wide` (5), `tracking-widest` (1) are Tailwind
  defaults (0.025em / 0.05em / 0.1em) — none flow from `--uppercase-spacing: 0.5px`, the token meant
  for exactly this.
- **Line-height:** `leading-tight` (6), `leading-snug` (3), `leading-relaxed` (2), `leading-none` (1),
  `leading-normal` (1), `leading-[1.65]` (1) — six treatments, all Tailwind constants; only the
  global 1.6 is tokenised.
- **Weights:** `font-medium` (36) and `font-semibold` (13) are the only weights in component code —
  consistent with the 400/500/600 policy. `text-brand`'s 800 is the only weight inside a utility.
  No `font-bold`/`font-extrabold` survives in components (the sweep's one real consolidation).

## 4. Font-family audit

### 4.1 What is actually loaded

`apps/web/index.html` loads exactly one stylesheet:

```
fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700
                          &family=JetBrains+Mono:wght@400;500;600;700&display=swap
```

There is **no `@font-face` rule and no self-hosted font file anywhere in the repo.**

| Family | Declared in | Loaded? | What actually renders |
|---|---|---|---|
| **Geist** | `--font` | ✅ Google Fonts, weights 400/500/600/700 | Geist at 400/500/600 (the app uses only these three) |
| **JetBrains Mono** | `--font-mono` | ✅ Google Fonts, 400/500/600/700 | JetBrains Mono 400 (the app never sets a mono weight) |
| **Cabinet Grotesk** | `--font-accent` | ❌ **never loaded** (it is a Fontshare font, absent from the Google Fonts request and from every `@font-face`) | falls through to the stack's next entry: **generic `sans-serif`** |

### 4.2 Findings

1. **The brand face never renders.** `text-brand` (wordmark + hero) resolves to the browser's default
   `sans-serif` — Helvetica/Arial on macOS, Arial on Windows — at a **synthesised** 800 weight, since
   the fallback stack ends at `sans-serif` rather than falling back to Geist. `TYPOGRAPHY.md`
   acknowledges this ("known unloaded fallback, left as-is"), so it is a known, unfixed gap, not a
   surprise — but it means the two most brand-critical strings in the product are the two least
   controlled typographically.
2. **The app and the website disagree on the fallback.** `apps/website/src/styles.css:12` declares
   `--font-display: "Cabinet Grotesk", var(--font-sans)` — i.e. the site degrades to **Geist**, the
   app degrades to **generic sans-serif**. Same brand, two different rendered wordmarks.
3. **Weight 800 is not in the loaded set** even for Geist (400;500;600;700 requested), so any accent
   fallback is synthetically emboldened.
4. **Geist 700 is loaded but never used** — the app's heaviest real weight is 600.
5. **A local-first app fetches its fonts from a CDN.** ThinkRail runs on localhost (and ships as a
   single binary); with no network, *all three* families fall back to system fonts, so the entire
   type system silently degrades offline. `display=swap` also means a FOUT on every cold load. This
   is additionally a third-party request on every app boot, which sits oddly beside the app's own
   Privacy settings panel.
6. **No unexpected families otherwise.** Every text surface resolves to one of the three declared
   stacks; mermaid uses `--font-mono` (§2.9), Monaco/xterm use `--font-mono`, and no component
   declares a raw family string.

## 5. Duplicate styles (visually identical, separately implemented)

| # | Duplicate | Occurrences | Note |
|---|---|---|---|
| D1 | `text-[10px]` ≡ `text-xs` | 8 literal sites vs 150 token sites | Byte-identical rendering; §3.2 |
| D2 | `text-base` ≡ `text-md` (both 14px) | 3 vs 9 | Deliberate two-name split, unenforced |
| D3 | `text-[length:var(--font-md)]` ≡ `text-base` | 1 | Same token, longer spelling |
| D4 | Dialog title vs ask-question title (`text-md font-semibold text-text` ± `leading-none`) | 1 + 2 | Same style, one via the `DialogTitle` primitive, one hand-rolled |
| D5 | Shared `Button` type treatment vs 3 hand-rolled primary buttons | 1 vs 3 | `text-sm font-medium` + `bg-primary text-on-accent` re-declared |
| D6 | Eyebrow, 9 near-identical variants | 15 sites | §2.5 — differ only in weight/tracking/colour/size |
| D7 | Badge/pill, 5 treatments | 7 sites | §2.8 |
| D8 | `text-xs italic text-hint` empty-state placeholder | 8 sites, copy-pasted | Identical string in 7 tool-card files |
| D9 | `--font-body` (13px) ≡ `--font-base` (13px) | 2 tokens, 1 value | One feeds `text-base-mono`, the other feeds spacing |
| D10 | Card subtitle `text-xs leading-snug text-muted` | 2 sites | Same style, two files, no shared primitive |
| D11 | Mono-at-12px (`font-[var(--font-mono)] text-xs`) | 6 sites | An unnamed *de facto* third mono tier |
| D12 | `<input>` type treatment | 5 literals + 1 local constant | No `Input` primitive exists to own it (§2.7) |

## 6. Missing hierarchy (should probably share one semantic role)

### 6.1 `text-base` vs `text-md` — same value, opposite meaning, no guard

14px means "reading text" under one name and "heading" under the other. Nothing prevents a heading
from using `text-base` or body copy from using `text-md`, and `CenterTabs:257` already uses
`text-md font-medium` as a *screen heading* while `MarkdownPreview:19` uses the same 14px as a
*prose root*. If the two roles ever need different sizes, every one of the 12 sites must be
re-classified by hand.

### 6.2 Titles: four weights for one concept

Dialog title 14px/600 · ask-card title 14px/600 (hand-rolled) · in-page section 14px/500 ·
welcome **card** title 12px/500 · workspace screen heading 14px/500. `TYPOGRAPHY.md` says card title
= dialog title and screen heading = 14px/**400**; the code says otherwise in both places. So "title"
is currently 3 sizes × 3 weights with no single owner.

### 6.3 Input vs output: you type at 12px and read at 14px

`Composer` textarea is `text-sm`; the message it produces renders `text-base`. Same content, two
tiers, and no `input` role in the scale to reconcile them.

### 6.4 Eyebrow/section label has no owner

Nine variants (§2.5) for one semantic role, while the three `--uppercase-*` tokens that describe the
role exactly are dead. Adding a tenth surface today means picking arbitrarily from nine precedents.

### 6.5 "Small technical pill" has no owner

Badges (§2.8) split across mono/proportional and 10/11px, so `Soon`, `spec-first`, `Recommended` and
the diff-stat counter read as four different design languages in one product.

### 6.6 Metadata has two indistinguishable colour tiers

`text-xs text-hint` (56) and `text-xs text-muted` (25) are used for the same class of content
(timestamps, counts, paths, helper text) with no documented rule for choosing. `text-xs text-text`
(5) is a third, higher-contrast variant of the same role — including the **tooltip body**, which is
the only text in the app whose entire purpose is a tooltip yet carries no tooltip-specific role.

### 6.7 Empty states disagree with themselves

`text-xs italic text-hint` (8 tool cards) vs `text-sm text-hint` (panels/rails) vs
`text-sm text-muted` (rail placeholder, deliberately per `TYPOGRAPHY.md`) — three empty-state voices,
one of which is documented and two of which are not.

### 6.8 Line-height and tracking are outside the system

Six leading values and three tracking values, all Tailwind constants, none tokenised (§3.5). The
prose root's 1.65 already diverges from the global 1.6 with nothing recording why.

## 7. Component mapping (style → components)

Reverse index of §2. "→" reads *is used by*.

| Style (canonical spelling) | Components |
|---|---|
| **Brand display** `text-brand text-[44px]` | Welcome hero |
| **Brand inline** `text-brand text-lg` | Shell header wordmark |
| **Dialog title** `text-md font-semibold leading-none` | every `Dialog` (Settings, New Workspace, Skills, Templates, Login, Ext-UI, Template editor) via `ui/dialog` → plus hand-rolled twins in AskUserQuestionCard (question title, "Review your answers") |
| **Section heading** `text-md font-medium` | PrivacySettings, GithubSettings, ProvidersSettings, AppearanceSettings, TemplatesSettings, CenterTabs (workspace-ready heading) |
| **Compact title** `text-sm font-medium` | ConfirmPopover, Toast, Welcome cards, TemplatesSettings rows, PrivacySettings rows, ProvidersSettings rows, TemplateEditorDialog, DiagramCard, ComparisonCard, ErrorBoundary |
| **Reading text** `text-base` | chat user + assistant messages (`turns.tsx`), ProviderWarningBanner |
| **Prose root** `text-[length:var(--font-md)] leading-[1.65]` | MarkdownPreview (file preview) |
| **Default UI text** `text-sm` | Button (both sizes), textarea, Composer, command palette, dropdown items, Settings nav, ProjectTree rows, TreeRow, ChangesPanel, TerminalsPanel, SpecsPanel, CenterTabs, HistoryOverlay, SkillsDialog, LoginDialog, ModelSelector, ThinkingSelector, TodoList, ErrorBoundary, ProjectSkillsNotice, JetBrainsAiCard, GithubSettings, ProvidersSettings, NewWorkspaceDialog, ExtUiDialog, AskUserQuestionCard, ComparisonCard |
| **Metadata / helper** `text-xs text-hint` \| `text-muted` | 26 files — FileTree, ChangesPanel, SpecsPanel, TerminalsPanel, RightPanel, ProjectTree, CenterTabs, DiffPane, ChatHeader, ChatView, ActivityGroup, SessionStatsBar, StreamIndicator, ToolCard, ReadCard, WriteCard, EditCard, WebSearchCard, WebFetchCard, MermaidView, PanZoomView, Collapsible, ChatPlan, ModelSelector, SkillsDialog, SkillsButton, SlashCommandCompletion, HistoryOverlay, TemplateEditorDialog, TemplatesSettings, PrivacySettings, GithubSettings, ProvidersSettings, AppearanceSettings, JetBrainsAiCard, NewWorkspaceDialog, WelcomePanel, ProjectSkillsNotice, LoginDialog, Shell, ErrorBoundary, AskUserQuestionCard |
| **Tooltip body** `text-xs text-text` | `ui/tooltip` |
| **Eyebrow** (9 variants) | RightPanel (panel labels), TerminalsPanel, ProvidersSettings, ProjectTree (rail groups), dropdown-menu labels, CenterTabs (workspace-ready eyebrow), TemplatesSettings, SkillsDialog (group headers), HistoryOverlay (section headers), ThinkingSelector, TodoList (plan headers), SpecsPanel (`spec-role` chip, the app's only 9px text) |
| **Badge / pill** (5 variants) | SettingsDialog "Soon", WelcomePanel card tag, ComparisonCard "Recommended", AskUserQuestionCard pill, DiffStatBadge, NewWorkspaceDialog keycap |
| **Empty state** | tool cards (`text-xs italic text-hint`), FileTree/ChangesPanel/SpecsPanel/TerminalsPanel (`text-xs text-hint`), ProjectTree rail (`text-sm text-muted`) |
| **Code / output** `text-mono` | BashCard, CodeBlock, EditCard, toolRegistry (default tool renderer), ExtUiDialog (JSON editor), GithubSettings (`gh` commands), JetBrainsAiCard, SlashCommandCompletion, SettingsDialog badge, NewWorkspaceDialog keycap, TerminalInstance container |
| **Inline code** `text-base-mono` | `chat/Markdown` (prose inline code) |
| **Fenced code** `font-mono text-[0.85em]` | `chat/Markdown`, MarkdownPreview |
| **Mono-at-12px** (undocumented tier) | ProjectTree branch line, NewWorkspaceDialog refs, CenterTabs branch line, DiffPane header path, SkillsDialog skill name |
| **Monaco** | all file editors + both diff panes (`monacoSetup.sharedEditorOptions`) |
| **xterm** | TerminalInstance |
| **mermaid** | DiagramCard / MermaidView |

## 8. Recommendations (not applied)

Ordered by ratio of clarity gained to risk taken. Each is a *proposal*; none is implemented, and
several need a design decision that is explicitly **not** made here.

**Zero-visual-change consolidation (safe):**

1. Replace the 8 `text-[10px]` literals with `text-xs` — byte-identical output, removes D1.
2. Replace `text-[length:var(--font-md)]` with `text-base` — identical output, removes D3.
3. Use the shared `Button` (or its `buttonVariants`) at the 3 hand-rolled primary buttons — removes D5
   (15 files already import it).
4. Delete the dead tokens (`--font-lg2/-xl/-xxl`, `--uppercase-*`) **or** give them a role; and either
   map `--compact-font-base` to a utility (then use it at `SpecsPanel:171`) or stop writing it in
   `applyFontScale()`. Also decide whether `--font-body` and `--font-base` (both 13px, D9) should be
   one token.

**Needs a decision, then a small change:**

5. **Close the 11px proportional gap.** Either add one token (`--font-2xs`?) for the 4 `text-[11px]`
   sites, or rule that 10px/12px are the only small tiers and move those sites onto one. Today the
   scale has a hole and the code fills it by hand.
6. **Name the eyebrow role.** One utility (`text-eyebrow`) fixing size + weight + tracking, with
   colour left to the caller, would collapse 9 variants into 1 — and would finally give the
   `--uppercase-*` tokens a consumer. Requires choosing 400-vs-500 and `wide`-vs-`wider` (a visible
   change at some sites).
7. **Name the badge/pill role** (mono vs proportional, 10 vs 11px) — collapses 5 treatments into 1.
8. **Resolve `text-base` vs `text-md`.** Either enforce the split (lint rule / distinct values) or
   merge them into one 14px name. Two names for one value with no guard will keep drifting.
9. **Decide the composer's tier** (§6.3): either the input joins the reading tier, or the mismatch is
   recorded as intentional.
10. **Tokenise prose line-height** (`--line-height-prose: 1.65`) so the markdown root's divergence from
    1.6 is a decision rather than a literal.
11. **Document the markdown em-scale** in `TYPOGRAPHY.md` — it is the app's only relative type scale
    and currently exists only in code.

**Font-layer (highest user-visible impact):**

12. **Self-host the three families** (or bundle them) so a local/offline/binary launch renders the real
    type system rather than system fallbacks, and the app stops making a Google Fonts request at boot.
13. **Decide Cabinet Grotesk's fate:** load it (Fontshare/self-host) or make `--font-accent` fall back
    to Geist as `apps/website` already does. Today the brand renders as generic `sans-serif` in the app
    and as Geist on the site.
14. **Align the requested weight set with the used one** — drop the unused 700, add 800 if any accent
    fallback should legitimately be extra-bold instead of synthesised.

**Spec hygiene:**

15. Reconcile the three `TYPOGRAPHY.md` claims the code contradicts: welcome **card title** (spec
    14px/600, code 12px/500), **entity screen heading** (spec 400, code 500), and the five
    *undocumented* mono usages in §2.10 — either sweep the code or amend the spec, but they should not
    both stand.
16. Add a "sweep-debt" note naming the surfaces built in parallel with the sweep and therefore never
    swept (skills manager, prompt templates, history search, TODO plans, diff pane, privacy settings),
    so the next pass has a checklist instead of re-deriving it.

## 9. Specimen plan for the (deferred) showcase page

The showcase UI is intentionally **not built yet**. When it is, this section is its contract — the page
is a *view* of this document, and this document stays the source of truth after the page is deleted.

- **Sections, in order:** Display/Brand · Titles · Body/Reading · Caption & Metadata · Eyebrows ·
  Buttons & Controls · Inputs · Badges/Pills · Navigation & Tabs · Tooltip · Status · Code · Terminal ·
  Monaco · Chat · Markdown prose · Third-party (mermaid).
- **One card per numbered style in §2** (78 combinations, not 78 roles), each showing: the exact class
  string, the *resolved* family/size/weight/line-height/tracking/transform/colour, the site count, and
  its component list from §7.
- **Each specimen renders:** `ABCDEFGHIJKLMNOPQRSTUVWXYZ` / `abcdefghijklmnopqrstuvwxyz` /
  `0123456789` / "The quick brown fox jumps over the lazy dog."
- **Flags rendered inline:** `hardcoded` (§3), `duplicate-of` (§5), `no-owner` (§6), `unloaded-font`
  (§4) — so the audit's findings are visible on the specimen, not only in prose.
- **Constraints:** the page must apply the *live* utilities (no re-declared literals), so it re-themes
  with the theme engine and cannot drift from what components render; it must not introduce a token; and
  it must be removable in a single revert.

## Appendix A — reproducing the counts

Both scripts are throwaway (run from the repo root with `bun`), intentionally not committed as tooling.

```ts
// 1. Frequency of every typography class in component code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const files: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) && files.push(p);
  }
})("apps/web/src");
const RE =
  /(?<![-\w])(text-(?:xs|sm|base-mono|base|md|lg|mono|brand)|text-\[[^\]]+\]|font-(?:medium|semibold|bold|extrabold|normal)|font-\[var\(--font[a-z-]*\)\]|uppercase|capitalize|lowercase|italic|leading-[\w[\].\/-]+|tracking-[\w-]+)(?![-\w])/g;
const n = new Map<string, number>();
for (const f of files)
  for (const m of readFileSync(f, "utf8").matchAll(RE)) n.set(m[1], (n.get(m[1]) ?? 0) + 1);
console.log([...n].sort((a, b) => b[1] - a[1]));
```

The second script groups the same matches per string literal into the family/size/weight/tracking/
leading/transform/colour tuples of §2 and prints each tuple with its `file:line` sites; the combination
count (78) and every site list above come from its output.

Provenance queries used in §3:

```sh
git log -1 --format='%h %ad %s' --date=short -L '<line>,<line>:apps/web/src/<file>'   # who wrote this line
git diff --name-only bb503d0..a9e0a58 -- apps/web/src                                  # what the sweep touched
git log --diff-filter=A --format='%ad %s' --date=short -1 -- apps/web/src/<file>        # when a surface was added
```
