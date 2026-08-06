# ThinkRail Design-System Audit — `refine-colors-and-fonts` vs `main`

Baseline: `main`. Proposed state: `refine-colors-and-fonts` (this workspace).
Source of truth: `git diff main...HEAD` + current repo files. Read-only review — no production code changed.

Scope: semantic color architecture, theme manifests + derivations, typography tokens/primitives, token
usage in components, hardcoded values / local overrides / duplication, name↔semantics↔usage consistency,
generated files + validation rules.

Gate status on this branch: `colors:check` ✅, `typography:check` ✅, `colorUsage.test` ✅,
`typographyUsage.test` ✅, `themes/schema.test` (contrast) ✅, `biome` ✅, `typecheck` ✅. No raw
hex / `rgb()` / `bg-[var(--palette)]` / inline `style` / opacity-modifier bypasses were introduced (the
adoption guards would fail otherwise).

---

## Executive overview

**What improved**

- The dark theme moved to a coherent **Zinc-surface + violet-accent** palette, applied entirely through
  the manifest (`themes/bundled/dark.theme.json`) — no component churn, no hardcoded values.
- Two genuine, architecture-consistent **extensions**: a `control-border` token (joins the `control-*`
  family exactly like `control-primary-bg`) and a richer **type scale** (UI 14/20 + 12/16, mono 13px
  tiers, eyebrow 12/medium/2%) with new line-height/letter-spacing **primitives** rather than call-site
  overrides.
- The whole change stayed inside the generated pipeline: `colors.json`/`typography.json` → generated CSS,
  with the docs (`COLOR.md`, `TYPOGRAPHY.md`) updated alongside. Generated files are not stale.

**What is still problematic**

- **The `hint` / `text-subtle` tier was deleted globally** and its 168 call sites were folded into
  `text-muted`. This brightened quiet/metadata text across **every** theme and surface — a much broader
  visual change than "refine dark colors," and it removed a distinct readable tier the palette still
  defined per theme.
- A new **`text-disabled`** token was then added and used for *functional metadata* (branch names, spec
  type labels). It is effectively the old `text-subtle` role under a **misleading name**, is the only
  **translucent** text token, and renders **below the AA contrast floor** (it is intentionally excluded
  from the contrast gate).
- Several **near-duplicate / single-consumer / cross-purpose tokens** were introduced (`subtle` 10% vs
  `wash` 12%; `control-border` ≡ `border-muted`; the `metadata` line-height shared by `ui.metadata` and
  `code.otp`; role-named line-heights `ui`/`relaxed` with one consumer each).
- Dark **`info` now equals the accent** (`#8c81ff`), so the "info" feedback family is visually
  indistinguishable from `primary` in dark.
- The overhaul is **dark-only** at the manifest layer, but the **role/scale/typography changes are
  global** — the other five themes inherit the type bump, the `wash` step, and the `hint` collapse while
  keeping their original palettes.

**Main refactoring risks**

- Re-introducing a distinct quiet-metadata tier (to undo the `hint` collapse) touches the same 168 call
  sites — high churn, low individual risk (mechanical), but wide blast radius.
- Renaming `text-disabled` → a truthful name is cheap (2 consumers) but is a published-token rename
  (touch generated CSS + the 2 call sites + docs).
- Nothing here is destabilizing to V1 behavior — all issues are naming/semantics/scope, not correctness
  of session/tab/state/hydration/streaming (none of which were touched).

---

## Diff from main — meaningful color & typography changes

### Color — semantic layer (`colors.json`, global; affects all themes)

| Change | Detail | UI impact |
| --- | --- | --- |
| `text-subtle` role **removed** | was `from: hint` | the quiet text tier is gone; see the `hint` removal below |
| `text-disabled` role **added** | `from: muted, alpha: strong` (muted @ 60%, translucent) | new dim metadata tier; used in 2 places |
| `control-border` role **added** | `from: border` (≡ `border-muted` value) | dedicated control border; wired to controls |
| `wash` scale step **added** (12%) | feedback `-subtle` re-pointed `subtle`(10%) → `wash`(12%) | feedback callout fills 10%→12% in **all** themes |

