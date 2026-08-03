---
id: web-color
type: submodule-design
status: active
title: ThinkRail colour — one JSON source, generated CSS, semantic roles
parent: module-web
depends-on: [submodule-web-themes]
references: [web-typography]
---

# Colour system

Colour arrives in **two layers**, and a component may only ever name the second one.

```
themes/bundled/*.theme.json    the PALETTE — one file per theme, the only place a hex lives
styles/colors.json             the SEMANTIC layer — what each palette entry is FOR (one file)
styles/colors.schema.json      the editor-facing contract for it
scripts/colors.ts              load / validate / render — the only place a derivation is written
scripts/generate-colors.ts     writes the output; `--check` fails when it is stale
styles/generated/colors.css    GENERATED: the `:root` roles + the `@theme inline` utility map
styles/generated/colors.ts     GENERATED: the manifest→variable map and the effect values
themes/runtime.ts              applies the active manifest through those generated tables
styles/colorUsage.test.ts      the adoption guard
```

**No colour is written twice.** A role's derivation lives in `colors.json` and nowhere else — not in
`tokens.css` (structure only), not in `index.css` (no `--color-*` at all), not in `runtime.ts` (its
palette map and effect scrims are generated). Editing a generated file fails `bun run colors:check`,
which runs in pre-commit and in `apps/web`'s build.

A **palette entry** answers *which colour* (`--gold`, `--elevated`, `--hint`). A **semantic token**
answers *what for* (`feedback-warning`, `container-elevated-bg`, `text-subtle`). Components name roles;
the palette is internal.

```tsx
<div className="bg-container-elevated-bg text-text-muted border-border-default" />  // yes
<div className="bg-[var(--elevated)] text-hint border-border2" />                   // no
```

## Why the split

A theme changes *which* colour a role resolves to without touching a single component, and a role can be
re-pointed once instead of at 160 call sites. It also makes the failure mode visible: `bg-elevated` is
not a Tailwind utility any more, and Tailwind **drops an unknown utility silently** — the element renders
unstyled while its class list claims otherwise. `colorUsage.test.ts` exists because that shipped once.

## The tokens

Declared in `colors.json`, published as utilities by the generator. Every one is used; a token with no
call site is deleted, and so is an alias that can never differ from its neighbour (`border-strong` that
equals `border-default` is not a second weight, it is a second name).

| family | tokens | notes |
| --- | --- | --- |
| Text | `text-default` · `text-muted` · `text-subtle` · `text-on-primary` | three tiers, because the palette defines three greys and the UI uses all of them |
| Container | `container-workspace-bg` · `container-sidebar-bg` · `container-header-bg` · `container-content-bg` · `container-elevated-bg` | `content` is the code canvas (Monaco, Shiki, terminal); `elevated` is every raised surface |
| Control | `control-bg` · `control-bg-hovered` · `control-primary-bg` · `control-primary-text` | no `-disabled` pair — disabled is `disabled:opacity-50` |
| Border | `border-default` · `border-muted` | |
| Primary | `primary` + `primary-subtle` · `-soft` · `-muted` · `-strong`, `on-primary-soft` | |
| Feedback | `feedback-{info,success,warning,error}` + the `-subtle` / `-muted` steps in use | a solid border is the solid colour, so there is no `-border` tier |
| Chat bubble | `bubble-user-bg` · `bubble-user-border` | tinted from the manifest's own `bubbleAccent` |
| Effects | `overlay` · `sunken` | written per light/dark by the theme engine |

There is no `text-disabled`, no `text-strong` and no `text-link` utility: the first two duplicate other
tokens, and `--text-link` exists as a variable for `global.css`'s `a {}` alone.

## Transparency: one form only

**A tint is a token, mixed `in srgb`, on a four-step scale.**

```
subtle 10%   ·   soft 20%   ·   muted 40%   ·   strong 60%
```

Tailwind's `/40` opacity modifier is **not used on colour utilities**. It mixes `in oklab`, so the same
nominal percentage rendered differently depending on whether it came from a class or a token — and the
numbers drifted (10, 12, 15, 16, 25, 30, 35 and 50 were all live at once). A new tint is a new token on
the scale, never a new number in a class name.

## Non-CSS consumers

Monaco, xterm, mermaid and Shiki cannot wear a class; they read the tokens through `getComputedStyle`
and rebuild after the `[data-theme]` swap. They name the same semantic tokens everything else does
(`--container-content-bg`, `--text-subtle`, `--editor-selection-bg`), so there is one name per value.
Those four tokens are therefore **not** mapped in `@theme inline` — a utility nothing can use is dead
weight. Values reach them canonicalised to hex via `cssColorToHex` (`lib/utils.ts`), because the built
CSS is minified and Monaco/xterm accept hex only.

## Adding or changing a colour

Every case is a JSON edit followed by `bun run colors:generate`.

1. **A theme should look different** → edit `themes/bundled/<theme>.theme.json`. Nothing else changes,
   and no regeneration is needed: manifests are read at runtime.
2. **A role should point somewhere else** → change its `from` in `colors.json`.
3. **A new role** → add it to `roles` with `from`, an optional `alpha` step, and `publish`
   (`true` → a Tailwind utility; `false` → read directly by Monaco/xterm/mermaid/`global.css`).
4. **A new tint** → an `alpha` step from `scale`, never a `/N` at the call site. If the step itself is
   new, add it to `scale` — that is a design decision, and it is made once.
5. **A role two themes must be able to differ on** → it needs its own manifest key. Add it to
   `palette` here, to `THEME_COLOR_KEYS` and `theme.schema.json`, and to all six manifests; the
   generator refuses to run while the two lists disagree.

Never: a raw hex or `rgb()` in a component, an inline `style` object, a `bg-[var(--palette-entry)]`
escape hatch, or a second name for a value that already has one.

## What is pinned by tests

`styles/colorUsage.test.ts` fails when:

- a colour utility names a token that `@theme inline` does not publish (the silent-drop bug);
- a component contains a raw hex, `rgb()` or `hsl()`;
- a component reaches a palette entry through `bg-[var(--…)]`;
- a `/N` opacity modifier appears on a colour utility;
- a declared token has no call site, or a published utility has no token;
- the committed generated files do not match what `colors.json` renders.

`themes/schema.test.ts` and `themes/runtime.test.ts` pin the manifest contract; `themes/shiki.test.ts`
pins the syntax-variable map. See [`themes/SPEC.md`](../themes/SPEC.md) for the manifest itself and
[TYPOGRAPHY.md](./TYPOGRAPHY.md) for the parallel type system.
