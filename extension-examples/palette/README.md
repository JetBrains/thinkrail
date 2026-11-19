# Palette — a sample ThinkRail extension

Ask the agent for colours ("give me a triadic palette from #3b82f6") and it calls `color_palette`,
which builds five colours from a base colour with a colour harmony. In chat, the call shows as a card
of swatches: hex values with copy buttons, a "Copy CSS variables" button, and — while the
**Rate contrast** setting is on — each colour's WCAG contrast rating against white or black text. The
agent sees the same ratings in the tool result, so it can pick readable text colours.

Everything is computed locally: no network, no API key.

## Install

In ThinkRail, open **Settings → Extensions & skills → Install package…** and paste
`npm:@thinkrail/example-extension-palette`, or the path of this folder after building it.

## How it is made

This package is the walkthrough of ThinkRail's extension guide; it uses only
[`@thinkrail/extension-sdk`](../../packages/extension-sdk/README.md).

- `package.json` carries the `thinkrail` manifest and the `thinkrail-extension` keyword. pi and typebox
  are peer dependencies: ThinkRail provides them.
- `server/index.ts` — the server half: a `defineServerExtension` descriptor whose `sessionExtensions`
  registers the pi tool, reading the extension's own boolean setting `contrast` per session.
  `server/palette.ts` is the colour maths.
- `web/index.tsx` — the web half: a `defineWebExtension` descriptor registering `PaletteCard` for the
  `color_palette` tool. The card uses the app's `Button`, `IconButton` and `cn`, and bundles its own
  icons from `@remixicon/react`.
- `bun run build` (`thinkrail-extension build --prefix palette`) writes `dist/web.js` and
  `dist/web.css`. Every utility class in the card carries the `palette:` prefix.

In the ThinkRail repository:

```sh
bun install
bun run build
bun test
```

Its `package.json` there takes versions from the repository (`workspace:*`, `catalog:`). To start your
own extension from it elsewhere, use the `package.json` in the
[guide](https://thinkrail.ai/docs/build-an-extension/#packagejson-and-the-manifest), which carries
versions npm can install.
