---
title: "Build a ThinkRail extension"
slug: build-an-extension
description: "Write an extension that adds agent tools and chat cards to ThinkRail, try it from a folder, and publish it to npm so it is listed on the extensions page."
order: 10
---

This guide walks through a real extension, **Palette**: the npm package
`@thinkrail/example-extension-palette`. Its source is in
[`extension-examples/palette`](https://github.com/JetBrains/thinkrail/tree/main/extension-examples/palette)
in the ThinkRail repository. It is published to npm and installable like any other extension: paste
`npm:@thinkrail/example-extension-palette` into **Settings → Extensions & skills → Install package…**.

Palette gives the agent one tool, `color_palette`, which builds five colours from a base hex colour and
a colour harmony. In chat, each call is shown as a card of swatches with copy buttons. One setting,
**Rate contrast**, adds WCAG contrast ratings to the tool result and to the card. Everything is computed
locally; it needs no network and no API key.

Every field, option and rule is listed in the [extension reference](/docs/extension-reference/).

## What a ThinkRail extension is

A ThinkRail extension is an npm package with a **server half**, a **web half**, or both:

- The **server half** runs in the ThinkRail host process, next to the agent. It contributes **agent
  tools**, **skills**, **boolean settings** and **interactive tools** (tools whose call waits for the
  person to answer in chat).
- The **web half** runs in the app window. It contributes **chat cards**: how a tool call is shown in
  the transcript.

The agent inside ThinkRail is [pi](https://github.com/earendil-works/pi). Tools are pi extensions, and a
pi package is an optional dependency of the server half: it can compose one, but does not have to, and
an extension that only changes how something looks in chat has no server half at all. In the plain pi
command line a ThinkRail extension does nothing by itself.

An extension contributes what ThinkRail's built-in extensions contribute through their tools, with the
same descriptors. Panels, commands, keyboard shortcuts and settings other than on/off switches are not
available; see [Current limits](#current-limits). A plain pi package, with a `pi` manifest and no
`thinkrail` one, still installs from the same dialog exactly as before; this guide is not about those.

## The package

<!-- guard: tree -->
```text
palette/
├── package.json
├── server/
│   ├── index.ts          the server half
│   └── palette.ts        the colour maths
├── web/
│   ├── index.tsx         the web half
│   ├── PaletteCard.tsx   the card
│   └── details.ts        reads the tool result for the card
└── dist/                 written by thinkrail-extension build
    ├── web.js
    └── web.css
```

The server half is published as TypeScript source; ThinkRail loads it with pi's own loader, so it is
never compiled. The web half is published built: ThinkRail never bundles anything when it installs an
extension. The sample also has tests and a `tsconfig.json`; they are not part of what ThinkRail loads.

To start your own extension, make an empty folder, save the `package.json` from the next section in
it, copy the sample's `server/` and `web/` folders (and its `tsconfig.json`, for type checking) next to
it, and install:

<!-- guard: shell -->
```bash
npm install
```

`@thinkrail/extension-sdk` is an ordinary dependency, because the server half imports it when it runs.
In SDK 1.0 its own dependencies are the build tools (rolldown and Tailwind, with native binaries), so
they are installed with every copy of your extension too; moving them out is tracked in
[issue #1447](https://github.com/JetBrains/thinkrail/issues/1447). Everything else is needed only to
type-check, build and test: React's types, pi and typebox for the server half's types,
`@remixicon/react`, an icon set the build bundles into the card, and React with `@types/bun` for the
sample's tests (`bun test`). The card itself does not use the installed React: it runs on the app's.

## package.json and the manifest

The package declares itself in `package.json`: the `thinkrail-extension` keyword and a `thinkrail`
manifest. Below is the sample's `package.json` in the form that works outside the ThinkRail repository.
In the repository its dependency versions are `workspace:*` and `catalog:`, which npm cannot install;
here they are the versions the repository pins. Its `publishConfig` also leaves out `provenance`, which
works only when publishing from a CI that npm trusts. Replace `name`, `author`, `repository`, `homepage`
and `bugs` with your own.

<!-- guard: package-json palette/package.json -->
```json
{
	"name": "@thinkrail/example-extension-palette",
	"version": "0.0.0",
	"description": "A sample ThinkRail extension: the agent builds colour palettes from a base colour, and chat shows them as swatches with WCAG contrast ratings.",
	"license": "Apache-2.0",
	"type": "module",
	"keywords": [
		"thinkrail-extension",
		"thinkrail",
		"color",
		"palette",
		"wcag"
	],
	"homepage": "https://thinkrail.ai/",
	"repository": {
		"type": "git",
		"url": "git+https://github.com/JetBrains/thinkrail.git",
		"directory": "extension-examples/palette"
	},
	"bugs": "https://github.com/JetBrains/thinkrail/issues",
	"author": "ThinkRail",
	"files": [
		"server",
		"!server/**/*.test.ts",
		"dist",
		"README.md",
		"LICENSE"
	],
	"thinkrail": {
		"api": "1.0",
		"server": "./server/index.ts",
		"web": "./dist/web.js",
		"styles": "./dist/web.css",
		"title": "Palette"
	},
	"publishConfig": {
		"access": "public"
	},
	"scripts": {
		"build": "thinkrail-extension build --prefix palette",
		"prepack": "npm run build",
		"test": "bun test",
		"typecheck": "tsc --noEmit"
	},
	"dependencies": {
		"@thinkrail/extension-sdk": "~1.0.0"
	},
	"peerDependencies": {
		"@earendil-works/pi-coding-agent": "*",
		"typebox": "*"
	},
	"devDependencies": {
		"@earendil-works/pi-coding-agent": "1.5.2",
		"@remixicon/react": "4.9.0",
		"@types/bun": "1.4.4",
		"@types/react": "19.3.0",
		"@types/react-dom": "19.3.0",
		"react": "19.3.1",
		"react-dom": "19.3.1",
		"typebox": "1.3.27",
		"typescript": "7.1.0-beta"
	}
}
```

The `thinkrail` manifest:

- `api` is the extension API version the extension was built for, as `major.minor`. The SDK you build
  with decides it: `@thinkrail/extension-sdk` 1.0 builds only `"api": "1.0"`, which is why the SDK
  range is `~1.0.0` and never a caret range. See [Versions](#versions).
- `server` is the server half's entry, `web` the built web half (a `.js` or `.mjs` file) and `styles` its
  built stylesheet (a `.css` file). At least one of `server` and `web` is required; `styles` is allowed
  only with `web`. Each path is relative to the package root and must stay inside the package.
- `title` is the display name; without it, the package name is shown.
- `image` is still accepted, but nothing uses it: neither the extensions page nor the app shows preview
  images, so leave it out (the build still warns when it is not an `https:` URL).

The description, author and version ThinkRail shows are the package's own `description`, `author` and
`version`.

The package `name` is the extension's identity: ThinkRail keys the extension's on/off switch and its
settings by it, so renaming the package makes it a different extension.

<!-- guard: reserved-names -->
It must be a valid npm name and cannot be one of the names ThinkRail reserves: the names of its
built-in extensions, `ask-user-question`, `hint-mode`, `next-steps`, `visualize` and `web-access`, and
of its own `mcp` and `tool-search` slots.

`files` publishes the server source and `dist/`, nothing else. `prepack` runs the build, so every
`npm publish` and `npm pack` ships a fresh `dist/`.

## The server half

The server half's default export is a descriptor made with `defineServerExtension`. Palette's whole
`server/index.ts`:

<!-- guard: file palette/server/index.ts -->
```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	defineServerExtension,
	type ExtensionSessionServices,
} from "@thinkrail/extension-sdk/server";
import { Type } from "typebox";
import { buildPalette, HARMONIES, type Harmony, paletteText } from "./palette";

export const PALETTE_TOOL = "color_palette";

const Parameters = Type.Object({
	base: Type.String({ description: "The base colour as a hex value, e.g. #3b82f6 or #38f." }),
	harmony: Type.Optional(
		Type.Unsafe<Harmony>({
			type: "string",
			enum: [...HARMONIES],
			description: "How the other colours relate to the base. Default: analogous.",
		}),
	),
});

function paletteTool(session: ExtensionSessionServices) {
	return (pi: ExtensionAPI) => {
		const checkContrast = session.setting("contrast");
		pi.registerTool({
			name: PALETTE_TOOL,
			label: "Colour palette",
			description:
				"Build a five-colour palette from a base colour using a colour harmony (analogous, monochromatic, complementary, split-complementary, triadic or tetradic). Returns the hex values and CSS custom properties" +
				(checkContrast ? ", each rated for WCAG contrast against white and black text." : "."),
			promptSnippet:
				"Build colour palettes from a base hex colour and show them as swatches in chat.",
			parameters: Parameters,
			async execute(_toolCallId, params) {
				const palette = buildPalette(params.base, params.harmony ?? "analogous", checkContrast);
				return { content: [{ type: "text", text: paletteText(palette) }], details: palette };
			},
		});
	};
}

export default defineServerExtension({
	name: "@thinkrail/example-extension-palette",
	title: "Palette",
	description:
		"Lets the agent build colour palettes from a base colour and shows them as swatches.",
	extensions: [],
	sessionExtensions: (session) => [paletteTool(session)],
	settings: {
		contrast: {
			type: "boolean",
			default: true,
			title: "Rate contrast",
			description:
				"Rate every colour's WCAG contrast against white and black text, for the agent and on the card.",
		},
	},
});
```

What it does:

- `name` is the package name. ThinkRail refuses to load a server half whose descriptor has any other
  name.
- `title` and `description` are what Settings → Extensions & skills shows when the manifest has no `title` or the
  package no `description`; the manifest and the package fields win.
- `settings` declares the boolean `contrast`, with its own `title` and `description`: your text is not
  part of the app's translation files. Settings → Extensions & skills shows it under the extension's switch.
- `sessionExtensions(session)` returns pi extension factories built for one chat from the services
  ThinkRail gives that chat. `session.setting("contrast")` reads the setting by the key you declared.
  Read a setting inside the factory, as `paletteTool` does: a changed value reaches an open chat when its
  current turn ends and ThinkRail rebuilds the chat's factories.
- `extensions` holds factories that need no per-chat services. Palette has none, so it is empty; the
  field is required.

Each factory is an ordinary pi extension, `(pi: ExtensionAPI) => void`: `pi.registerTool` and the rest
of pi's [extension guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
apply. The tool's `content` is what the agent reads; its `details` travel with the result to the card.
The descriptor can also declare `childExtensions`, `skillPackages` and `interactiveTools`; the
[reference](/docs/extension-reference/#server-descriptor) describes them.

If the server entry's top level, or one of its factories in a chat, has not finished within 10
seconds, ThinkRail stops waiting: a hanging top level fails the extension's row, and a hanging factory
is that chat's load error for your extension. Do slow work lazily, inside a tool's `execute`.

### Tool names

<!-- guard: host-tools -->
Give your tools names of their own. A tool, command or flag name that ThinkRail already owns stays
ThinkRail's: the tools of its built-in extensions (such as `ask_user_question`), its own tools (such as
`set_title`, `request_review` and the subagent tool `Agent`), and the tools of MCP servers and of tool
search (`tool_search`).

If your extension registers one of these names, that registration has no effect: the agent keeps
calling ThinkRail's tool, and your extension's other tools work as usual. For the names ThinkRail
knows up front (its built-in extensions' tools and its own fixed tools), Settings leaves the name out
of your extension's tools and `status.json` lists it under `shadowed`. Tools that exist only inside a
chat (the subagent tool, MCP tools, tool search) cannot be checked that way and are still listed, so
check your names against the tools a chat already has. A user's own pi package that registers a name your extension also registers
keeps it too, and between two installed extensions the one listed first in `extensions.json` keeps it.
The [reference](/docs/extension-reference/#names-thinkrail-keeps) has the rules.

### pi and typebox are peer dependencies

Declare `@earendil-works/pi-coding-agent` and `typebox` (and any other `@earendil-works/*` package you
import) in `peerDependencies` with `"*"`, never in `dependencies`; the build fails if they are
dependencies, also for an extension without a server half. Your own imports of them always resolve to the one copy inside ThinkRail. A second copy in
your package's `node_modules` is what a plain-JavaScript dependency of yours would bind to instead, with
different classes and registries from the ones the agent uses. When ThinkRail installs an npm or git
source it removes any copy from the extension's `node_modules`. List them in `devDependencies` as well
for type checking: npm does not install a published package's dev dependencies.

## The web half

The web half's default export is a descriptor made with `defineWebExtension`. Its `toolRenderers` are
keyed by **tool name**: the card registered for `color_palette` renders every `color_palette` call in
the transcript. Palette's whole `web/index.tsx`:

<!-- guard: file palette/web/index.tsx -->
```tsx
import { defineWebExtension, strArg } from "@thinkrail/extension-sdk/web";
import { PaletteCard } from "./PaletteCard";

export default defineWebExtension({
	name: "@thinkrail/example-extension-palette",
	toolRenderers: {
		color_palette: {
			renderer: PaletteCard,
			options: {
				prominence: "primary",
				defaultExpanded: true,
				summary: ({ args }) => {
					const base = strArg(args, "base");
					return base
						? `${strArg(args, "harmony") || "analogous"} palette from ${base}`
						: "Colour palette";
				},
			},
		},
	},
});
```

Set `name` to the package name, as on the server half; ThinkRail registers the cards under the package
name. `name` and `toolRenderers` are the whole descriptor: another field is a type error in
`defineWebExtension`, and since the build does not type-check, ThinkRail ignores it at runtime without
a warning. A card can be registered for any tool name, also one that comes from a pi package or an MCP
server, but a card ThinkRail registers for a tool by name keeps winning
([Names ThinkRail keeps](/docs/extension-reference/#names-thinkrail-keeps)). The registration `options`
(the [reference](/docs/extension-reference/#web-descriptor) lists all eight):

- `summary` is the text of the call's collapsed row. It receives the render props and the app's own
  translation function, which knows nothing of your text.
- `prominence: "primary"` shows the call as its own card in the transcript; the default, `"routine"`,
  folds it into the turn's activity group with the other routine calls.
- `defaultExpanded` shows the card open once the call completes. `chrome` and `interactive` are in the
  [reference](/docs/extension-reference/#web-descriptor).

The card is an ordinary React component. The top of `web/PaletteCard.tsx` (an excerpt):

<!-- guard: excerpt palette/web/PaletteCard.tsx -->
```tsx
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { Button, IconButton } from "@thinkrail/extension-sdk/ui/button";
import { cn } from "@thinkrail/extension-sdk/ui/utils";
import { resultText, strArg, type ToolRenderProps } from "@thinkrail/extension-sdk/web";
import { useEffect, useState } from "react";
import { type CardSwatch, cssVariables, paletteFromResult } from "./details";
```

and the component the descriptor registers (an excerpt; `SwatchTile`, in the same file, draws each
swatch):

<!-- guard: excerpt palette/web/PaletteCard.tsx -->
```tsx
export function PaletteCard({ args, result, status }: ToolRenderProps) {
	const palette = paletteFromResult(result);
	const variables = palette ? cssVariables(palette) : "";
	const { copied, copy } = useCopy(variables);
	if (!palette) {
		return (
			<p className="tr-text-metadata palette:text-text-muted">
				{status === "error"
					? resultText(result)
					: `Mixing a palette from ${strArg(args, "base") || "a base colour"}…`}
			</p>
		);
	}
	return (
		<div data-testid="palette-card" className="palette:flex palette:flex-col palette:gap-8">
			<div className="palette:grid palette:grid-cols-5 palette:gap-8">
				{palette.colors.map((swatch, index) => (
					<SwatchTile key={`${index}-${swatch.hex}`} swatch={swatch} />
				))}
			</div>
			<div className="palette:flex palette:items-center palette:justify-between palette:gap-8">
				<span className="tr-text-metadata palette:text-text-muted">
					{`${palette.harmony} · ${palette.base}`}
				</span>
				<Button
					variant="outline"
					size="s"
					iconLeft={copied ? RiCheckLine : RiFileCopyLine}
					onClick={() => void copy()}
				>
					{copied ? "Copied" : "Copy CSS variables"}
				</Button>
			</div>
		</div>
	);
}
```

A renderer receives `ToolRenderProps`: the call's `toolName`, `args`, `result` (the object your tool
returned, `details` included) and `status` (`"running"`, `"done"` or `"error"`), among others.
`details.ts` reads `result.details` defensively: a card also renders failed calls and calls in
transcripts written by an older version of your tool.

If a renderer throws while rendering, ThinkRail shows its default row for that one call and the rest of
the chat keeps working. Errors thrown in effects or event handlers are not caught that way; handle them
in your code, as `useCopy` does for the clipboard.

### What the web half shares with the app

The card runs on the app's own React and uses some of the app's own modules. These imports are not
bundled: the build replaces each with a lookup on the running app, also when one of your dependencies
makes it.

<!-- guard: shared-modules-summary -->
- `react`, `react/jsx-runtime`, `react-dom`
- `@thinkrail/extension-sdk/web`: `defineWebExtension`, the render types and the helpers `strArg`,
  `numArg` and `resultText`
- `@thinkrail/extension-sdk/resources`: the app's file and diff previews
- `@thinkrail/extension-sdk/ui/<module>` for `button` (`Button`, `IconButton`), `theme` and `utils`
  (`cn`)

That is the whole of extension API 1.0, and only the names the
[reference](/docs/extension-reference/#shared-modules) lists exist at runtime, even where React's
own type declarations show more. Importing any other name fails the build, whether by name or by
reading it from `import * as React` in your own code. Read from a default import, it builds and is
`undefined` when the card runs. There is no dialog, text field or keyboard module: draw a
`<textarea>` or a panel inside your card rather than opening a dialog. Palette uses the app's
`Button`, `IconButton` and `cn`. Anything else you import is bundled into `dist/web.js`: Palette
bundles its two icons from `@remixicon/react`, and its whole bundle is about 6 KB.

The build fails on an import the app cannot provide, and the message names the importing file:

- `react-dom/client`: the app owns the React root;
- `react/compiler-runtime`: the React Compiler is not supported, so do not compile the web half with it;
- any other `react` or `react-dom` subpath, which would load a second React;
- `@thinkrail/extension-sdk/server`, or an SDK subpath that is not in the list above;
- `@thinkrail/ui`, `@thinkrail/extension-api` and `@thinkrail/resource-renderers`, the app's private
  packages; the message names the matching SDK path, which exists only for the modules above;
- a CSS file imported from JavaScript; pass it to the build with `--css` instead;
- a package that is not installed, and a Node built-in the bundle uses. The bundle may not import
  anything: the app loads it as one file, so whatever is left as an import fails the build.

### Styles and the prefix

Cards are styled with the app's own Tailwind utilities, its colour, spacing and typography names, under
**a prefix of your own**. You choose the prefix, lowercase letters only, and pass it to the build:
Palette's `build` script runs `thinkrail-extension build --prefix palette`. Every utility in your markup
then carries it as a variant: `palette:flex`, `palette:gap-8`, `palette:text-text-muted`. The app's
typography classes, such as `tr-text-metadata` and `tr-code-text-small`, are used without a prefix: they
come from the app's own stylesheet.

You write no Tailwind entry file. The build compiles this template from the SDK, with `extprefix`
replaced by your `--prefix` and `@source` pointed at the folder of your web entry:

<!-- guard: file sdk/assets/extension.css -->
```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" theme(reference) prefix(extprefix);
@import "@thinkrail/extension-sdk/theme.css" theme(reference);
@import "tailwindcss/utilities.css" layer(utilities);
@source "./web";
```

The output holds only the prefixed utilities your code uses, pointing at the app's CSS variables, so
the card follows the light and dark themes. Palette's `dist/web.css` is under 1 KB. A utility written
without the prefix gets no CSS from your stylesheet.

The prefix is required. Your stylesheet is loaded after the app's. Without a prefix it would emit
utilities the app already has, and the copies, coming later in the page, would change which of two
utilities wins inside the app itself: `px-16 p-8` on an app element would turn from 16px to 8px of
horizontal padding. Pick a prefix no other extension is likely to use; the package name is a good
source.

## Build

<!-- guard: shell -->
```bash
npm run build
```

runs Palette's `build` script, `thinkrail-extension build --prefix palette`. The command reads the
`thinkrail` manifest, bundles `web/index.tsx` into the file named by `web` and builds the stylesheet into
the file named by `styles`, here `dist/web.js` and `dist/web.css`. It runs under Node 22.19 or newer and
under Bun, and prints each file it wrote with its size.

Before building, it checks the manifest with the rules ThinkRail applies, plus three of its own: `api`
must equal the SDK's API version, the `server` file must exist, and pi packages and typebox must not be
dependencies. It warns, without failing, about a missing `thinkrail-extension` keyword, a server half
without `@thinkrail/extension-sdk` in `dependencies` and an unknown manifest field. An extension without
a web half has nothing to build.

The build never overwrites its own inputs: a `web` or `styles` path that is the web entry, the
`server` file, `package.json`, a file the entry imports or the other output, or that lies outside the
package, is refused as a usage error before anything is written. Both files are written beside their
targets first and replace them only once both are built, so a failed build leaves the previous `dist/`
as it was. The command exits with 1 when the build fails and with 2 on a usage error.

The other options (`--entry`, `--css`, `--cwd`, `--no-minify`) are in the
[reference](/docs/extension-reference/#the-build-command).

## Try it from a folder

Install the folder you are working in before publishing anything:

1. Run the build.
2. In ThinkRail, open **Settings → Extensions & skills → Install package…**, paste the absolute path of the
   folder, for example `/Users/jane/code/palette`, keep **Global** selected and click
   **Install palette**. An extension is always installed for you and is on in every project: if
   **This repository only** is selected, the dialog says the extension installs for you only and
   offers **Install globally**.
3. The extension appears in the Installed list with its switch and its **Rate contrast** setting. Ask
   the agent for a triadic palette from `#3b82f6`.

The same install without the dialog: add the folder to `~/.thinkrail/extensions.json`. ThinkRail watches
this file, installs what it lists and loads it.

<!-- guard: extensions-json -->
```json
{
	"extensions": ["/Users/jane/code/palette"]
}
```

A folder must be given by its absolute path (or `~/…`); a relative path fails, because the file has no
folder it could be relative to. A folder is loaded where it is, never copied, and its `node_modules` is
used as it is.

ThinkRail does not watch your folder. When it reconciles its extensions, at start and whenever
`extensions.json` changes, it reloads a folder extension only if `package.json` or a file the manifest
names changed since the last load; a change to another file, such as `server/palette.ts`, is not noticed
that way. **Update** in the extension's ⋯ menu reloads it in place whatever changed: the server entry is
evaluated again whatever its file type, and so is every TypeScript file it imports. A plain-JavaScript
file the entry imports, your own or a dependency's, keeps its first version until ThinkRail restarts, so
restart after changing one or after changing the extension's dependencies. An npm or git source does
not have this limit: every update installs into a fresh folder.

If the server half fails to load (a syntax error, a throw at the top level, a missing dependency, a
descriptor `name` other than the package name, or a top level still running after 10 seconds, which the
row reports as "the server entry did not finish loading within 10 s"), the row says **Failed to load**
with the error, and nothing of the extension runs. The rest of the app is unaffected.

## Publish to npm

<!-- guard: shell -->
```bash
npm publish --access public
```

`--access public` is needed the first time you publish a scoped name such as `@jane/palette`. `prepack`
builds `dist/` before the package is packed. To publish with provenance from GitHub Actions, add
`"provenance": true` to `publishConfig` and give the workflow the `id-token: write` permission; from your
own machine npm refuses it. Before publishing, check that:

- `keywords` contains `thinkrail-extension`;
- the files the manifest names are in the package (`npm pack --dry-run` lists them);
- pi and typebox are peer dependencies, not dependencies.

Anyone can then install it by pasting `npm:` and the package name into **Install package…**, as
`npm:@thinkrail/example-extension-palette` for the sample, or from Browse once it is listed.

## Getting listed

The [extensions page](/extensions/) and the Browse list in Settings → Extensions & skills read one catalog,
`https://thinkrail.ai/extensions/catalog.json`. The site checks npm every hour, so a new package or
version appears within about an hour of publishing. There is no submission and no review: every npm
package whose **latest** version has the `thinkrail-extension` keyword and a valid `thinkrail` manifest
is listed. To be removed, publish a version without the keyword. ThinkRail's maintainers can also
delist a package reported as malicious or abusive; that is the only exception, not a review. An
extension installed from a git URL or a folder works the same once installed, but only npm packages are
listed.

Users find a listed extension in two places. On the extensions page, each card's Copy button gives the
`npm:<name>` source to paste into **Install package…**. In the app, **Settings → Extensions & skills → Browse**
lists the same catalog with a search, marks the extensions already installed, and has an **Install**
button that opens the install dialog for that package. A listing built for a newer extension API than
the user's ThinkRail is marked **Needs a newer ThinkRail** and has no Install button until they update
ThinkRail; one built for an older major is marked **Built for an older ThinkRail** and has none either
([Versions](#versions)).

What a card on the extensions page shows, and where it comes from:

| On the card | From |
| --- | --- |
| Title | the manifest `title`, else the package name |
| Name and version | the package `name` and its latest `version` |
| Description | the package `description`, shortened to 400 characters |
| Author | the name in the package `author`, else its first npm maintainer |
| Agent tools, Chat cards | whether the manifest has `server`, `web` |
| `npm:<name>` and Copy | the package name, to paste into Install package… |
| npm and repository links | the npm page, and the package `repository` as an `https:` URL |

A card names which halves exist, not the tools: those are declared in code the site does not run.

## Versions

`api` in the manifest is the extension API version you built against, and `@thinkrail/extension-sdk`
releases follow it: SDK 1.0.x builds API `1.0`. Depend on the SDK as `~1.0.0`, never with a caret
range: `^1.0.0` would let npm install a later 1.x, which builds a newer API minor that a ThinkRail
supporting only `1.0` refuses to load. ThinkRail loads an extension when the major part equals
its own and the minor part is not newer than its own. A ThinkRail that supports `1.2` loads extensions
built for `1.0`, `1.1` and `1.2`; it does not load `1.3` or `2.0`.

On a mismatch the extension stays installed and is not loaded: neither half runs, and its row in
Settings → Extensions & skills says which API it was built for and which one this ThinkRail supports. An
extension built for a newer minor loads after the user updates ThinkRail; one built for another major
needs a new release built with the matching SDK. ThinkRail decides this from the manifest before any of
the extension's code runs, and the built web half checks the API major again when it loads.

Your package's own `version` is independent of the API version. Publish fixes as ordinary releases:
ThinkRail checks npm and git sources for a newer version and shows **Update available**. Updating
installs the new version beside the old one and switches only once the new one loads; if it fails or is
incompatible, the old version stays. A folder source has no updates to check.

## What installing means

An installed extension runs code on the user's machine: its server half runs in the ThinkRail host with
the user's permissions, like any pi package, and its web half runs in the app window with the same
access as the app's own interface. There is no sandbox and no permission prompt: **installing is the
consent**. An extension is installed for the user and is on in every project; a repository cannot
install an extension for the people who open it. Switching an extension off withholds its tools and
skills from chats while past transcripts keep its cards; after it is removed, its past calls show as
default rows.

An installed extension cannot take over anything of ThinkRail's: a tool, command or flag name it shares
with ThinkRail stays ThinkRail's ([Tool names](#tool-names)).

Listing on the extensions page is not a review. Say in your README what your extension does, which
network services it calls and what it stores.

## Ask the agent to write one

ThinkRail bundles a skill for writing extensions. Ask the agent in a chat, for example "make me a
ThinkRail extension that shows this tool's result as a chart", and it writes the extension to a folder
of its own, `~/thinkrail-extensions/<name>/` unless you name another, builds it, and installs it from
there by adding the folder to `extensions.json`, without asking you to confirm the install. It then
checks that the extension loaded and tells you what it added. Review what it wrote as you would any
code you install; to share it, publish the folder as described above.

## Current limits

- **Text is not translated.** Titles, descriptions, setting labels, summaries and card text are shown
  as you wrote them, in every app language. Translations for extensions are tracked in
  [issue #1423](https://github.com/JetBrains/thinkrail/issues/1423).
- **Contributions are agent tools, skills, boolean settings, interactive tools and chat cards.** Panels,
  palette commands, keyboard shortcuts, overlays and settings other than on/off switches are not
  available.
- **The shared UI is small.** A card gets the app's buttons, `cn`, the theme-swap hook and the resource
  previews; everything else it draws itself or bundles. Modules are added in later API minors as
  authors need them.
- **The React Compiler is not supported** in a web half.
- **No reload on save.** A rebuilt folder extension loads when it is updated or ThinkRail restarts, as
  described in [Try it from a folder](#try-it-from-a-folder).
