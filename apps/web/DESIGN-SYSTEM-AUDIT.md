# ThinkRail frontend design-system audit — `main` vs current workspace

Baseline: `main`. Proposed state: the current `refine-colors-and-fonts` workspace.

Scope: semantic colour architecture, theme manifests and derivations, typography primitives and styles,
component consumption, local overrides and duplication, generated files, documentation, and validation.
This is a read-only audit of frontend files. It does not propose a parallel system and makes no backend,
wire, state, session, tab, hydration, or streaming changes.

Values in the inventory are shown for the bundled default **Dark** theme. Every role still resolves through
all six self-contained manifests.

Validation observed during this audit:

- `colors:check` and `typography:check`: generated output is current.
- `colorUsage.test.ts`, `typographyUsage.test.ts`, and `themes/schema.test.ts`: pass.
- `typography.test.ts`: **9 failures** caused by stale assertions/fixtures that still pin `main` values.
- `e2e/typography.spec.ts`: not run, but its checked-in computed-style expectations still pin `main`
  values and contradict the current JSON; it is expected to fail at those assertions.
- No branch-added raw component colour, palette-variable escape hatch, colour opacity modifier, direct font
  declaration, arbitrary font size, or unknown generated class was found.

---

## Executive overview

The branch materially improves the system rather than bypassing it. The dark palette is now a coherent
Zinc/violet theme; control borders and disabled text have truthful semantic roles; regular proportional
text has a single 350-weight policy; UI, metadata, eyebrow, and mono changes are expressed in
`colors.json` / `typography.json`; and all generated CSS is current. The theme schema remains strict, the
colour adoption guard remains effective, and components continue to name semantic roles rather than
palette entries.

The main risks are not a parallel design system or hardcoded values. They are **validation drift,
semantic overreach, and cross-theme scope**:

1. The branch currently leaves the unit suite red: `typography.test.ts` has nine stale failures, while the
   computed-style e2e file also expects the old type scale. Generated-file checks alone did not catch this.
2. `hint` / `text-subtle` was restored, but its documented 3:1 contrast floor was not restored to
   `themes/schema.test.ts`.
3. A mechanical migration moved **166 component usages** from `text-subtle` to `text-muted`; only two
   `text-subtle` consumers remain. That is a global hierarchy change across every theme, not just the dark
   refresh, and it left several no-op hover states.
4. Chat chrome moved from `container-header-bg` to `container-workspace-bg`, and the right rail/terminal
   moved from `container-content-bg` to `container-sidebar-bg`. Because component role selection is
   theme-independent, these changes also alter Darcula, Gruvbox, and Light. The terminal now contradicts
   the documented meaning of `container-content-bg` and is coupled to both side rails.
5. `code.block` is a generated but dead semantic typography style. Multiline tool output instead uses
   `code.text`, with ad hoc `leading-relaxed` overrides in only two renderers.
6. The composer clipping fix contains the background, but it also clips the textarea’s outset
   `focus-visible:ring-*`; that is an unintended focus-state side effect.

The highest-priority work is therefore to repair the validation contract before making more visual
changes, then resolve the semantic role/scope questions deliberately. The dark palette, generated
pipelines, `control-border`, restored `text-subtle`, decoupled `text-disabled`, and 350-weight primitive
are architecturally sound and should remain.

---

## Diff from main

### Semantic colour source

`apps/web/src/styles/colors.json` adds:

- alpha step `wash: 12`;
- `text-disabled` → `disabled` at `strong` (60%);
- `control-border` → `border`;
- all feedback `*-subtle` fills remapped from `subtle` (10%) to `wash` (12%).

`text-subtle` remains in the final branch and still maps to `hint`. The earlier deletion was reversed.
No existing semantic role was deleted in the final state.

### Theme manifests and schema

All six manifests add a required `disabled` palette key. It intentionally differs from `muted` only in
Dark; the other five themes currently give the keys the same base value, but `text-disabled` still
renders differently because the role applies 60% alpha.

| Theme | `muted` | `disabled` | Relationship |
| --- | --- | --- | --- |
| Dark | `#babac1` | `#a1a1aa` | independently tuned |
| Darcula | `#aeb8c1` | `#aeb8c1` | same base today |
| Gruvbox | `#aea08c` | `#aea08c` | same base today |
| High Contrast Light | `#515151` | `#515151` | same base today |
| High Contrast | `#d0d0d0` | `#d0d0d0` | same base today |
| Light | `#5a5f6a` | `#5a5f6a` | same base today |

The Dark manifest is extensively reskinned:

| Palette key | `main` | Current | UI impact |
| --- | --- | --- | --- |
| `accent` | `#8f84ff` | `#8c81ff` | primary/actions/focus shift slightly |
| `background` | `#2b2b30` | `#09090b` | workspace/chat base becomes near-black |
| `header` / `content` | `#171719` | `#18181b` | central/header canvas becomes Zinc 900 |
| `sidebar` | `#171719` | `#101013` | both rails and terminal become darker |
| `input` | `#272830` | `#18181b` | controls become darker |
| `elevated` | `#2b2d30` | `#27272a` | raised surfaces become Zinc 800 |
| `hover` | `#393b40` | `#27272a` | all hovered/open/selected consumers become less bright |
| `border` | `#2b2d30` | `#27272a` | muted/control borders become Zinc 800 |
| `borderStrong` | `#43454a` | `#3f3f46` | default borders become Zinc 700 |
| `text` | `#dfe1e5` | `#f4f4f5` | primary text becomes brighter |
| `muted` | `#a8adb5` | `#babac1` | muted text becomes brighter |
| `hint` | `#81858c` | `#71717a` | subtle metadata becomes darker |
| `selection` / `editorSelection` | `#2d4f67` | `#8c81ff26` | selection becomes translucent violet |
| `info` | `#6ac8ff` | `#8c81ff` | info and link colour now equal primary |

