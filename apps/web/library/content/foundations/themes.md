A theme is one complete `*.theme.json` manifest in `apps/web/src/themes/bundled/`: appearance and contrast
metadata, the semantic UI palette, all 16 ANSI colours and a syntax palette. The theme engine writes the
active manifest onto the document root; every component reads semantic roles (see [Color](#/color)), so
switching a theme never changes a component.

:::live themes

## Palette keys

Every manifest defines the same keys; the semantic roles in `colors.json` are derived from them.

:::live color-palettes

## Rules

- **A theme is data, not code.** Adding a bundled theme adds one JSON file — never a selector block, a
  component branch or a per-theme class. The manifests are validated at bootstrap, and data-driven tests
  hold every manifest to the contrast floors.
- **Users can add their own themes** from `~/.thinkrail/themes`; they are validated the same way.
- **Components never branch on a theme id.** A palette decides how loud something reads; the component
  names the role.
- The theme engine itself — preference, system matching, persistence and how strict consumers (Monaco,
  xterm, Shiki, Pierre, Mermaid) follow a swap — is specified in `apps/web/src/themes/SPEC.md`.