### Color — dark manifest (`dark.theme.json`, dark only)

Full Zinc + violet re-skin: `accent #8f84ff→#8c81ff`, `background #2b2b30→#09090b`,
`header/content #171719→#18181b`, `sidebar #171719→#101013`, `input #272830→#18181b`,
`elevated #2b2d30→#27272a`, `hover #393b40→#3f3f46`, `border #2b2d30→#27272a`,
`borderStrong #43454a→#3f3f46`, `text #dfe1e5→#f4f4f5`, `muted #a8adb5→#a1a1aa`,
`selection`/`editorSelection #2d4f67→#8c81ff26` (accent @ 15%), **`info #6ac8ff→#8c81ff` (= accent)**.
`bubbleAccent` left at `#6b57ff` (not re-aligned). `hint` key removed.

### Color — other manifests (light/darcula/gruvbox/high-contrast/high-contrast-light)

Only change: **`hint` key removed**. Palettes otherwise untouched. Their former `text-subtle` usages now
resolve to their own `muted`.

### Color — schema/tests

`hint` removed from `THEME_COLOR_KEYS`, `theme.schema.json`, and the contrast `FLOORS` map (was
`{text, muted, hint, accent}` → `{text, muted, accent}`).

### Typography (`typography.json`, global; all themes)