`onAccent`, `bubbleAccent`, success, danger, warning, ANSI, and syntax palettes are unchanged.

Schema/runtime contract changes are otherwise clean: `disabled` is added to `THEME_COLOR_KEYS`, the JSON
schema, every manifest, and a semantic role. One test regression remains: the branch removed `hint` from
`schema.test.ts`’s `FLOORS` while temporarily deleting the tier, but did not restore it when
`hint`/`text-subtle` returned.

### Typography source

No font family or font-size primitive was added or hardcoded at call sites. The changes are semantic
remaps plus new weight/line-height/letter-spacing primitives:

| Item | `main` | Current | Reach |
| --- | --- | --- | --- |
| `fontWeights.light` | absent | 350 | ordinary proportional UI/body |
| line heights | `compact`, `code`, `default` | adds `tight`, `metadata`, `ui`, `relaxed` | semantic styles below |
| `letterSpacings.loose` | absent | `0.02em` | eyebrow/label pill |
| `ui.default` | 12px / 400 / 1.6 (19.2px) | 14px / 350 / `ui` (20px) | 87 direct class sites + body fallback |
| `ui.metadata` | 10px / 400 / 1.6 (16px) | 12px / 350 / `metadata` (16px) | 143 direct class sites |
| `ui.eyebrow` | 10px / 400 / 1.6 / 5% | 12px / 500 / `relaxed` / 2% | eyebrow + label-pill aliases |
| `body.reading` | 14px / 400 / 1.6 | 14px / 350 / 1.6 | chat/user body, markdown, entity aliases |
| `code.text` | 11px / 400 / 1.6 | 13px / 400 / `tight` (16px) | tool output, keycaps, technical text |
| `code.inline` | 13px / 400 / 1.6 | 13px / 400 / `relaxed` (20px) | prose inline + chat fenced code |
| `code.block` | canonical 11px / 1.5 | alias → `code.inline` | now dead as a standalone style |
| `code.otp` | 18px / 1.6 | 18px / `metadata` (24px) | login OTP |
| `chat.codeBlock` | → `code.block` (11px) | → `code.inline` (13px) | chat fenced code grows |
| `chat.tableBody` | → `ui.default` | → `ui.metadata` | remains 12px but becomes 350/16px |

`code.document` remains 13px / 1.5. Monaco and xterm intentionally remain at primitive `s11`; they do
not inherit the new 13px component code styles.

The generated source resolves to 20 canonical definitions + 29 aliases = 49 styles. The checked-in
`typography.test.ts` still expects 21 + 28 and several old values.

### Component usage

Meaningful net changes relative to `main`:

- **166** `text-text-subtle` usages become `text-text-muted` across chat, panels, tool cards, shared UI,
  placeholders, icons, empty states, statuses, and metadata. The restored `text-subtle` remains only on
  the workspace branch line and Specs role label.
- Twelve standard control borders move from `border-default` to `control-border`.
- Fifteen `bg-clip-padding` references are added (14 production call sites plus the colour-guard
  allowlist) to composite translucent borders against surrounding surfaces.
- Settings’ disabled “Soon” row and pill move from `text-subtle` plus parent opacity to
  `text-disabled`.
- Chat tab strip/header/composer surfaces move from header to workspace; relevant dividers move to
  `border-muted`.
- Turn-divider hairlines move from `border-default` to `border-muted`.
- Right rail and terminal move from content to sidebar; xterm reads `--container-sidebar-bg`.
- Terminal active tab uses `control-bg` and reserves `control-bg-hovered` for hover.
- User-bubble text moves from `text-default` to `text-muted`; its translucent background/border gains
  `bg-clip-padding`.
- Projects diff counters end with the same full feedback colours as `main`; the net visual change is
  `self-start` alignment to the row’s first line.
- Composer input wrapper adds `overflow-hidden` to clip the background to its radius.

These are all frontend class/token changes; no behavior or state boundary changed.

### Cross-theme impact of component role swaps

The semantic role changes above are global. They do not affect only Dark:

| Role swap | Darcula | Dark | Gruvbox | HC Light | HC | Light |
| --- | --- | --- | --- | --- | --- | --- |
| header → workspace/background | `#2b2b2b→#3c3f41` | `#18181b→#09090b` | `#1d2021→#282828` | same | same | `#ffffff→#f2f3f5` |
| content → sidebar | `#2b2b2b→#3c3f41` | `#18181b→#101013` | `#1d2021→#282828` | same | same | `#ffffff→#f2f3f5` |

The 166 subtle→muted migrations likewise change every theme from its `hint` value to its `muted`
value. This is a semantic hierarchy change, not merely a Dark palette refresh.

---

## Current token inventory

Legend: **yes (direct)** = a component names the generated class/utility; **yes (indirect)** = consumed
through an alias, prose root, global CSS, or JS integration; **no** = generated but unconsumed.
“Match” assesses role-name ↔ actual-use semantics, not visual preference.

### Text colors

