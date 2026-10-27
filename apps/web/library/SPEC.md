---
id: submodule-web-library
type: submodule-design
status: active
title: library — the live component library and its generated reference
parent: module-web
references: [module-ui, web-color, web-typography, web-spacing]
---

## Responsibility

One maintained place where designers, developers and agents inspect real ThinkRail components, read
their usage rules and copy working examples. It covers `Button` and `IconButton` today; every shared
component gets a page here when it is added or reworked.

## Boundary

- **A second Vite entry of `apps/web`, not an app feature.** `vite.library.config.ts` builds
  `library/` with the app's own plugins (React, React Compiler, Tailwind) and `@/` alias; nothing in
  `src/` imports it and it never ships in the app bundle. `library.css` imports the production
  `src/index.css` and adds only its own directory as a Tailwind source, so components render with the
  exact production stylesheet and tokens. `src/index.css` roots Tailwind's detection at `src/`, so the
  library's chrome classes stay out of the app's CSS.
- **Production source only.** Pages render components imported from `@thinkrail/ui/*` and themes from
  `@/themes` (`getThemes` / `applyTheme`, every bundled theme). No specimen is redrawn with
  handwritten markup, no screenshot stands in for a component, and states are real interactions or
  real props — never forced pseudo-classes or overriding classes.
- **One authored source.** `content/*.ts` holds every description, rule, API row and example
  reference; `examples/<component>/<id>.tsx` are runnable files whose source is shown verbatim. The
  site renders both; `scripts/generate-md.ts` turns the same modules into `packages/ui/COMPONENTS.md`
  (generated, never edited). Variant, size and tone tables are typed as `Record<ButtonVariant | …>` and
  own props as `Record<keyof Props minus HTML attributes>`, so a prop added to or removed from the
  component fails the library's typecheck until its documentation follows.
- **Values stay in their owners.** Pixel values, colours and type live in the component source,
  [[module-ui]] and the token systems; pages measure the rendered component instead of restating them.
- **Library text is documentation, not app UI.** It is English and outside `check-i18n`; examples use
  real locale keys so copied code passes it.

## Checks

- `library.test.ts` (in `apps/web`'s `bun test`): the Markdown reference is current, examples and
  their documentation match one-to-one, every listed production usage still uses the component, and the
  documented defaults equal the rendered ones.
- `tsc -p library` (part of `apps/web` `typecheck`).
- `library:verify` drives a running library in Chromium: navigation, every theme, keyboard focus,
  tooltips (including on a disabled button), loading blocking a second click, menu-open selected state,
  copy-to-clipboard, the narrow-screen drawer and the absence of runtime errors.

## Commands

`bun run library:dev` (hot reload), `bun run library:build` (reference check, typecheck, static site in
`apps/web/dist-library/`), `bun run --cwd apps/web library:preview`, `bun run library:md`, and
`bun run --cwd apps/web library:verify [url]` against a running dev or preview server.
