---
id: web-spacing
type: submodule-design
status: active
title: ThinkRail spacing — one JSON source, one canonical numeric scale
parent: module-web
references: [web-color, web-typography]
---

# Spacing system

Spacing is **one canonical numeric vocabulary**. When a design says "use spacing 8", the implementation
writes `p-8` / `gap-8` / `py-8` and it resolves to exactly 8px — one value, one name, no local
re-declaration. This centralizes authored rhythm values; it does not remove literals from the source,
generated CSS, or compiled bundle.

```
styles/spacing.json            the authored SOURCE — the only authored canonical rhythm lengths
styles/spacing.schema.json     the editor-facing contract for it
scripts/spacing.ts             load / validate / render — the only place a spacing derivation is written
scripts/generate-spacing.ts    writes the output; `--check` fails when it is stale
styles/generated/spacing.css   GENERATED: the `--space-<n>` tokens + the `--spacing: 1px` base
styles/spacingUsage.test.ts    the adoption guard
```

## The scale

`spacing.json` declares the steps **`0 · 2 · 4 · 8 · 12 · 16 · 24 · 32 · 40 · 64`**. The **step name IS
its pixel value** — `"8": "8px"` — so an instruction that names a number maps to exactly one token and
one family of utilities. `0` is the identity step (no spacing).

The scale is an **intentionally defined primitive set, not an inventory of current usage**: a step may
exist ahead of any consumer. `32`/`40`/`64` are reserved primitives with no rhythm call sites — they are
canonical, not orphans, and are not removed for lack of use. Conversely, adding a step (a `6`, say) is a
deliberate design decision, not a mechanical one — the audit found 6px used four ways, each resolved
into an existing role rather than minting a new step.

`spacing.json` is the authored source; no other authored source restates a canonical rhythm length. The
generated output necessarily materializes those values as `--space-<n>` custom properties. They are read
directly by the few hand-written CSS surfaces that cannot use a utility (the Monaco review widgets in
`index.css`) and by strict numeric third-party options (Monaco's file-viewer top inset); component call sites
use the `p-<n>` / `m-<n>` / `gap-<n>` utilities. Editing
the generated file fails `bun run spacing:check`, which runs in pre-commit and in `apps/web`'s build.

## Number = px (and why sizing shares it)

The utilities resolve through **`--spacing: 1px`** set in the generated `@theme inline` block. Tailwind
v4 computes a bare-number spacing utility as `calc(var(--spacing) * n)`, so a 1px base makes `p-4` = 4px,
`gap-12` = 12px, uniformly. This **replaces** Tailwind's built-in `0.25rem` base, so no length can fall
back to Tailwind's own numeric scale — the requirement that made the t-shirt names (`p-xs`, `gap-sm`)
worth retiring.

Tailwind v4 drives **spacing (`p`/`m`/`gap`) and sizing (`w`/`h`/`size`/inset/translate) from the same
`--spacing` base** — they cannot be separated by theme. So the 1px base makes sizing "number = px" too:
`w-16` = 16px, `size-14` = 14px, `h-32` = 32px. This is intentional and was migrated 1:1 (every old
`w-4`/`size-3.5`/`h-8` became `w-16`/`size-14`/`h-32`), preserving the UI exactly. **But which px a box
is is a layout constraint, not rhythm** — sizing is deliberately *not* policed by the spacing gate, and
sizing values are free-form px, not the canonical step set.

Tailwind's **named container presets stay a separate scale**: `max-w-lg` / `max-w-sm` (and the rest of
`w`/`min-w`/`max-w`/`basis` t-shirt names) resolve through `--container-*` (32rem / 24rem), independent
of `--spacing`. They are **not** spacing aliases and must never be migrated to numeric utilities — a
mechanical `lg`→`16` rewrite would collapse a 32rem column to 16px. `spacingUsage.test.ts` pins this
(the gate never polices a width/sizing prefix, and the container presets we depend on stay named).

Spacing stays independent of typography, colour and radius: a change to the type scale or a theme never
moves layout. `tokens.css` (structure) holds no spacing scale; `spacing.json` is its only authored source.

## Layout roles

A value several surfaces must change **together** is a named layout role, not a repeated literal, so a
density change moves every consumer at once and cannot be half-applied (a missed literal once left the
Specs rows at 28px after every sibling row moved to 24px). A role is declared in `tokens.css` `:root` and
mapped into Tailwind by `index.css`'s `@theme inline` — the same shape as `--panel-header-row-height` →
`h-panel-header-row`:

| Role | Value | Utilities | Keeps equal |
|---|---|---|---|
| `--panel-header-row-height` | `28px` | `h-` / `w-panel-header-row` | the height of every header strip (tab strips, pane headers, chat toolbar, bottom tool rail) and the width of its full-height square actions |
| `--panel-header-control-height` | `calc(var(--panel-header-row-height) - var(--space-4))` | `h-panel-header-control` | every control floating inside a header strip, so it keeps clearing the strip’s 1px border whenever the header height changes |
| `--panel-row-height` | `22px` | `h-` / `min-h-` / `size-panel-row` | every side-pane row (file, change, spec, project, workspace) and the row-height icon buttons inside them |
| `--panel-inset` | `var(--space-8)` | `p-panel-inset` | the content inset of every tool pane (Projects, Specs, Files, Changes, Review) |
| `--tree-indent` | `var(--space-8)` | `pl-tree-indent` | per-depth indentation of the Files, Changes and Specs trees |
| `--chat-gutter` | `var(--space-8)` | `px-` / `p-chat-gutter` | chat row gutters, the stream-status and activity-breadcrumb strips, the composer inset, and the gutter terms of the transcript-width and unbounded user-bubble calcs |

- A **rhythm role aliases a canonical step** (`var(--space-<n>)`), never a raw length, so `spacing.json`
  stays the only source of rhythm lengths and `tokens.css` still holds no scale of its own. A sizing role
  (`--panel-row-height`) is geometry and stays free-form px, like all sizing.
- Mint a role only for a value with several consumers that must stay equal; a one-off length stays a
  numeric utility. Roles are not t-shirt aliases and never replace the scale.
- A role name is kebab-case with **two or more words** (`panel-inset`). `cn` (`@thinkrail/ui/utils`)
  teaches tailwind-merge that shape as a spacing/sizing value, so a role overrides a step of the same
  utility (`size-28` + `size-panel-row` → `size-panel-row`) instead of both classes surviving and the
  stylesheet order silently picking one; the gate fails on a single-word role name.

## The gate

`styles/spacingUsage.test.ts` enforces the vocabulary at `p`/`m`/`gap` call sites (and on the rhythm
properties of handwritten CSS), reading the allowed steps from `spacing.json` so the two cannot drift.
The shared source scanner covers app source, `packages/ui`, and every `thinkrail-extensions/*/web` tree:

- a spacing utility names a **canonical step** — `p-8`, `gap-4` — or a **declared rhythm role** —
  `p-panel-inset`: an `index.css` `--spacing-<role>: var(--<role>)` whose `tokens.css` value is
  `var(--space-<step>)`; the retired t-shirt aliases (`p-xs`), unknown alphabetic suffixes
  (`p-bananas`), a sizing role used as rhythm (`p-panel-row`) and any off-scale number (`p-6`, `py-1`,
  `gap-0.5`) are rejected; only prefix-appropriate Tailwind keywords such as `ml-auto`, `gap-px`, and
  `space-x-reverse` remain valid;
- a length is **never a raw pixel value** at the call site (`py-[3px]`), and a step is **never re-spelled
  through an arbitrary value** (`p-[8px]`, `p-[var(--space-8)]`) — the numeric utility is the one way;
- keyword suffixes that are not rhythm stay fine (`ml-auto`, `gap-px` hairline);
- the **bracket escape hatch is closed** to the documented measured/geometry expressions that are not
  rhythm steps: `pr-[2rem]` (a close-button reserve), `pl-[1.6em]` (an em-relative list indent), and the
  icon-aligned `pl-[calc(0.875rem+var(--space-8))]` /
  `pl-[calc(1.125rem+var(--space-8))]` indents. Any other arbitrary spacing utility fails the guard; adding
  one is a design decision recorded here, not a silent escape from the scale;
- the scale is a defined primitive set, so a step is **not** required to have a consumer — the gate has no
  orphan/reachability check that could reject a reserved primitive (`32`/`40`/`64`);
- handwritten CSS declarations throughout those source roots are covered, including multiline declarations and
  CSS string literals in TypeScript: `gap` / `padding` / `margin` (and longhands) must use a declared
  `--space-*` token (or `0` / `auto`), never a raw length or an unrelated/unknown custom property. Sizing,
  coordinates and box-shadow/border offsets are geometry, not rhythm, and are not scanned; a documented
  non-rhythm optical offset may stay raw via the guard's `CSS_RHYTHM_EXEMPT` allowlist (the
  `.review-region` rail pair — `padding-left: 10px` cancelled by `margin-left: -10px`, zero layout shift).

Like the colour and typography guards, this one exists because the drift is **invisible**: unlike an
unknown colour utility (which Tailwind drops, rendering nothing), an off-scale length always renders, so
it looks correct in review and passes every other gate.

## Adding or changing a step

Edit `spacing.json`, run `bun run spacing:generate`, commit the regenerated `styles/generated/spacing.css`.
That is the whole change — the utilities (`p-<n>`, `gap-<n>`, …) and the raw `--space-<n>` tokens both
follow from the source. A step name is a canonical non-negative integer with no leading zeroes and must
equal its pixel value (`validate()` enforces `"<n>": "<n>px"`). A new step needs no consumer to be
valid — a reserved primitive can be added ahead of use. Removing a step that call sites still spend,
however, breaks those utilities (they become off-scale).