| Token | main | branch | UI impact |
| --- | --- | --- | --- |
| `ui.default` | 12px / 1.6 | **14px / 20px** (`ui` LH) | base UI + `<body>` root grows to 14px |
| `ui.metadata` | 10px / 1.6 | **12px / 16px** (`metadata` LH) | metadata text grows to 12px |
| `ui.eyebrow` | 10 / 400 / 1.6 / `wide` | **12 / 500 / 20px / `loose`(2%)** | eyebrows larger, medium, tighter tracking |
| `code.text` | 11px / 1.6 | **13px / 16px** (`tight`) | tool-card/code output grows to 13px |
| `code.inline` | 13px / 1.6 | 13px / **20px** (`relaxed`) | inline code line-height up |
| `code.block` | 11px / 1.5 | **`$ref code.inline`** (13px / 20px) | chat fenced code 11px→13px |
| `code.otp` | 18px / 1.6 | 18px / **24px** (`metadata` LH) | OTP line-height tightened |
| `chat.codeBlock` | `→ code.block` | **`→ code.inline`** | chat fenced code == doc code (13px) |
| `chat.tableBody` | `→ ui.default` | **`→ ui.metadata`** | chat table body stays 12px (didn't follow ui.default→14) |
| new line-heights | — | `tight` 1.2308, `metadata` 1.3333, `ui` 1.4286, `relaxed` 1.5385 | 3→7 line-height primitives |
| new letter-spacing | — | `loose` 0.02em | eyebrow tracking |

Docs synced: `COLOR.md` (Text/Control/Feedback rows, alpha ladder), `TYPOGRAPHY.md` (lineHeights,
canonical/alias count 20+29, fenced-code row, weight policy), `themes/SPEC.md`.

### Components (74 files)

- **168 `text-text-subtle` → `text-text-muted`** replacements (the `hint` collapse) across ~50 files —
  the bulk of the component diff, purely mechanical.
- Targeted rewires: composer background→`workspace-bg` + top divider→`border-muted`; terminal
  surface→`sidebar-bg` (Shell + `TerminalInstance`); content-panel **selected row**→`sidebar-bg`
  (`TreeRow`, `ChangeRowActions`, `SpecsPanel`); Projects-rail diff counters→`feedback-*-muted`
  (`DiffStatBadge` + `ProjectTree`); `control-border` wired into button/textarea/composer/selectors/
  segmented control/ExtUi+Login inputs; branch line + spec role label→`text-disabled`.
- `UI-TERMINOLOGY.md` added (docs only).

---

## Current token inventory

Legend for "semantics match usage": ✅ ok · ⚠ questionable · ❌ mismatch. Values shown for the **dark**
theme (roles resolve per-theme through the manifest).

### Text colors

| Token | Source | Value (dark) | Used | Main consumers | Semantics match |
| --- | --- | --- | --- | --- | --- |
| `text-default` | `text` | `#f4f4f5` | yes | body/primary titles everywhere | ✅ |
| `text-muted` | `muted` | `#a1a1aa` | yes (very broad) | secondary + **all former `text-subtle`** sites | ⚠ now carries two former tiers |
| `text-disabled` | `muted` @ `strong` (60%) | translucent `#a1a1aa`@60% | yes | `ProjectTree` branch line, `SpecsPanel` role label | ❌ "disabled" but used for live metadata; below AA |
| `text-on-primary` | `onAccent` | `#ffffff` | yes | text on accent fills | ✅ |
| `text-link` | `info` | `#8c81ff` (=accent) | yes (`global.css` only, unpublished) | bare `<a>` | ⚠ link == accent == feedback-info in dark |

### Containers

| Token | Source | Value (dark) | Used | Main consumers | Match |
| --- | --- | --- | --- | --- | --- |
| `container-workspace-bg` | `background` | `#09090b` | yes | app bg, composer bg (new), welcome | ✅ |
| `container-sidebar-bg` | `sidebar` | `#101013` | yes | projects rail, **terminal (new)**, **selected rows (new)** | ⚠ now 3 unrelated roles (see Problems) |
| `container-header-bg` | `header` | `#18181b` | yes | top bar, chat/panel headers, tab strip | ✅ |
| `container-content-bg` | `content` | `#18181b` | yes | editor/Monaco, markdown preview, center/right canvas | ✅ |
| `container-elevated-bg` | `elevated` | `#27272a` | yes | dialogs, popovers, menus, toasts, cards, code blocks | ✅ |

### Controls

| Token | Source | Value (dark) | Used | Main consumers | Match |
| --- | --- | --- | --- | --- | --- |
| `control-bg` | `input` | `#18181b` | yes | inputs/textareas/selects | ✅ |
| `control-bg-hovered` | `hover` | `#3f3f46` | yes | control + row hover | ✅ |
| `control-primary-bg` | `accent` | `#8c81ff` | yes | primary buttons | ✅ (≡ `primary`, by design) |
| `control-primary-text` | `onAccent` | `#ffffff` | yes | primary button text | ✅ (≡ `text-on-primary`, by design) |
| `control-border` | `border` | `#27272a` | yes (8) | button/textarea/composer/selectors/segment/ExtUi+Login | ⚠ **≡ `border-muted`** (same key, no alpha) |

### Borders

| Token | Source | Value (dark) | Used | Main consumers | Match |
| --- | --- | --- | --- | --- | --- |
| `border-default` | `borderStrong` | `#3f3f46` | yes | dialogs/menus/cards/dividers/overlays | ✅ |
| `border-muted` | `border` | `#27272a` | yes | composer top divider, command border, subtle dividers | ⚠ identical value to `control-border` |

### Primary

| Token | Source | Value (dark) | Used | Match |
| --- | --- | --- | --- | --- |
| `primary` | `accent` | `#8c81ff` | yes | ✅ |
| `primary-subtle` | `accent` @ `subtle`(10%) | — | yes | ✅ |
| `primary-soft` | `accent` @ `soft`(20%) | — | yes | ✅ |
| `primary-muted` | `accent` @ `muted`(40%) | — | yes | ✅ |
| `primary-strong` | `accent` @ `strong`(60%) | — | yes | ✅ |
| `on-primary-soft` | `onAccent` @ `soft`(20%) | — | yes | ✅ |

### Feedback

| Token | Source | Value (dark) | Used | Match |
| --- | --- | --- | --- | --- |
| `feedback-info` | `info` | `#8c81ff` (**= accent**) | yes | ❌ "info" == primary in dark |
| `feedback-info-subtle` | `info` @ `wash`(12%) | accent @ 12% | yes | ❌ inherits the info==accent collision |
| `feedback-success` / `-subtle`(wash) / `-muted`(40%) | `success` | `#6ad859` | yes | ✅ |
| `feedback-error` / `-subtle`(wash) / `-muted`(40%) | `danger` | `#ff4b75` | yes | ✅ |
| `feedback-warning` / `-subtle`(wash) | `warning` | `#ffd54b` | yes | ✅ (no `-muted`; asymmetric with success/error) |

### Selection

| Token | Source | Value (dark) | Used | Match |
| --- | --- | --- | --- | --- |
| `selection-bg` | `selection` | `#8c81ff26` (accent @ 15%, alpha-hex) | yes | ✅ (native `::selection`) |
| `selection-text` | `selectionForeground` | `inherit` (null) | yes | ✅ |
| `editor-selection-bg` | `editorSelection` | `#8c81ff26` | yes | ✅ (Monaco/xterm) |
| `editor-selection-text` | `editorSelectionForeground` | default (null) | yes | ✅ |

### Chat bubble / effects

`bubble-user-bg` (`bubbleAccent`@subtle), `bubble-user-border` (`bubbleAccent`@muted) — both used;
`bubbleAccent` `#6b57ff` **not re-aligned** to the new accent `#8c81ff` (see Problems). `overlay`,
`sunken` unchanged.

### Typography — UI

| Token | Family | Size / LH / weight / tracking | Used | Consumers | Match |
| --- | --- | --- | --- | --- | --- |
| `ui.default` | interface | 14 / `ui`(20) / 400 / normal | yes | `.tr-text-ui`, `<body>` root | ✅ |
| `ui.metadata` | interface | 12 / `metadata`(16) / 400 / normal | yes | `.tr-text-metadata`, `chat.tableBody` | ✅ |
| `ui.eyebrow` | interface | 12 / `relaxed`(20) / 500 / `loose` / upper | yes | `.tr-text-eyebrow`, `labelPill` | ✅ |
| `ui.action` → `title.compact` · `ui.emphasis` → `title.compact` · `ui.labelPill` → `ui.eyebrow` | — | — | yes | buttons/emphasis/pills | ✅ |

### Typography — Mono

| Token | Size / LH | Used | Consumers | Match |
| --- | --- | --- | --- | --- |
| `code.text` | 13 / `tight`(16) | yes | `.tr-code-text` (tool output, inline `<code>`, keycaps) | ⚠ tight LH for multi-line output |
| `code.inline` | 13 / `relaxed`(20) | yes | prose inline code; **`code.block`** & **`chat.codeBlock`** alias it | ✅ |
| `code.block` → `code.inline` | 13 / 20 | yes | (alias) | ✅ collapse is intentional |
| `code.document` | 13 / `code`(1.5) | yes | doc prose fenced code | ✅ |
| `code.otp` | 18 / `metadata`(24) | yes | `.tr-code-otp` (login OTP) | ⚠ uses a line-height literally named "metadata" |

### Typography — line-height & letter-spacing primitives

`lineHeights`: `tight` 1.2308, `compact` 1.25, `metadata` 1.3333, `ui` 1.4286, `code` 1.5, `relaxed`
1.5385, `default` 1.6. `letterSpacings`: `normal`, `loose` 0.02em, `wide` 0.05em, `widest` 0.1em,
`brand`. See Problems for naming-convention mixing and single-consumer entries.

### Typography — other families

`brand` (`wordmark`, `hero`) and `body.reading` unchanged. `heading.*`, `title.*`, prose systems
(`chat`, `doc`) unchanged except the mono/table `$ref` retargets noted above.

---

## Problems and inconsistencies

Each issue is tagged: **Naming · Architecture · Token duplication · Incorrect semantic usage · Local
override · Unintended scope · Dead token · Validation/test · Documentation drift**.

**P-1 — `hint` / `text-subtle` collapse brightened metadata app-wide.** *(Unintended scope · Architecture)*
The palette still defined a distinct readable quiet grey per theme (`hint`, e.g. dark `#81858c`,
light `#667085`), consumed by `text-subtle` at **168 call sites**. Removing the tier folded all of them
into `text-muted`, so timestamps, captions, hints, empty-states, tree metadata, etc. got **brighter in
every theme** — a global visual change well beyond the dark refresh. Files: `themes/bundled/*` (all),
`schema.ts`, `theme.schema.json`, `colors.json`, and ~50 components.

**P-2 — `text-disabled` is a misnamed re-creation of the quiet tier.** *(Naming · Incorrect semantic
usage · Validation/test)* It is applied to **live, meaningful metadata** — workspace branch names
(`ProjectTree`) and spec type labels `MODULE`/`ARCH`… (`SpecsPanel`) — not to disabled controls. It is
the only **translucent** text token (`muted` @ 60%), so its effective color shifts with the surface
behind it (sidebar `#101013` vs content `#18181b`), and it sits **below the AA contrast floor** — it is
deliberately excluded from `FLOORS` in `schema.test.ts`, so the gate can't catch that functional labels
are now low-contrast. Semantically this is the old `text-subtle`/hint role wearing a "disabled" name.

**P-3 — `control-border` ≡ `border-muted`.** *(Token duplication)* Both derive from the `border`
palette key with no alpha, so they are always the same value (`#27272a` in dark) and can never differ
per theme. It matches the existing `control-primary-bg`≡`primary` precedent, so it is *permitted*, but it
is a visually identical second name. Acceptable **only** as a semantic indirection you intend to
re-point later; otherwise it is duplication.

**P-4 — `subtle` (10%) and `wash` (12%) are near-identical alpha steps.** *(Token duplication)* `wash`
was added solely to move feedback `-subtle` fills from 10%→12%, a 2% delta invisible in most contexts.
`subtle` now serves only `primary-subtle` + `bubble-user-bg`. Two steps 2% apart is a maintenance smell.

**P-5 — dark `info` == `accent`.** *(Incorrect semantic usage)* `info #8c81ff` equals `accent`, so
`feedback-info` / `feedback-info-subtle` / `text-link` are indistinguishable from `primary` in the dark
theme. Markdown NOTE callouts, info banners, and links read as brand-violet. The "info" family no longer
signals "informational/neutral-blue" distinct from primary.

**P-6 — line-height primitive naming mixes conventions and reuses role names cross-purpose.**
*(Naming)* The ladder mixes tightness names (`tight`, `compact`, `code`, `relaxed`, `default`) with
**role names** (`ui`, `metadata`). `ui` (1.4286) and `relaxed` (1.5385) each have a single consumer, and
`metadata` (1.3333) is shared by `ui.metadata` **and** `code.otp` (both happen to be 4/3) — so
`code.otp` reads `lineHeight: "metadata"`, which is confusing. This is internal-only (primitive names
aren't exposed to components) but drifts from the "descriptive scale step" convention.

**P-7 — `container-sidebar-bg` now spans three unrelated roles.** *(Unintended scope · Naming)* The
`sidebar` surface token is now the background of the projects rail **and** the terminal **and** the
selected row in Specs/Files/Changes. These are deliberate reuses (all should be `#101013`), but the token
name ("sidebar") no longer describes all its consumers; a future change to the sidebar color would move
the terminal and selection highlight with it.

**P-8 — chat fenced code flattened to doc code size.** *(Validation/test)* `code.block`→`code.inline`
and `chat.codeBlock`→`code.inline` make chat fenced code 13px (was 11px) — equal to doc code (13px). The
intentional "doc code > chat code" invariant in `schema`/`typographyUsage.test` was relaxed to `>=`.
Documented, but the deliberate chat-vs-doc code hierarchy is gone.

**P-9 — `code.text` tight line-height for multi-line output.** *(Incorrect semantic usage, minor)*
`code.text` (tool-card `<pre>` output: Bash/Read/Edit) is now 13px with `tight` (1.2308 → 16px) line
height, noticeably tighter than the previous 1.6 — dense for scanning multi-line command output.

**P-10 — `bubbleAccent` not re-aligned to the new accent.** *(Consistency, minor)* Dark `bubbleAccent`
stayed `#6b57ff` while `accent` moved to `#8c81ff`, so the chat user bubble is a slightly different
violet from the rest of the brand accent.

**P-11 — feedback `-muted` set is asymmetric.** *(Consistency, pre-existing)* `feedback-success-muted`
and `feedback-error-muted` exist (40%), but there is no `feedback-warning-muted` / `feedback-info-muted`.
The Projects-rail diff counters (P-4-adjacent) rely on the two that exist. Pre-existing on `main`, but
the counter rewire now leans on it.

**Non-issues (verified clean):** no raw hex / `rgb()` / `bg-[var(--palette)]` / inline styles / `/N`
opacity modifiers introduced; generated CSS is not stale; no dead tokens (every published token has a
call site); docs (`COLOR.md`, `TYPOGRAPHY.md`, `themes/SPEC.md`) are **in sync** with the JSON — no
documentation drift found.

---

## Refactoring recommendations

Prioritized. **Do not implement yet.** Each states: token/component · change · why · visual impact ·
migration risk · mechanism (new token / remap / rename / delete / revert).

### P0 — correctness / architecture

**R0.1 — Fix `text-disabled` semantics for functional metadata.** *(from P-2)*
- Affected: `text-disabled` role; `ProjectTree` branch line, `SpecsPanel` role label.
- Change: either **rename** the token to a truthful quiet-metadata name (e.g. reinstate `text-subtle` as
  the semantic role) **and** make it a **solid, contrast-passing** value rather than `muted`@60%
  translucent; or, if a true "disabled" tone is intended, stop using it for live metadata and keep those
  labels on `text-muted`.
- Why: a "disabled" name on live data is misleading, and translucent sub-AA text for meaningful labels is
  an accessibility regression that the contrast gate is currently configured to ignore.
- Visual impact: branch names / spec labels become readable again (brighter or solid).
- Risk: low (2 consumers) + a published-token rename (generated CSS + docs). Medium if it also revives
  the contrast gate for the tier.
- Mechanism: rename + remap (solid source) **or** revert the two call sites to `text-muted`.

**R0.2 — Decide the fate of the `hint` / `text-subtle` tier deliberately.** *(from P-1)*
- Affected: `text-subtle` (removed), `hint` manifest key (removed), 168 call sites, all 6 manifests, the
  `FLOORS` map.
- Change: confirm the global brightening was intended. If the distinct quiet tier is still wanted,
  **reinstate** `hint` + `text-subtle` (and its `FLOORS` 3.0 floor) and re-migrate the 168 sites; if the
  collapse was intended, keep it but treat R0.1's tier as the single "quiet" tier and document that
  `text-muted` now spans two former tiers.
- Why: the collapse is the single largest and least-scoped visual change in the branch and it silently
  spans every theme.
- Visual impact: potentially large (metadata contrast across the whole app).
- Risk: high churn (168 sites) if reinstating; the mechanical migration is low-risk per-site.
- Mechanism: revert-or-keep decision; reinstate = new (restored) token + manifest key + remap.

**R0.3 — Resolve dark `info` == `accent`.** *(from P-5)*
- Affected: dark `info` (`#8c81ff`); `feedback-info*`, `text-link`.
- Change: give dark `info` a distinct informational hue (its own value, not the accent). Keep `text-link`
  policy explicit (link may legitimately equal accent, but `feedback-info` should not).
- Why: an "info" feedback family that equals primary can't signal information distinctly; NOTE callouts /
  info banners read as brand.
- Visual impact: info callouts/banners change from violet to a distinct hue in dark.
- Risk: low (manifest value only, dark-only); confirm intent — this was an explicit earlier choice, so
  **flag for the designer** rather than auto-revert.
- Mechanism: manifest remap (value).

### P1 — consistency / maintainability

**R1.1 — Collapse `wash` back into `subtle` (or vice-versa).** *(from P-4)*
- Affected: `scale.wash` (12%), `scale.subtle` (10%); feedback `-subtle` roles.
- Change: pick one low-alpha step for both feedback fills and primary/bubble tints (10% or 12%), delete
  the other.
- Why: two steps 2% apart is indistinguishable and doubles the ladder's low end.
- Visual impact: negligible (≤2% alpha shift on feedback fills or primary tints).
- Risk: low.
- Mechanism: delete one step + remap the affected roles.

**R1.2 — Decide `control-border` vs `border-muted`.** *(from P-3)*
- Affected: `control-border`, `border-muted`.
- Change: keep `control-border` only if you intend controls to diverge from `border-muted` later
  (document that intent); otherwise point controls directly at `border-muted` and delete `control-border`.
- Why: two names for one value unless the indirection earns its keep.
- Visual impact: none.
- Risk: low (8 consumers) if deleting.
- Mechanism: keep+document, or delete + remap 8 call sites.

**R1.3 — Normalize line-height primitive names.** *(from P-6)*
- Affected: `lineHeights.ui`, `.relaxed`, `.metadata`, `.tight`.
- Change: rename to a consistent descriptive-tightness vocabulary (or a numeric/px-intent scheme) so no
  primitive is role-named or shared cross-purpose (`code.otp` should not read `lineHeight: "metadata"`).
- Why: the ladder mixes conventions; role names on shared primitives mislead.
- Visual impact: none (rename of internal primitives; regenerate CSS).
- Risk: low, internal-only; regenerate + `typography:check`.
- Mechanism: rename (JSON + regenerate).

**R1.4 — Re-align dark `bubbleAccent` to the accent (or confirm the divergence).** *(from P-10)*
- Affected: dark `bubbleAccent`.
- Change: set to `#8c81ff` (or an intentional derived tint) unless the distinct bubble violet is desired.
- Why: two brand violets look accidental.
- Visual impact: chat user bubble tint shifts slightly.
- Risk: low (manifest value, dark-only).
- Mechanism: manifest remap.

### P2 — optional cleanup

**R2.1 — Reconsider `code.text` line-height for multi-line output.** *(from P-9)* Consider a looser LH
for tool-card `<pre>` output (or split "inline mono" vs "output mono"); low priority, no new system.
Visual: slightly airier command output. Risk: low.

**R2.2 — Document `container-sidebar-bg`'s expanded role set** *(from P-7)* — note in `COLOR.md` that it
also backs the terminal + selected-row highlight, or introduce a dedicated selection/terminal role if the
coupling is undesirable. No visual change. Risk: none (docs) / low (if split).

**R2.3 — Fill the feedback `-muted` set** *(from P-11)* — add `feedback-warning-muted` /
`feedback-info-muted` **only if a consumer needs them** (the adoption gate rejects unused tokens);
otherwise leave the asymmetry. Not urgent.

**R2.4 — Chat-vs-doc code size** *(from P-8)* — if the deliberate "chat code smaller than doc code"
hierarchy is still wanted, it cannot be restored without re-splitting `code.block` from `code.inline`;
otherwise accept the flatten and drop the stale rationale. Design call, not a defect.

---

## Should-revert flags

- **`text-disabled` as used today (P-2 / R0.1)** is the one change I would revert rather than refactor if
  a decision isn't made quickly: applying a translucent, sub-AA, "disabled"-named token to live branch/
  spec metadata is the most user-visible correctness risk. Reverting its two call sites to `text-muted`
  restores readable metadata immediately; the token itself can stay unused only briefly (the adoption
  gate rejects an unused published token, so it must be either used correctly, renamed, or removed).
- **`info` == `accent` (P-5 / R0.3)** and the **`hint` collapse (P-1 / R0.2)** are **intent decisions**,
  not defects — flag to the designer; do not auto-revert.

*No backend / wire / contract / session / tab / state / hydration / streaming code is implicated by any
recommendation. All items stay within `colors.json` / `typography.json` / theme manifests / generated CSS
/ component class strings, preserving the existing semantic architecture, naming principles, generated
pipeline, and the typography/color/component separation.*
