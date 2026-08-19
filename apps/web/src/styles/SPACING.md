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
re-declaration.

```
styles/spacing.json            the SOURCE — the canonical steps (the only place a length is written)
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
exist ahead of any consumer. `32`/`40`/`64` are reserved primitives with no call sites yet — they are
canonical, not orphans, and are not removed for lack of use. Conversely, adding a step (a `6`, say) is a
deliberate design decision, not a mechanical one — the audit found 6px used four ways, each resolved
into an existing role rather than minting a new step.

`spacing.json` is the source; nothing restates a length. The generated `--space-<n>` custom properties
are read directly by the few hand-written CSS surfaces that cannot use a utility (the Monaco review
widgets in `index.css`); component call sites use the `p-<n>` / `m-<n>` / `gap-<n>` utilities. Editing
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

Spacing stays independent of typography, colour and radius: a change to the type scale or a theme never
moves layout. `tokens.css` (structure) holds no spacing; `spacing.json` is the only source.

## The gate

`styles/spacingUsage.test.ts` enforces the vocabulary at `p`/`m`/`gap` call sites (and on the rhythm
properties of handwritten CSS), reading the allowed steps from `spacing.json` so the two cannot drift:

- a spacing utility names a **canonical step** — `p-8`, `gap-4`; the retired t-shirt aliases (`p-xs`) and
  any off-scale number (`p-6`, `py-1`, `gap-0.5`) are rejected;
- a length is **never a raw pixel value** at the call site (`py-[3px]`), and a step is **never re-spelled
  through an arbitrary value** (`p-[8px]`, `p-[var(--space-8)]`) — the numeric utility is the one way;
- keyword suffixes that are not rhythm stay fine (`ml-auto`, `gap-px` hairline);
- the **bracket escape hatch** carries measured/optical/geometry values that are not steps: `pr-[2rem]`
  (a close-button reserve), `pl-[1.6em]` (an em-relative list indent), `pl-[calc(0.875rem+var(--space-8))]`
  (an icon-aligned indent). These are layout constraints, deliberately outside the scale;
- the scale is a defined primitive set, so a step is **not** required to have a consumer — the gate has no
  orphan/reachability check that could reject a reserved primitive (`32`/`40`/`64`);
- handwritten `.css` under `styles/` is covered too: `gap` / `padding` / `margin` (and longhands) must
  carry a `--space-*` token (or `0` / `auto`), never a raw `Npx`. Sizing, coordinates and
  box-shadow/border offsets are geometry, not rhythm, and are not scanned; a documented non-rhythm
  optical offset may stay raw via the guard's `CSS_RHYTHM_EXEMPT` allowlist (the `.review-region` rail
  pair — `padding-left: 10px` cancelled by `margin-left: -10px`, zero layout shift).

Like the colour and typography guards, this one exists because the drift is **invisible**: unlike an
unknown colour utility (which Tailwind drops, rendering nothing), an off-scale length always renders, so
it looks correct in review and passes every other gate.

## Adding or changing a step

Edit `spacing.json`, run `bun run spacing:generate`, commit the regenerated `styles/generated/spacing.css`.
That is the whole change — the utilities (`p-<n>`, `gap-<n>`, …) and the raw `--space-<n>` tokens both
follow from the source. A step name must equal its pixel value (`validate()` enforces `"<n>": "<n>px"`).
A new step needs no consumer to be valid — a reserved primitive can be added ahead of use. Removing a
step that call sites still spend, however, breaks those utilities (they become off-scale).