| Token | Current source / Dark value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `text-default` | `text` / `#f4f4f5` | yes (149); titles, primary labels, tool output | yes |
| `text-muted` | `muted` / `#babac1` | yes (281); secondary text, placeholders, icons, empty states, system text, user bubble | **too broad after bulk migration** |
| `text-subtle` | `hint` / `#71717a` | yes (2); `ProjectTree` branch, `SpecsPanel` role label | yes, but nearly collapsed |
| `text-disabled` | `disabled` @ `strong` 60% / `#a1a1aa` @ 60% | yes (2); disabled Settings row + “Soon” pill | yes |
| `text-on-primary` | `onAccent` / `#ffffff` | yes (9); text/icons on primary fills | yes |
| `text-link` | `info` / `#8c81ff` (unpublished) | yes (indirect); `global.css` bare links | questionable in Dark because link/info/primary are identical |

### Containers

| Token | Current source / Dark value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `container-workspace-bg` | `background` / `#09090b` | yes (10); app base, chat body, chat tabs/header/composer | broad but coherent if chat chrome is workspace |
| `container-sidebar-bg` | `sidebar` / `#101013` | yes; both rails via `Shell`, xterm terminal | **terminal is unrelated to “sidebar”** |
| `container-header-bg` | `header` / `#18181b` | yes (10); panel headers, code/tool headers, settings rail | yes |
| `container-content-bg` | `content` / `#18181b` | yes (6); Monaco, markdown/diff/content canvas | yes, but docs still claim terminal |
| `container-elevated-bg` | `elevated` / `#27272a` | yes (45); dialogs, popovers, menus, cards, toasts | yes |

### Controls

| Token | Current source / Dark value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `control-bg` | `input` / `#18181b` | yes (24); inputs, textarea, active terminal tab | yes |
| `control-bg-hovered` | `hover` / `#27272a` | yes (80); hover **plus selected, active, highlighted, and open states** | **name is narrower than use** |
| `control-primary-bg` | `accent` / `#8c81ff` | yes (1); primary button primitive | yes; same value as `primary` intentionally |
| `control-primary-text` | `onAccent` / `#ffffff` | yes (1); primary button primitive | yes; same value as `text-on-primary` intentionally |
| `control-border` | `border` / `#27272a` | yes (12); form/control boundaries | yes; same value as `border-muted`, but role separation is useful |

### Borders

| Token | Current source / Dark value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `border-default` | `borderStrong` / `#3f3f46` | yes (95); cards, menus, panel chrome, strong separators | mostly yes; still broad |
| `border-muted` | `border` / `#27272a` | yes (9); chat/TODO/turn dividers, subtle command boundaries | yes |

`control-border` and `border-muted` are visually identical in every theme because both map to `border`.
This is acceptable semantic indirection: controls can be remapped globally without rewriting generic
separators. It should not be deleted merely because today’s value matches.

### Primary

| Token | Current source / Dark value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `primary` | `accent` / `#8c81ff` | yes (100); active text/icons, focus/borders, primary fill | yes |
| `primary-subtle` | `accent` @ `subtle` 10% | yes (19); selected/recommended surfaces | yes |
| `primary-soft` | `accent` @ 20% | yes (7); soft rings/highlights | yes |
| `primary-muted` | `accent` @ 40% | yes (14); translucent borders/rings | yes |
| `primary-strong` | `accent` @ 60% | yes (3); open-control border | yes |
| `on-primary-soft` | `onAccent` @ 20% | yes (1); selected-option detail | yes |

### Feedback

| Token | Current source / Dark value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `feedback-info` | `info` / `#8c81ff` | yes (3); markdown info, renamed git files | semantically distinct role, visually collides with primary in Dark |
| `feedback-info-subtle` | `info` @ `wash` 12% | yes (1); markdown info fill | same collision |
| `feedback-success` | `success` / `#6ad859` | yes (21); success state, added counters/icons | yes |
| `feedback-success-subtle` | `success` @ 12% | yes (4); success fills/diff additions | yes |
| `feedback-success-muted` | `success` @ 40% | yes (2); diff gutter/status decoration | yes |
| `feedback-error` | `danger` / `#ff4b75` | yes (35); errors, removed counters, destructive states | yes |
| `feedback-error-subtle` | `danger` @ 12% | yes (4); error fills/diff removals | yes |
| `feedback-error-muted` | `danger` @ 40% | yes (2); error borders/gutter | yes |
| `feedback-warning` | `warning` / `#ffd54b` | yes (14); warnings, edit status | yes |
| `feedback-warning-subtle` | `warning` @ 12% | yes (5); warning fills | yes |

The asymmetric absence of info/warning `-muted` roles is not dead architecture: no current consumer needs
them, and the colour guard correctly rejects unused published tokens.

### Selection

| Token | Current source / Dark value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `selection-bg` | `selection` / `#8c81ff26` | yes (indirect); native `::selection` | yes |
| `selection-text` | nullable `selectionForeground` / `inherit` | yes (indirect); native selection | yes |
| `editor-selection-bg` | `editorSelection` / `#8c81ff26` | yes (indirect); Monaco + xterm | yes |
| `editor-selection-text` | nullable `editorSelectionForeground` / consumer default | yes (indirect); Monaco + xterm | yes |

The browser/editor values are equal in Dark but remain independent manifest keys, which is clean: the
consumers can diverge by theme without changing components.

### Other color roles and effects

