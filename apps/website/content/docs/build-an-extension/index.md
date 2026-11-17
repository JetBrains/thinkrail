---
title: "Build a ThinkRail extension"
slug: build-an-extension
description: "Write an extension that adds agent tools and chat cards to ThinkRail, try it from a folder, and publish it to npm so it is listed on the extensions page."
order: 10
---

This guide walks through one small extension from an empty folder to a published npm package. The
running example is `thinkrail-ext-dice`: a tool the agent calls to roll dice, a card that shows the roll
in chat, and one setting.

## What a ThinkRail extension is

A ThinkRail extension is an npm package with a **server half**, a **web half**, or both:

- The **server half** runs in the ThinkRail host process, next to the agent. It contributes **agent
  tools**, **skills**, **boolean settings** and **interactive tools** (tools whose call waits for the
  person to answer in chat).
- The **web half** runs in the app window. It contributes **chat cards**: the way a tool call is shown in
  the transcript.

The agent inside ThinkRail is [pi](https://github.com/earendil-works/pi). A pi package (pi's own
extension format) is an optional dependency of the server half: the server half can compose one, but it
does not have to, and an extension that only changes how something looks in chat has no server half at
all.

An extension contributes exactly what ThinkRail's built-in extensions contribute today, with the same
code-level descriptors. Panels, commands and other kinds of settings are not available yet; see
[Current limits](#current-limits).

## The package

```text
thinkrail-ext-dice/
├── package.json
├── server/
│   └── index.ts      server half, published as TypeScript source
├── web/
│   ├── index.tsx     web half source
│   └── styles.css    Tailwind entry for the card's styles
└── dist/             written by `thinkrail-extension build`
    ├── web.js
    └── web.css
```

The package declares itself in `package.json` with the `thinkrail-extension` keyword and a `thinkrail`
manifest:

```json
{
  "name": "thinkrail-ext-dice",
  "version": "1.0.0",
  "description": "Lets the agent roll dice and shows each roll as a card.",
  "author": "Jane Doe",
  "license": "MIT",
  "repository": "github:jane/thinkrail-ext-dice",
  "type": "module",
  "keywords": ["thinkrail-extension"],
  "files": ["server", "dist"],
  "scripts": {
    "build": "thinkrail-extension build",
    "prepublishOnly": "thinkrail-extension build"
  },
  "thinkrail": {
    "api": "1.0",
    "server": "./server/index.ts",
    "web": "./dist/web.js",
    "styles": "./dist/web.css",
    "title": "Dice",
    "image": "https://raw.githubusercontent.com/jane/thinkrail-ext-dice/main/preview.png"
  },
  "dependencies": {
    "@thinkrail/extension-sdk": "^1.0.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@types/react": "^19.0.0",
    "typebox": "*"
  }
}
```

The fields of the `thinkrail` manifest:

| Field | Required | Meaning |
| --- | --- | --- |
| `api` | Yes | The extension API version the extension was built for, as `major.minor`. See [Versions](#versions). |
| `server` | One of `server` / `web` | Path to the server half's TypeScript entry. |
| `web` | One of `server` / `web` | Path to the built web half, one ESM file. |
| `styles` | No, only with `web` | Path to the built stylesheet of the web half. |
| `title` | No | The display name. Defaults to the package name. |
| `image` | No | An `https:` URL of a preview image for the extensions page. |

Every path is relative to the package root and must stay inside the package. The description, author
and version shown for the extension are the package's own `description`, `author` and `version` fields.

The package `name` is the extension's identity: ThinkRail keys the extension's on/off switch and its
settings by it, so renaming the package makes it a different extension. It cannot be the name of one of
ThinkRail's built-in extensions.

## The server half

The server half's default export is a descriptor made with `defineServerExtension`. Here is the dice
extension's `server/index.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineServerExtension } from "@thinkrail/extension-sdk/server";
import { Type } from "typebox";

export default defineServerExtension({
  name: "thinkrail-ext-dice",
  title: "Dice",
  description: "Lets the agent roll dice and shows each roll as a card.",
  extensions: [],
  settings: {
    sortRolls: {
      type: "boolean",
      default: false,
      title: "Sort rolls",
      description: "List the dice from lowest to highest.",
    },
  },
  sessionExtensions: (session) => [
    function dice(pi: ExtensionAPI) {
      pi.registerTool({
        name: "roll_dice",
        label: "Roll dice",
        description: "Roll dice that all have the same number of sides and report each result.",
        parameters: Type.Object({
          count: Type.Integer({ minimum: 1, maximum: 20, description: "How many dice to roll" }),
          sides: Type.Integer({ minimum: 2, maximum: 100, description: "Sides on each die" }),
        }),
        async execute(_toolCallId, { count, sides }) {
          const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
          if (session.setting("sortRolls")) rolls.sort((a, b) => a - b);
          const total = rolls.reduce((sum, roll) => sum + roll, 0);
          return {
            content: [{ type: "text", text: `Rolled ${count}d${sides}: ${rolls.join(", ")} (total ${total})` }],
            details: { sides, rolls, total },
          };
        },
      });
    },
  ],
});
```

What the descriptor holds:

- `name` — the package name. `title` and `description` are what Settings → Extensions shows for the
  extension.
- `extensions` — pi extension factories (`(pi: ExtensionAPI) => void`) added to every chat. Give each
  factory a function name, as `dice` above: pi's diagnostics use it.
- `sessionExtensions(session)` — factories built for one chat from the services ThinkRail gives that
  chat. `session.setting(key)` reads one of your settings. Use this form whenever a tool needs a setting
  or another per-chat service.
- `settings` — boolean switches, shown nested under the extension in Settings → Extensions. Each one
  carries its own `title` and `description`, because your text is not part of the app's translation
  files. A changed value reaches open chats when their current turn ends.
- `childExtensions` — factories added to the curated set of subagents ThinkRail starts.
- `skillPackages` — package names whose pi `skills` folders become skills of this extension. They are
  resolved from your server entry, and switching the extension off drops them with its tools.
- `interactiveTools` — the names of tools whose call waits for the person. The tool waits with
  `session.awaitToolResponse(toolCallId, signal)`; the web half renders the question and answers through
  the `interaction` it receives (see below).

Any pi extension works inside these factories: everything in pi's
[extension guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
about tools applies. If a pi package you depend on already exports a factory, list it instead of writing
your own.

ThinkRail loads `server` as TypeScript source with pi's own loader, so nothing needs to be compiled.

### pi and typebox are peer dependencies

Declare `@earendil-works/pi-coding-agent` and `typebox` (and any other `@earendil-works/pi-*` package you
import) in `peerDependencies` with `"*"`, never in `dependencies`. Your own imports of them always
resolve to the single copy inside ThinkRail. A second copy in your package's `node_modules` is what a
plain-JavaScript dependency of yours would bind to instead, giving it different classes and registries
from the ones the agent uses. ThinkRail keeps them out of an installed extension's `node_modules`;
listing them in `devDependencies` for type checking is fine, because npm does not install an
installed package's dev dependencies.

`@thinkrail/extension-sdk` itself is an ordinary dependency: the server half imports it at run time, and
it imports no pi code.

## The web half

The web half's default export is a descriptor made with `defineWebExtension`. Its `toolRenderers` are
keyed by **tool name**: the card for `roll_dice` renders every `roll_dice` call in the transcript. Here is
`web/index.tsx`:

```tsx
import { defineWebExtension, numArg, type ToolRenderProps } from "@thinkrail/extension-sdk/web";
import { cn } from "@thinkrail/extension-sdk/ui/utils";

function rollsOf(result: unknown): number[] {
  if (typeof result !== "object" || result === null || !("details" in result)) return [];
  const { details } = result;
  if (typeof details !== "object" || details === null || !("rolls" in details)) return [];
  return Array.isArray(details.rolls) ? details.rolls.filter((roll) => typeof roll === "number") : [];
}

function DiceCard({ args, result, status }: ToolRenderProps) {
  if (status === "running") return <p className="dice:text-text-muted">Rolling…</p>;
  const sides = numArg(args, "sides");
  return (
    <ul className="dice:flex dice:flex-wrap dice:gap-8">
      {rollsOf(result).map((roll, index) => (
        <li
          key={`${index}-${roll}`}
          className={cn(
            "dice:rounded-sm dice:border dice:border-border-default dice:px-8 dice:py-4",
            roll === sides && "dice:text-primary",
          )}
        >
          {roll}
        </li>
      ))}
    </ul>
  );
}

export default defineWebExtension({
  name: "thinkrail-ext-dice",
  toolRenderers: {
    roll_dice: {
      renderer: DiceCard,
      options: {
        prominence: "primary",
        summary: ({ args }) => `Roll ${numArg(args, "count") ?? 1}d${numArg(args, "sides") ?? 6}`,
      },
    },
  },
});
```

A renderer receives `ToolRenderProps`: the call's `toolName`, `args`, `result` (the object your tool
returned, `details` included), `status` (`"running"`, `"done"` or `"error"`), `streaming`, and for an
interactive tool the `interaction` to answer with. The registration `options` set the collapsed row's
`summary`, its `prominence` (`"primary"` shows the card open in the transcript, `"routine"` groups it with
other routine calls), `chrome` (`"card"` or `"bare"`), `defaultExpanded`, and `interactive`.

If a renderer throws while rendering, ThinkRail shows its default row for that one call and the rest of
the chat keeps working. Errors thrown in effects or event handlers are not caught that way; handle them
in your code.

### What the web half may import from the app

The card runs on the app's own React, and a small set of the app's modules is shared with it:

- `react`, `react/jsx-runtime`, `react-dom`
- `@thinkrail/extension-sdk/web` — `defineWebExtension`, the render types, and helpers such as `strArg`,
  `numArg` and `resultText`
- `@thinkrail/extension-sdk/resources` — `ResourcePreview`, `useResourceScope` and
  `useOptionalResourceHost`, to show a workspace file or a before/after of two files with the app's own
  renderers
- `@thinkrail/extension-sdk/ui/<module>` for `button`, `dialog`, `textarea`, `keyboard`,
  `attention-line`, `utils` (`cn`), `theme` and `fonts`

The build replaces each of these imports with a lookup on the running app, also when one of your
dependencies makes it. Everything else you import, an icon set for example, is bundled into your own
`dist/web.js`. `react-dom/client` is not available: the app owns the React root.

Do not compile the web half with the React Compiler. Its output imports `react/compiler-runtime`, which
is not in the shared set.

### Styles and the Tailwind prefix

Cards are styled with the app's own Tailwind utilities, its colour, spacing and typography names, under
**a prefix of your own**. `web/styles.css` imports the theme file that ships with the SDK and sets the
prefix:

```css
@import "@thinkrail/extension-sdk/tailwind.css" prefix(dice);
```

Every utility in your markup then carries the prefix as a variant: `dice:flex`, `dice:gap-8`,
`dice:text-text-muted`. A Tailwind prefix is lowercase letters only; derive it from your package name.
The build emits only the utilities you use, pointing at the app's CSS variables, so the card follows the
light and dark themes.

The prefix is required. Your stylesheet is loaded after the app's. Without a prefix it would emit
utilities the app already has, and the copies, coming later in the page, would change which of two
utilities wins inside the app itself: `px-16 p-8` on an app element would turn from 16px to 8px of
horizontal padding.

## Build

```bash
npx thinkrail-extension build
```

`thinkrail-extension build` (in the SDK) reads the `thinkrail` manifest, bundles `web/index.tsx` into the
file named by `web`, and compiles `web/styles.css` into the file named by `styles`. ThinkRail never
bundles anything when it installs an extension, so the built files are what you publish; the server half
is published as source. The `prepublishOnly` script above rebuilds before every `npm publish`.

## Try it from a folder

Install the folder you are working in, before publishing anything:

1. Run the build.
2. In ThinkRail, open **Settings → Extensions → Install package…**, paste the absolute path of the folder,
   for example `/Users/jane/code/thinkrail-ext-dice`, and confirm. The dialog says it found a ThinkRail
   extension.
3. The extension appears in the Installed list with its switch and its `Sort rolls` setting. Ask the
   agent to roll some dice.

The same install, without the dialog: add the folder to `~/.thinkrail/extensions.json`. ThinkRail
watches this file and installs and loads what it lists.

```json
{
  "extensions": ["/Users/jane/code/thinkrail-ext-dice"]
}
```

A folder is loaded where it is, not copied. Changes are not reloaded while you type: rebuild and restart
ThinkRail to load a new version of your code, and always restart after changing its dependencies.

If the server half fails to load (a syntax error, a top-level throw, a missing dependency), the row says
**Failed to load** with the error, and nothing of the extension runs. The rest of the app is unaffected.

## Publish to npm

```bash
npm publish
```

A scoped name (`@jane/thinkrail-ext-dice`) needs `npm publish --access public` the first time. Before
publishing, check that:

- `keywords` contains `thinkrail-extension`;
- the `thinkrail` manifest is valid and every path it names is in the published files (`npm pack
  --dry-run` lists them);
- pi and typebox are peer dependencies, not dependencies.

Anyone can then install it by pasting `npm:thinkrail-ext-dice` into **Install package…**.

## Getting listed

The [extensions page](/extensions/) and the Browse list in Settings → Extensions read one catalog,
`https://thinkrail.ai/extensions/catalog.json`. The site rebuilds it from npm every hour, so a new
package or version appears within about an hour of publishing. There is no submission and no review:
every npm package whose **latest** version has the `thinkrail-extension` keyword and a valid `thinkrail`
manifest is listed. To be removed, publish a version without the keyword.

A listing shows the title, the package name and version, the description, the author (the package's
`author`, or its first npm maintainer), the preview image, whether the extension has agent tools (a
server half) and chat cards (a web half), and links to npm and to the package's repository. Only an
`https:` image is shown; the card crops it to a 16:9 box.

An extension installed from a git URL or a folder works the same once installed, but only npm packages
are listed.

## Versions

`api` in the manifest is the extension API version you built against, and `@thinkrail/extension-sdk`
releases follow it. ThinkRail loads an extension when the major part equals its own and the minor part
is not newer than its own. A ThinkRail that supports `1.2` loads extensions built for `1.0`, `1.1` and
`1.2`; it does not load `1.3` or `2.0`.

On a mismatch the extension stays installed and is not loaded: neither half runs, and its row in
Settings → Extensions says why. An extension built for a newer API loads after the user updates
ThinkRail; one built for an older major needs a new release built against the current SDK. Target the
oldest API that has what you use, so the most ThinkRail versions can load it.

Your package's own `version` is independent of the API version. Publish fixes as ordinary semver
releases; installed copies show **Update available**.

## What installing means

An installed extension runs code on the user's machine: its server half runs in the ThinkRail host with
the user's permissions, like any pi package, and its web half runs in the app window with the same access
as the app's own interface. There is no sandbox and no permission prompt: **installing is the consent**.
An extension is installed for the user and is on in every project. A repository cannot install an
extension for the people who open it.

Listing on the extensions page is not a review. Say in your README what your extension does, which
network services it calls, and what it stores.

## Current limits

- **Text is not translated.** Titles, descriptions, setting labels, summaries and card text are shown as
  you wrote them, in every app language. Translations for extensions are tracked in
  [issue #1423](https://github.com/JetBrains/thinkrail/issues/1423).
- **Contributions are the five listed above**: agent tools, skills, boolean settings, interactive tools
  and chat cards. Panels, commands and settings other than on/off switches are not available yet.
- **No reload on save.** A changed folder extension loads after a restart.
