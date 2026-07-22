---
id: task-accent-teal
type: task-spec
status: done
title: Rebrand the accent from violet to bright teal/cyan (design token)
parent: module-web
---

# Rebrand the accent from violet to bright teal/cyan

## Request

Change the accent color from violet (`#8C81FF`) to a bright teal/cyan throughout the UI — logo
(wordmark), buttons, active states, highlights — by updating the design token so it applies everywhere.

## Where the accent lives (audit)

- `apps/web/src/styles/tokens.css` is the single source: `:root` `--primary` (#8c81ff) + the
  `--primary-10/20/40/60/80` tint scale (rgba of the same hue), `--on-accent` (#fff),
  `--selection-bg` (#2c2947, violet-tinted), and the chat user bubble
  `--bubble-user-bg/--bubble-user-border` (deliberately #6B57FF, a sibling violet).
- Theme overrides: **Light** re-accents to the deeper `#6b57ff` for white-on-accent contrast (+ a
  violet `--selection-bg`); **Darcula** inherits the root accent; **Gruvbox** and **High Contrast**
  deliberately override to orange accents (recorded theme decisions).
- Components never use raw hex — all through token utilities — so no component changes.
- Pins to update: `e2e/shell.spec.ts` asserts `--primary === #8c81ff`; `goal-and-requirements.md`
  records the violet as ThinkRail branding; `apps/web/SPEC.md` + `apps/web/src/panels/SPEC.md` prose
  mentions ("filled-violet card", light-theme violet note).

## Decisions (user-confirmed)

1. **Accent = teal `#2DD4BF`** (dark themes). Consequence: `--on-accent` flips to **dark**
   (`#171719`, ≈ 9.3:1 on the teal) — white on bright teal fails AA — exactly the pattern gruvbox
   already uses. The tint scale becomes `rgba(45, 212, 191, …)`. `--selection-bg` re-tints from
   violet-dark to teal-dark (`#1b3d3a`, the same ~20% blend over `--bg-dark`).
2. **Light theme re-accents to the deeper `#0f766e`** (teal-700) of the same hue, keeping **white**
   on-accent (5.1:1) — mirroring how Light previously deepened the violet for white-on-accent.
   *Refined from the `#0d9488` floated in the question round:* `--on-accent` also serves **red**
   fills (`bg-red text-on-accent`, e.g. destructive confirms), and on Light a dark on-accent fails
   on red (2.9:1) while white-on-`#0d9488` fails too (3.7:1) — `#0f766e` + white passes both. Light
   now overrides `--on-accent` explicitly (the root default flips to dark). Its `--selection-bg`
   becomes `rgba(13, 148, 136, 0.22)`.
3. **Gruvbox / High Contrast keep their palette-driven orange accents** (recorded theme decisions,
   contrast-tuned). Darcula inherits the root accent → teal automatically.
4. **The chat user bubble follows to a sibling teal** (`#14b8a6`, teal-500 — the deeper sibling, the
   same relationship #6B57FF had to #8C81FF), keeping the "deliberately not `--primary`" distinction.
5. Pins/prose updated with the token: `e2e/shell.spec.ts` (#2dd4bf), `goal-and-requirements.md`
   branding line, `apps/web/SPEC.md` + `panels/SPEC.md` violet mentions, tokens.css comments.