| Token | Current source / Dark value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `bubble-user-bg` | `bubbleAccent` @ 10% / `#6b57ff` tint | yes (1); `UserTurn` | yes |
| `bubble-user-border` | `bubbleAccent` @ 40% | yes (1); `UserTurn` | yes |
| `sunken` | dark effect `rgba(0,0,0,.12)` | yes (2); stats track, markdown chrome | yes |
| `overlay` | dark effect `rgba(0,0,0,.5)` | yes (1); dialog scrim | yes |
| `shadow-sm` | dark effect `0 2px 8px rgba(0,0,0,.3)` | yes (indirect); tooltip | yes |
| `shadow-md` | dark effect `0 4px 16px rgba(0,0,0,.35)` | yes (indirect); popovers/toasts/menus | yes |
| `shadow-lg` | dark effect `0 8px 28px rgba(0,0,0,.4)` | yes (indirect); dialog/pan-zoom | yes |

Effect literals are correctly centralized in `colors.json`; they are not component hardcodes.

### Typography — UI

| Token | Source / resolved value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `ui.default` / `.tr-text-ui` | canonical; interface 14px/20px, 350 | yes (87 direct) + `rootStyle`; general UI | yes |
| `ui.metadata` / `.tr-text-metadata` | canonical; interface 12px/16px, 350 | yes (143 direct); metadata/status rows | yes |
| `ui.eyebrow` / `.tr-text-eyebrow` | canonical; 12px × 1.5385 = **18.46px**, 500, 2%, uppercase | yes (17); section labels | role yes; computed line-height deserves confirmation |
| `ui.labelPill` / `.tr-text-label-pill` | alias → `ui.eyebrow` | yes; pills/badges | yes |
| `ui.action` / `.tr-text-action` | alias → `title.compact`; 12px/19.2px, 500 | yes; action labels | yes |
| `ui.emphasis` / `.tr-text-emphasis` | alias → `title.compact` | yes; inline UI emphasis | yes |

### Typography — Mono

| Token | Source / resolved value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `code.text` / `.tr-code-text` | canonical; JetBrains Mono 13px/16px, 400 | yes (29); tool/code output and technical text | too broad for both compact labels and multiline output |
| `code.inline` / `.tr-code-inline` | canonical; 13px/20px, 400 | yes (indirect); prose inline + chat fenced code | yes |
| `code.block` / `.tr-code-block` | alias → `code.inline`; 13px/20px | **no** direct or alias consumer | **dead semantic style** |
| `code.document` / `.tr-code-document` | canonical; 13px/19.5px, 400 | yes (indirect); document fenced code | yes |
| `code.otp` / `.tr-code-otp` | canonical; 18px/24px, 400, 10% tracking | yes (1); login OTP | visual role yes; `metadata` line-height name is misleading here |

Monaco and xterm use the primitive `s11` through JS options by design; they are not missing semantic
class consumers.

### Typography — other families

| Token(s) | Source / resolved value | Used / main consumers | Match |
| --- | --- | --- | --- |
| `brand.wordmark`, `brand.hero` | canonical; interface alias, 18px/44px, 800 | yes direct; shell wordmark, welcome hero | yes |
| `heading.xl` | canonical; 24px/30px, 600 | yes indirect; document h1 | yes |
| `heading.lg` | canonical; 20px/25px, 600 | yes indirect; document h2 | yes |
| `heading.md` | canonical; 18px/22.5px, 600 | yes indirect; chat h1 + document h3 | yes |
| `heading.sm` | canonical; 16px/20px, 600 | yes indirect; document h4 | yes |
| `title.dialog` | canonical; 14px/17.5px, 600 | yes direct + aliases | yes |
| `title.card` | alias → `title.dialog` | yes direct | yes |
| `title.section` | canonical; 14px/22.4px, 500 | yes direct; settings sections | yes |
| `title.compact` | canonical; 12px/19.2px, 500 | yes direct + UI aliases | yes |
| `title.entity` | alias → `body.reading`; 14px/22.4px, 350 | yes direct; tab entity title | yes |
| `body.reading` / `.tr-text-reading` | canonical; 14px/22.4px, 350 | yes direct + prose/title aliases | yes |

#### Prose systems

Every token below is consumed through its root class; individual semantic classes need not appear at a
call site. “Used” means reachable from the mounted `.tr-prose-chat` / `.tr-prose-doc` root.

