---
id: submodule-web-library
type: submodule-design
status: active
title: library — the design system: live foundations, components and their generated reference
parent: module-web
references: [module-ui, submodule-web-themes]
---

## Responsibility

The single home of ThinkRail's design system. Designers, developers and agents read every design rule
here, see the foundations (colour, typography, spacing, radius, icons, themes) rendered live from the
files the app is built from, inspect real components and copy working examples. It has a page for every
reusable building block — each shared primitive and each app component rendered from two or more files
— grouped as General, Navigation, Data entry, Data display, Feedback, Overlay and Layout; a family that
exists only as inline JSX gets its page once one implementation becomes a component. The design
specs `web-color`, `web-typography`, `web-spacing` and `web-notices`, `apps/web/UI-TERMINOLOGY.md`,
`packages/ui/COMPONENTS.md` and the root `DESIGN.md` are generated from this module.

## Boundary

- **A second Vite entry of `apps/web`, not an app feature.** `vite.library.config.ts` builds
  `library/` with the app's own plugins (React, React Compiler, Tailwind) and `@/` alias; nothing in
  `src/` imports it and it never ships in the app bundle. `library.css` imports the production
  `src/index.css` and adds only its own directory as a Tailwind source, so components render with the
  exact production stylesheet and tokens. `src/index.css` roots Tailwind's detection at `src/`, so the
  library's chrome classes stay out of the app's CSS.
- **Production source only.** Pages render components imported from where they live — `@thinkrail/ui/*`,
  app components under `@/…` and resource-renderer components from `packages/resource-renderers/src` —
  and themes from `@/themes` (`getThemes` / `applyTheme`, every bundled theme). A page may import a
  component from its own module even when the owning module does not export it through its barrel
  (`@/shell/layout/workbenchTabs`, `StaleComposerNotice`): the library documents components where
  they are, and these are read-only documentation edges — nothing imports the library, and a page
  never re-exports, wraps or restyles what it imports. No specimen is redrawn with
  handwritten markup, no screenshot stands in for a component, and states are real interactions or
  real props — never forced pseudo-classes or overriding classes.
- **One authored source for words; values stay in their files.** Values live where the app reads them —
  the theme manifests, `src/styles/{colors,typography,spacing}.json` and `src/styles/tokens.css` — and
  are edited only there. Every word lives in `content/`: `guides/`, `foundations/`, `patterns/` and
  `vocabulary/` are Markdown pages registered in `content/index.ts`; `components/<name>.ts` are typed
  component docs with `examples/<component>/<id>.tsx` as runnable files shown verbatim, and
  `components/button-system.md` is the Button system's implementation contract. A component doc is generic
  (variants, sizes, tones, native props and a contract are optional); anything specific to one
  component — a variant × size matrix, a live state matrix, a playground — is its `showcase/<slug>.tsx`,
  registered in `showcase/index.ts`: data-driven sections the page renders in order (a section with id
  `states` gets the doc's state table appended, otherwise a plain States section is added) and an
  optional declarative playground (choice and flag controls, a live preview, generated code). Prose never restates a
  value: a `:::live <block>` line renders one of the `live/` blocks, which import the JSON, `tokens.css`
  (raw), the bundled manifests and `public/custom-icons/` at build time, reusing the generators' own
  pure models (`scripts/typographyModel.ts`, `scripts/colorsModel.ts`). Variant, size and tone tables
  are typed as `Record<ButtonVariant | …>` and own props as `Record<keyof Props minus HTML attributes>`,
  so a prop added to or removed from the component fails the library's typecheck until its documentation
  follows.
- **Generated Markdown.** `scripts/generate-md.ts` writes every output from the same content: a page
  with `output` becomes that file (its spec frontmatter, a GENERATED banner and H1 come from the
  registry, and each live block becomes a pointer to its source); the components and the contract
  become `packages/ui/COMPONENTS.md`; the design prompt plus a snapshot of the current foundations
  becomes `DESIGN.md`, the one output that quotes values. Page links (`#/<slug>`) and repository links
  (`/<path>`) are rewritten to relative paths. The outputs keep their spec ids and paths, so the spec
  graph and existing links are unchanged; they are never edited by hand.
- **Layout** follows the familiar component-site shape (Ant Design's): a header with the Guides /
  Foundations / Components / Patterns / Vocabulary areas and the theme menu; a sidebar of component groups; a Components overview with a
  name search and one card per component whose preview is that component's `preview` example, live but
  `inert`; and component pages with a title, summary and Import / Source / Docs rows, When to use,
  examples as a two-column grid of cards (preview, title, description, copy and show-code), then
  variants and sizes, states, tone, playground, API, accessibility, usage rules and production usages,
  with a sticky "On this page" outline that tracks the scroll position. Markdown pages show Values /
  Content / Generated rows, the prose in the product's `tr-prose-doc` type and live blocks outside that
  prose root, with the same outline built from their headings. Below `lg` the header areas move into
  the drawer, which lists every area; under `md` the sidebar becomes that drawer and the outline is
  hidden. All of it uses ThinkRail's tokens, type classes and components.
- **Rules are words, not block output.** A live block renders values and specimens only; any rule a
  reader needs — which tier a context takes, which step a surface uses — is written in the page's
  Markdown. A block whose content is *names* (the type style id → class table) also emits a names-only
  table into the generated Markdown, so agents reading the files see every class without any value.
- **Specimen colour is the one inline-style exception.** The app forbids inline `style` for colour; live
  blocks may set a swatch's colour, a radius specimen's corner, a spacing bar's width or a theme preview's
  colours from token or manifest data through `style`, because those values are the data being shown.
  Nothing else in the library uses inline style.
- **Values stay in their owners.** Pixel values, colours and type live in the component source,
  [[module-ui]] and the token files; component pages measure the rendered component and foundation
  pages render the files instead of restating them.
- **Library text is documentation, not app UI.** It is English and outside `check-i18n`; examples use
  real locale keys so copied code passes it.

## Checks

- `library.test.ts` (in `apps/web`'s `bun test`): every generated Markdown file is current, every
  authored Markdown file is registered and exists, every live block is known and used, page and
  repository links resolve, each page's value sources exist, examples and
  their documentation match one-to-one, each overview `preview` names one of them, every listed
  production usage still uses the component, and the documented defaults equal the rendered ones.
- `tsc -p library` (part of `apps/web` `typecheck`).
- `library:verify` drives a running library in Chromium: the overview, its search and cards, sidebar
  and header navigation, every theme, keyboard focus,
  tooltips (including on a disabled button), loading blocking a second click, menu-open selected state,
  collapsed and revealed example code, copy-to-clipboard, the page outline, the narrow-screen drawer and
  the absence of runtime errors.

## Commands

`bun run library:dev` (hot reload), `bun run library:build` (generated-docs check, typecheck, static
site in `apps/web/dist-library/`), `bun run --cwd apps/web library:preview`, `bun run library:md`
(regenerates every output), and
`bun run --cwd apps/web library:verify [url]` against a running dev or preview server.
