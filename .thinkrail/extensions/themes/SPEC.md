---
id: ext-themes
type: submodule-design
status: active
title: themes — example themes and a live Theme studio
parent: module-ext-sdk
depends-on: [module-ext-sdk]
references: [submodule-server-ext, submodule-web-ext, submodule-web-themes]
tags: [extensions, example]
---

## Responsibility

Shows how an extension changes the app's look. Written only against `@thinkrail/ext` and
`@thinkrail/ext/view`; the SDK README's reference for manifest `themes` and `useTheme()`.

## Themes

`extension.json` declares three themes. Each sets palette tokens, so every role and tint follows:

- **Ember** (`light`): warm paper tones, burnt-orange accent, slightly tighter corners, and `ember.css`
  (scoped to `[data-theme-overlay="themes/ember"]`: `accent-color`, `scrollbar-color`, selection text).
- **Night contrast** (`dark`): black surfaces, white text, yellow accent.
- **Soft** (`dark`): slate surfaces, lavender accent, and doubled radii (`--radius-lg: 16px`).

## Theme studio (`studio` panel)

- Lists the three themes with **Use** (`select`) and **Edit copy** (loads it into the draft).
- The draft is `{ title, mode, colors, radius }`. Nine palette colors have color inputs; the rest of the
  source palette is kept as-is (alpha included). Editing `--accent` moves its family: `--accent-solid`,
  `--bubble-accent`, both selections (accent at 20% alpha), and `--accent-hover` (14% toward black in
  light mode, toward white in dark). One radius slider (0–16 px) sets `sm`; `xs` = sm/2, `md` = 1.5×,
  `lg` = 2×.
- Edits call `preview` at most once per animation frame with the latest draft, so a color drag applies
  one overlay per frame while the labels update on every input. A refused preview (for example text too
  close to the background) shows the error and stops previewing; the app shows the selected theme again.
  **Stop preview** and unmount cancel a pending frame, then call `preview(null)`.
- **Copy JSON** writes one `themes[]` entry (`id` slugged from the title) to the clipboard; the same text
  shows below. **Save draft** stores the draft (`saveDraft` action → `tr.store` key `draft`, published on
  `draft`); the panel starts from it, else from the current root palette.

`model.ts` is pure and shared by the view and the host half; `themesExample.test.ts` covers it.

## Known limitations

- The studio edits nine palette colors and radius; roles, fonts, and the other palette keys are export-only
  through the copied source theme.
- Exported JSON must be pasted into an extension by hand.