| Token | Current mapping / resolved value | Used / main consumer | Match |
| --- | --- | --- | --- |
| `chat.body` | alias → `body.reading`; 14px/22.4px, 350 | yes; chat markdown body | yes |
| `chat.h1` | alias → `heading.md`; 18px/22.5px, 600 | yes; chat markdown | yes |
| `chat.h2` | alias → `title.dialog`; 14px/17.5px, 600 | yes; chat markdown | yes |
| `chat.h3` | canonical; 12px/19.2px, 600 | yes; chat markdown + table-header alias | yes |
| `chat.h4` | alias → `title.compact`; 12px/19.2px, 500 | yes; chat markdown | yes |
| `chat.h5` | alias → `title.compact`; 12px/19.2px, 500 | yes; chat markdown | yes |
| `chat.h6` | canonical; 10px/16px, 500, uppercase/5% | yes; chat markdown | yes |
| `chat.inlineCode` | alias → `code.inline`; 13px/20px, 400 mono | yes; chat markdown | yes |
| `chat.codeBlock` | alias → `code.inline`; 13px/20px, 400 mono | yes; chat fenced code | yes |
| `chat.blockquote` | alias → `body.reading` | yes; chat markdown | yes |
| `chat.list` | alias → `body.reading` | yes; chat markdown | yes |
| `chat.tableBody` | alias → `ui.metadata`; 12px/16px, 350 | yes; chat tables | yes |
| `chat.tableHeader` | alias → `chat.h3`; 12px/19.2px, 600 | yes; chat tables | yes |
| `doc.body` | alias → `body.reading`; 14px/22.4px, 350 | yes; markdown preview | yes |
| `doc.h1` | alias → `heading.xl`; 24px/30px, 600 | yes; markdown preview | yes |
| `doc.h2` | alias → `heading.lg`; 20px/25px, 600 | yes; markdown preview | yes |
| `doc.h3` | alias → `heading.md`; 18px/22.5px, 600 | yes; markdown preview | yes |
| `doc.h4` | alias → `heading.sm`; 16px/20px, 600 | yes; markdown preview | yes |
| `doc.h5` | alias → `title.dialog`; 14px/17.5px, 600 | yes; markdown preview | yes |
| `doc.h6` | canonical; 12px/15px, 600, uppercase/5% | yes; markdown preview | yes |
| `doc.inlineCode` | alias → `code.inline`; 13px/20px, 400 mono | yes; markdown preview | yes |
| `doc.codeBlock` | alias → `code.document`; 13px/19.5px, 400 mono | yes; document fenced code | yes |
| `doc.blockquote` | alias → `body.reading` | yes; markdown preview | yes |
| `doc.list` | alias → `body.reading` | yes; markdown preview | yes |
| `doc.tableBody` | alias → `body.reading`; 14px/22.4px, 350 | yes; document tables | yes |
| `doc.tableHeader` | alias → `title.dialog`; 14px/17.5px, 600 | yes; document tables | yes |

### Typography primitives

All current primitives are referenced either by a semantic style or an allowed third-party integration;
none is dead.

- Families: `interface` (Geist Variable), `code` (JetBrains Mono Variable), `brand` → `interface`.
- Weights: `light` 350, `regular` 400, `medium` 500, `semibold` 600, `brand` 800.
- Sizes: `s10`, `s11`, `s12`, `s13`, `s14`, `s16`, `s18`, `s20`, `s24`, `s44`.
- Line heights: `tight` 1.2307692, `compact` 1.25, `metadata` 1.3333333, `ui` 1.4285714,
  `code` 1.5, `relaxed` 1.5384615, `default` 1.6.
- Letter spacing: `normal`, `loose` 0.02em, `wide` 0.05em, `widest` 0.1em, `brand` 0.5px.

---

## Problems and inconsistencies

Only concrete issues are listed. “Introduced” means net-new relative to `main`; “pre-existing” means the
branch did not create it but the current proposed state still contains it.

### 1. `typography.test.ts` is red against the proposed source

**Classification:** Validation/test constraint · Documentation drift · **P0** · introduced.

`bun test apps/web/src/styles/typography.test.ts` produces nine failures. Stale assertions still expect:
21 canonical/28 alias styles, only three line-height primitives, no 350 weight, UI weight 400, chat code
11px, document code strictly larger than chat code, and a probe fixture that routes `chat.codeBlock`
through the now-aliased `code.block`. The source, generated CSS, `TYPOGRAPHY.md`, and
`typographyUsage.test.ts` agree with one another; this test does not.

This is not harmless test wording: `bun run test` is currently failing, and the reference-fixture drift
obscures whether alias validation itself is working.

### 2. Computed-style e2e expectations still pin `main`

**Classification:** Validation/test constraint · Documentation drift · **P0** · introduced.

`e2e/typography.spec.ts` still expects eyebrow 10/400/0.5px, document body weight 400, UI 12px/19.2px,
metadata 10px, and root 12px. Current values are eyebrow 12/500/0.02em, document body 350, UI 14/20,
metadata 12/16, and root 14/20. Monaco/xterm’s 11px expectations remain correct.

### 3. Restored `text-subtle` has no enforced contrast floor

**Classification:** Validation/test constraint · Documentation drift · **P0** · introduced.

`apps/web/SPEC.md` and `themes/SPEC.md` say `hint` is tested at ≥3:1. `themes/schema.test.ts` now calls
`muted` “the quietest text tier” and omits `hint`, even though `hint`/`text-subtle` was restored and is
used for meaningful 12px branch/spec metadata. Every current manifest already passes ≥3:1 on all resting
surfaces (minimum observed: Dark elevated/hover ≈3.08), so restoring the test requires no visual change.

### 4. Composer clipping removes the outset focus ring

**Classification:** Unintended scope · Local override · **P0** · introduced.

`chat/Composer.tsx` adds `overflow-hidden` to the rounded background wrapper. That contains the intended
background/backdrop, but the wrapper is also the textarea’s ancestor; it clips the existing
`focus-visible:ring-2 focus-visible:ring-primary-soft`, which paints outside the textarea box. The
`focus:border-primary` remains, but the branch unintentionally weakens the established keyboard focus
state while fixing background bleed.

### 5. The 166-site `text-subtle` → `text-muted` migration is over-broad

**Classification:** Unintended scope · Incorrect semantic usage · Architecture · introduced.

The final architecture contains both roles, but `text-subtle` now has only two consumers while
`text-muted` has 281. The mechanical migration includes distinct concepts: placeholders, decorative
icons, timestamps, hints, empty states, inactive labels, statuses, system messages, and user-authored
message content. It also changes all six themes, not only Dark. A semantic tier that only survives at two
sites is effectively absent from most of the interface even though the docs describe it as the
secondary-metadata tier.

The migration also creates no-op states where base and hover colours are both `text-muted`, including:

