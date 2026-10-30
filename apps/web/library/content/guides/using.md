This library is ThinkRail's single source of truth for design. It renders the production components from
source with the app's own stylesheet, tokens and themes, and it reads every foundation — colour,
typography, spacing, radius, icons, themes — live from the files the app itself is built from. When a
component or a token changes, its page changes with it.

## Rules

Follow these before writing any UI, and cite the IDs in reviews.

- **LIB-1 — Search and reuse first.** Look for an existing component and its supported variants in this
  library, `packages/ui/*.tsx`, `apps/web/src/components` and the owning feature module, and check how
  real call sites use it.
- **LIB-2 — Compose or extend before adding.** Combine existing components, or extend one when its
  behaviour and semantic contract stay the same. Add a component only when the system cannot express the
  need.
- **LIB-3 — Choose by contract, not by look.** Buttons, switches, tabs, menu items, tree rows and
  disclosures behave differently for keyboards and assistive technology. Never restyle one into another.
- **LIB-4 — Use supported props; never recreate appearance.** A component owns its geometry, colour,
  typography and states. A call site passes props and adds placement only — no copied skins, no state
  classes, no colour or type overrides.
- **LIB-5 — A new component ships with its documentation.** Compare it with the nearest existing
  components (behaviour, API, styling), record what you adopted and rejected, place it at the right
  level — shared primitive in `packages/ui`, app composite in `apps/web/src/components`, or local to its
  feature — and add its page, live examples and checks to this library in the same change.

## Where things live

Values and words have one home each.

| What | Where | Edited by hand |
| --- | --- | --- |
| Token values — palette, colour roles, type, spacing | `apps/web/src/themes/bundled/*.theme.json`, `apps/web/src/styles/colors.json`, `typography.json`, `spacing.json` | yes |
| Structural tokens — radius, motion, panel heights | `apps/web/src/styles/tokens.css` | yes |
| Components | `packages/ui/<name>.tsx` | yes |
| Every rule, description and example | `apps/web/library/content/` and `apps/web/library/examples/` | yes |
| Markdown for specs and agents — `COLOR.md`, `TYPOGRAPHY.md`, `SPACING.md`, `NOTIFICATIONS.md`, `UI-TERMINOLOGY.md`, `packages/ui/COMPONENTS.md`, `DESIGN.md` | generated from the library | never |

The library never restates a value in prose: foundation pages show the JSON's current content, and the
generated Markdown points to the JSON. `DESIGN.md` is the one exception — it quotes the current values,
generated from the same files, for agents and design tools that cannot open the library. A missing token
is added at its source and validated there, never at a call site.

## Examples

Every example is a real component rendered from source with mocked data and real interactions — hover,
press, Tab, click. Copy the code as a starting point; labels use locale keys, as the app requires.

## Adding or changing a page

- **A component:** write its guidance in `apps/web/library/content/components/<name>.ts` — including its
  sidebar `group` and the example shown as its overview `preview` — and its examples in
  `apps/web/library/examples/<name>/`, then register it in `content/index.ts`.
- **A foundation, pattern or guide:** write Markdown in `content/<area>/<name>.md` and register it in
  `content/index.ts`. A line `:::live <block>` places a live table or specimen read from the token files;
  the blocks live in `apps/web/library/live/`. Link another page as `#/<slug>` and a repository file as
  `/<path>`; the generator rewrites both into relative links.
- Run `bun run library:md` to regenerate every Markdown output. `library.test.ts` fails when an output is
  stale, a registered file or example is missing, a live block is unknown, or a listed production usage
  no longer uses its component.

## Commands

- `bun run library:dev` starts the library with hot reload.
- `bun run library:build` checks the generated Markdown, typechecks and writes the static site to
  `apps/web/dist-library/`.
- `bun run library:md` regenerates every generated Markdown file.