- `chat/tools/AskUserQuestionCard.tsx:580`;
- `panels/ChangesPanel.tsx:239`;
- `panels/RightPanel.tsx:50,94`;
- `panels/BranchPicker.tsx:92`;
- `panels/SpecsPanel.tsx:163`.

`ModelSelector`’s `disabled:hover:text-text-muted` is not a no-op; it intentionally overrides the normal
hover colour.

### 6. Terminal background uses the sidebar role

**Classification:** Incorrect semantic usage · Naming · Architecture · Documentation drift · introduced.

`TerminalInstance.tsx` and the terminal shell changed from `container-content-bg` to
`container-sidebar-bg`. `colors.json` still documents `container-content-bg` as the code canvas including
the terminal. A future sidebar adjustment now changes xterm; a future code-canvas adjustment does not.
The desired Dark value may be correct, but the semantic dependency is not.

This is the clearest missing role in the current colour system: terminal/chrome background is being
simulated through an unrelated sidebar role.

### 7. Chat/right/terminal surface rewires unintentionally affect other themes

**Classification:** Unintended scope · Architecture · introduced.

The role changes produce visibly different surfaces in Darcula, Gruvbox, and Light (see the cross-theme
table above). If the intent was a Dark-only visual adjustment, component role swaps are the wrong layer;
a theme manifest value or a new independently-themed semantic role is required. High-contrast themes
happen to mask the issue because their relevant palette values are equal.

### 8. `control-bg-hovered` represents selected/open/active states

**Classification:** Naming · Incorrect semantic usage · Architecture · pre-existing, made more visible by
the Dark hover remap.

The token is used for actual hover plus selected command items, active project/tree rows, open model and
thinking selectors, active history rows, and open row actions. Dark `hover` is now also equal to
`elevated`/`border`, so all these states move together. A missing selected/open state role is currently
simulated by the hover role.

### 9. `code.block` is dead; multiline output has inconsistent local line-height overrides

**Classification:** Dead token · Local override · Token duplication · Validation/test constraint ·
introduced.

`code.block` aliases `code.inline`, generates `.tr-code-block`, and has no direct consumer or alias
reference. Typography has no equivalent of the colour system’s dead-role test, so this passes
`typographyUsage.test.ts`.

Meanwhile multiline output generally uses `tr-code-text` (13/16). `BashCard.tsx` and `EditCard.tsx`
locally add `leading-relaxed`, while error output and other tool renderers retain 13/16. The exceptions are
allowed by current policy, but they expose a missing semantic assignment: a generated block style exists
while block consumers compose a text style plus local line-height.

### 10. `ui.eyebrow` has a fractional, weakly named line-height relationship

**Classification:** Naming · Architecture · introduced.

The branch introduced `lineHeight: relaxed` while the eyebrow was temporarily 13px, then reduced the
eyebrow to 12px without changing that ratio. The primitive is documented as 13px→20px; at 12px it
computes to ≈18.46px, not 20px. Nothing records whether 18.46px is intended. The
primitive ladder also mixes scalar names (`tight`, `compact`, `relaxed`, `default`) with role names
(`ui`, `metadata`); `code.otp` therefore reads `lineHeight: metadata` simply because both need a 4/3
ratio.

### 11. Dark `info`, links, and primary are visually identical

**Classification:** Incorrect semantic usage · Token duplication · introduced.

Dark maps both `info` and `accent` to `#8c81ff`. Therefore `feedback-info`,
`feedback-info-subtle`, `text-link`, and all primary tokens lose visual distinction. This is not a token
architecture failure—the roles are separate—but the current manifest defeats the semantic distinction.

### 12. User message body uses the secondary-text role

**Classification:** Incorrect semantic usage · introduced.

`chat/turns.tsx:107` changes user-authored message content from `text-default` to `text-muted`.
`text-muted` passes the contrast floor, so this is not an accessibility failure, but the content is not
metadata or disabled UI. Keep only if intentionally de-emphasizing the user side of the conversation;
otherwise the semantic role is misleading.

### 13. `subtle` 10% and `wash` 12% are near-duplicate alpha primitives

**Classification:** Token duplication · **P2** · introduced.

The 12% `wash` step is used only by feedback `*-subtle`; 10% remains for primary/bubble subtle fills.
The derivation is centralized and documented, so it is architecturally valid, but the 2-point difference
creates a second low-alpha primitive with limited visual separation.

### 14. Top-level typography documentation still names the old weight policy

**Classification:** Documentation drift · introduced.

`apps/web/SPEC.md` still calls the system the “400/500/600 weight policy.” Current proportional regular
UI/body is 350, code is 400, and the full policy is 350/400/500/600/800. `TYPOGRAPHY.md` is correct.

### 15. Local/hardcoded-value review

**Classification:** Local override · documentation precision · pre-existing.

No component bypasses semantic colour with a raw value, and no component bypasses semantic typography
with direct size/family/weight/tracking declarations. The only typography overrides are the documented
`italic` and `leading-*` exceptions. The two inline style objects in `PanZoomView.tsx` (dynamic zoom) and
`turns.tsx` (dynamic transition duration) are pre-existing, non-colour, non-typography runtime values;
they do not form a parallel design system. The absolute “never inline style objects” wording in
`COLOR.md`/module guidance should be understood as design-value policy or explicitly document these
runtime exceptions.

Repeated exact class strings exist in tool empty/error states, but most are simple utility composition
rather than duplicated token definitions. The one maintainability-relevant duplicate is the block-output
pattern described in issue 9.

---

## Refactoring recommendations

No refactor is implemented by this audit.

### P0 — correctness and architecture

#### P0.1 — Repair typography validation before further type changes

- **Affected:** `styles/typography.test.ts`, `e2e/typography.spec.ts`.
- **Change:** update canonical/alias counts, primitive maps, 350-weight policy assertions, chat/doc code
  relationship, and reference probe fixture; update computed-style e2e expectations to the current JSON.
- **Why:** the proposed branch currently fails unit tests and contains e2e expectations known to
  contradict production CSS.
- **Expected visual impact:** none.
- **Migration risk:** low; assertion-only, but run the full unit suite and targeted typography e2e.
- **Mechanism:** test remap; no new token, rename, or deletion required.
- **Revert instead?** No. The source/generated architecture is coherent; the tests are stale.

#### P0.2 — Restore contrast coverage for `hint` / `text-subtle`

- **Affected:** `themes/schema.test.ts`, `apps/web/SPEC.md`, `themes/SPEC.md`, `COLOR.md`.
- **Change:** restore `hint: 3` to the resting/hover contrast matrix and describe it consistently.
- **Why:** the token is live and meaningful; specs already claim the floor exists.
- **Expected visual impact:** none; all current manifests pass (minimum ≈3.08).
- **Migration risk:** low.
- **Mechanism:** validation restoration; no token change.
- **Revert instead?** No; keep the restored `text-subtle` role.

#### P0.3 — Preserve the composer focus ring while clipping only its background layer

- **Affected:** `chat/Composer.tsx` input wrapper/textarea.
- **Change:** replace ancestor `overflow-hidden` with a structural clip limited to the background/backdrop,
  or move the focus ring to an unclipped focus-visible owner while preserving the same ring tokens.
- **Why:** the current fix removes the established outset focus ring.
- **Expected visual impact:** background remains contained; keyboard ring returns.
- **Migration risk:** medium; needs a focused visual/e2e check for slot highlighting, scroll sync, radius,
  and focus.
- **Mechanism:** component refactor only; no token.
- **Revert instead?** **Replace, do not leave as-is.** A plain revert restores background bleed; the
  clipping implementation, not the requirement, should be reverted/refactored.

### P1 — consistency and maintainability

#### P1.1 — Reclassify the 166 muted-text migrations by semantic role

- **Affected:** all `text-text-muted` additions in `main...HEAD`; especially placeholders, empty states,
  timestamps, inactive icons, status labels, system messages, and user content.
- **Change:** review by concept, retaining `text-muted` where AA-strength secondary text is intended and
  restoring `text-subtle` only for genuinely quiet metadata/decorative labels; remove no-op hover states.
- **Why:** a mechanical global replacement erased most of the intended two-tier hierarchy.
- **Expected visual impact:** selected quiet metadata becomes less prominent; ordinary secondary text
  remains unchanged.
- **Migration risk:** medium/high churn, low per-site risk; screenshot all six themes.
- **Mechanism:** component remap only; no new token.
- **Revert instead?** Do **not** blindly revert all 166 sites. Selective semantic remapping is safer.

#### P1.2 — Give terminal background a truthful semantic role

- **Affected:** `TerminalInstance.tsx`, terminal wrappers in `Shell.tsx`, `colors.json`, manifests only if
  per-theme independent values are required.
- **Change:** introduce `container-terminal-bg` (initially it may map to the existing `sidebar` palette
  value), or restore `container-content-bg` if terminal should remain part of the code canvas. Update the
  `container-content-bg` note either way.
- **Why:** terminal is currently coupled to an unrelated sidebar role and contradicts documentation.
- **Expected visual impact:** none if the new role initially maps to `sidebar`; restoring content changes
  the terminal back to each theme’s content colour.
- **Migration risk:** low for role-only indirection; medium if adding a new manifest key for independent
  per-theme control.
- **Mechanism:** **new semantic role** (and optional new manifest key) or component remap.

#### P1.3 — Decide whether chat/rail surface changes are semantic or Dark-only

- **Affected:** `ChatHeader`, `Composer`, `CenterTabs`, right-panel wrappers in `Shell`.
- **Change:** if these components truly belong to workspace/sidebar roles, keep the component mappings and
  explicitly accept the cross-theme changes. If the requirement was Dark-only, restore the original
  component roles and express the Dark distinction through appropriately named palette/semantic roles.
- **Why:** the current component remap silently changes Darcula, Gruvbox, and Light.
- **Expected visual impact:** decision-dependent; see cross-theme table.
- **Migration risk:** medium because all themes need visual review.
- **Mechanism:** remap or new role/key; no parallel system.
- **Revert instead?** **Revert the role swaps** if Dark-only scope is confirmed.

#### P1.4 — Separate hover from selected/open state

- **Affected:** `control-bg-hovered` consumers in command completion, ProjectTree, TreeRow, history,
  selectors, row actions, and `components/ui/command.tsx`.
- **Change:** add a semantic `control-bg-selected`/`control-bg-active` role mapped to the current `hover`
  value initially; migrate persistent selected/open states, leaving transient hover on
  `control-bg-hovered`.
- **Why:** one token currently represents unrelated interaction states and cannot evolve independently.
- **Expected visual impact:** none initially.
- **Migration risk:** medium due roughly a dozen conditional consumers.
- **Mechanism:** **new token**; add a manifest key only if themes must vary selected and hover separately.

#### P1.5 — Use or remove `code.block`; eliminate block-output overrides

- **Affected:** `code.block`, `BashCard`, `EditCard`, tool error/output `<pre>` surfaces,
  `typographyUsage.test.ts`.
- **Change:** preferred: make `.tr-code-block` the semantic class for multiline tool output and remove
  local `leading-relaxed`; migrate equivalent output surfaces consistently. If no standalone block role is
  desired, delete `code.block` instead.
- **Why:** a dead generated style coexists with inconsistent local line-height composition.
- **Expected visual impact:** tool output converges on one line-height (currently some are 16px and two use
  Tailwind relaxed).
- **Migration risk:** medium visual, low architecture risk.
- **Mechanism:** remap + possible deletion; no new family/system.

#### P1.6 — Add dead-style validation for typography

- **Affected:** `typographyUsage.test.ts` / typography validation.
- **Change:** require every generated semantic class to have a direct consumer or be reachable from a used
  alias/prose mapping, analogous to `colorUsage.test.ts`’s dead-role guard.
- **Why:** `code.block` currently survives unnoticed.
- **Expected visual impact:** none.
- **Migration risk:** low after P1.5 resolves the existing dead style.
- **Mechanism:** validation rule.

#### P1.7 — Restore semantic distinction between Dark info and primary

- **Affected:** Dark `info`, `text-link`, `feedback-info*`.
- **Change:** give Dark `info` a distinct informational hue. If links should remain brand-violet, remap
  `text-link` from `info` to `accent`; the role already exists and is unpublished.
- **Why:** separate semantic tokens currently render identically, so info cannot signal independently.
- **Expected visual impact:** info banners/renamed-file decoration change hue; links can remain unchanged.
- **Migration risk:** low, Dark-only manifest/role remap; requires design approval.
- **Mechanism:** manifest value + optional remap; no new token.

#### P1.8 — Confirm the user-message text hierarchy

- **Affected:** `chat/turns.tsx` `UserTurn`.
- **Change:** keep `text-muted` only if intentionally de-emphasizing user turns; otherwise restore
  `text-default`.
- **Why:** message content is primary content, not metadata.
- **Expected visual impact:** user message text brightens if reverted.
- **Migration risk:** low.
- **Mechanism:** component remap.
- **Revert instead?** Flagged for explicit design decision; revert if semantic hierarchy, rather than
  visual preference, governs the role.

#### P1.9 — Sync top-level typography documentation

- **Affected:** `apps/web/SPEC.md` weight-policy sentence and terminal/content note in colour docs/source.
- **Change:** document 350/400/500/600/800 accurately and reconcile terminal role wording after P1.2.
- **Why:** module-level architecture currently disagrees with the authoritative JSON.
- **Expected visual impact:** none.
- **Migration risk:** none.
- **Mechanism:** documentation only.

### P2 — optional cleanup

#### P2.1 — Confirm eyebrow computed line-height and normalize primitive naming

- **Affected:** `ui.eyebrow`, `lineHeights.relaxed`, `metadata`, `ui`.
- **Change:** decide whether ≈18.46px is intentional. If 20px is required, add/remap to a primitive that
  actually computes to 20px at 12px. Separately rename role-like line-height ids to a consistent scalar
  vocabulary so OTP does not reference a primitive named `metadata`.
- **Why:** current names hide the computed result and cross-purpose reuse.
- **Expected visual impact:** none for renames; possible eyebrow line-height change if 20px is chosen.
- **Migration risk:** low; generated CSS and computed-style tests must be updated.
- **Mechanism:** rename/remap; add a primitive only if no current ratio expresses the approved value.

#### P2.2 — Re-evaluate `wash` 12% vs `subtle` 10%

- **Affected:** alpha scale and feedback `*-subtle` roles.
- **Change:** retain both only if the 2% distinction is deliberate and visually validated; otherwise map
  feedback back to `subtle` and delete `wash`.
- **Why:** near-duplicate primitives increase the tint ladder for limited separation.
- **Expected visual impact:** at most a 2-point alpha change.
- **Migration risk:** low.
- **Mechanism:** remap + deletion.

#### P2.3 — Clarify dynamic inline-style policy

- **Affected:** design-system documentation, not the two runtime usages.
- **Change:** state that dynamic geometry/timing custom properties are allowed when utilities cannot encode
  runtime values, while design values (colour/type/spacing constants) remain forbidden inline.
- **Why:** current absolute wording is contradicted by two legitimate pre-existing uses.
- **Expected visual impact:** none.
- **Migration risk:** none.
- **Mechanism:** documentation only.

---

## Explicit revert flags

- **Replace/revert the composer wrapper’s ancestor `overflow-hidden` implementation** (P0.3); do not
  accept the clipped focus ring as an incidental cost of background containment.
- **Revert chat/right/terminal component role swaps only if the intended scope was Dark-only** (P1.3).
  Keeping them means intentionally changing Darcula, Gruvbox, and Light too.
- **Revert `UserTurn` to `text-default` if semantic hierarchy is authoritative** (P1.8); otherwise record
  the de-emphasis as deliberate.
- Do **not** revert the dark palette, generated pipelines, 350 weight primitive, restored
  `text-subtle`, decoupled `text-disabled`, `control-border`, `bg-clip-padding`, muted divider roles,
  terminal-tab hover correction, or diff-counter alignment. Those changes are structurally clean.

All recommendations preserve the existing two-layer colour system, generated typography classes,
manifest catalog, validation architecture, and frontend module boundaries.
