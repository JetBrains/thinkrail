---
title: "Extension reference"
slug: extension-reference
description: "The thinkrail manifest, the server and web descriptors, the modules the app shares with a web half, the build command, and how ThinkRail installs and loads an extension."
order: 20
---

This page lists the rules the [authoring guide](/docs/build-an-extension/) walks through. Everything on
it is extension API **1.0**, built with `@thinkrail/extension-sdk` 1.0.

## The thinkrail manifest

The manifest is the `thinkrail` object in the package's `package.json`. Together with the
`thinkrail-extension` keyword in `keywords`, it is what makes a package an extension.

<!-- guard: manifest-fields -->
| Field | Value |
| --- | --- |
| `api` | Required. The extension API version the extension was built for, `major.minor`, for example `"1.0"`. |
| `server` | The server half's entry: a `.ts`, `.mts`, `.cts`, `.js`, `.mjs` or `.cjs` file. |
| `web` | The built web half: one ESM file ending in `.js` or `.mjs`. |
| `styles` | The built stylesheet of the web half, ending in `.css`. Only together with `web`. |
| `title` | The display name. Without it, the package name is shown. |
| `image` | A preview image for the extensions page. Only an `https:` URL is shown. |

At least one of `server` and `web` is required; the other fields are optional.

The description, author and version shown for an extension are the package's `description`, `author`
and `version`. The package `name` is the extension's identity.

### What makes a manifest invalid

ThinkRail does not load, and the catalog does not list, a package whose `package.json`:

- has a `name` that is not a valid npm package name;
- has a `thinkrail` value that is not an object;
- has an `api` that is not two numbers joined by a dot (`1.0`, `1.12`);
- declares neither `server` nor `web`, or declares `styles` without `web`;
- has a `server`, `web` or `styles` path that is absolute, contains a `..` segment, a backslash or a
  NUL character, starts with a URL scheme or a drive letter, or does not end in one of the suffixes in
  the table;
- has a `title` or `image` that is not a non-empty string.

ThinkRail also refuses a package named like one of its built-in extensions; the catalog does not check
this. Fields the manifest does not define are ignored. Paths are compared after removing `.` segments
and repeated slashes, so `./dist/web.js` and `dist/web.js` are the same file.

The same rules as cases, in the format of ThinkRail's own test table of manifests:

<!-- guard: manifest-cases -->
```json
[
	{
		"label": "a web half alone, with its stylesheet",
		"packageJson": {
			"name": "@jane/palette-cards",
			"keywords": ["thinkrail-extension"],
			"thinkrail": { "api": "1.0", "web": "./dist/web.js", "styles": "./dist/web.css" }
		},
		"valid": true
	},
	{
		"label": "styles without a web half",
		"packageJson": {
			"name": "@jane/palette-cards",
			"thinkrail": { "api": "1.0", "server": "./server/index.ts", "styles": "./dist/web.css" }
		},
		"valid": false
	},
	{
		"label": "the web source instead of the built file",
		"packageJson": {
			"name": "@jane/palette-cards",
			"thinkrail": { "api": "1.0", "web": "./web/index.tsx" }
		},
		"valid": false
	},
	{
		"label": "a path outside the package",
		"packageJson": {
			"name": "@jane/palette-cards",
			"thinkrail": { "api": "1.0", "server": "../shared/server.ts" }
		},
		"valid": false
	},
	{
		"label": "an api without a minor part",
		"packageJson": {
			"name": "@jane/palette-cards",
			"thinkrail": { "api": "1", "server": "./server/index.ts" }
		},
		"valid": false
	}
]
```

### What the build adds

`thinkrail-extension build` applies the rules above and refuses to build when:

- `api` is not exactly the SDK's own API version (`1.0` for SDK 1.0);
- the `server` file does not exist;
- `typebox` or an `@earendil-works/*` package is in `dependencies` instead of `peerDependencies`.

It warns, and builds anyway, when `keywords` lacks `thinkrail-extension`, when a server half is declared
but `@thinkrail/extension-sdk` is not in `dependencies`, when the manifest has a field it does not
define, and when `image` is not an `https:` URL.

## Server descriptor

The default export of the `server` file, made with `defineServerExtension` from
`@thinkrail/extension-sdk/server`.

<!-- guard: server-descriptor -->
| Field | Meaning |
| --- | --- |
| `name` | Required. The package name; any other name fails the load. |
| `title` | The name in Settings → Extensions when the manifest has no `title`. |
| `description` | The description in Settings → Extensions when the package has none. |
| `extensions` | Required. pi extension factories, `(pi: ExtensionAPI) => void`, added to every chat. May be empty. |
| `sessionExtensions` | `(session) => factories`: factories built for one chat from its services, below. |
| `interactiveTools` | An object keyed by the names of tools whose call waits for the person. |
| `settings` | Boolean settings, one `{ type: "boolean", default, title?, description? }` per key. |
| `childExtensions` | Factories added to the subagents ThinkRail starts. |
| `skillPackages` | Package names whose pi `skills` become this extension's skills. |

The on/off switch covers everything the descriptor contributes: its factories, its tools in open chats
and the skills of its `skillPackages`. `skillPackages` are resolved from the server entry, so list them
in `dependencies`. A `sessionExtensions` that throws or does not return a list becomes this extension's
load error in each chat; other extensions are not affected.

The services a chat passes to `sessionExtensions`:

<!-- guard: session-services -->
| Service | Meaning |
| --- | --- |
| `setting(key)` | The current value of one of your declared settings; throws for a key you did not declare. Read it inside a factory. |
| `workspaceFiles` | `check(path, cwd)`, which rejects a file the app may not show, and `scratchDir`, a git-ignored folder for generated files. |
| `expectToolResponse(toolCallId)` | Announces a call of an interactive tool that this extension will run and wait on. |
| `awaitToolResponse(toolCallId, signal)` | Waits for the person's answer: `{ kind: "response", value }`, `{ kind: "deferred" }` or `{ kind: "abandoned" }`. |

An interactive tool's entry in `interactiveTools` may carry `describeResponse(args, response)`, the text
the agent reads for an answer that arrives after a ThinkRail restart. On the web side, register its card
with `interactive: true`; the card then receives `interaction` and answers with
`interaction.respond(value)`.

## Web descriptor

The default export of the `web` file, made with `defineWebExtension` from
`@thinkrail/extension-sdk/web`: `{ name, toolRenderers }`. ThinkRail registers the renderers under the
package name. `toolRenderers` is keyed by tool name; each entry is `{ renderer, options }`, where
`renderer` is a React component receiving `ToolRenderProps`.

<!-- guard: render-props -->
| Prop | Meaning |
| --- | --- |
| `toolCallId` | The call's id. |
| `toolName` | The tool's name. |
| `args` | The arguments the agent passed. |
| `result` | What the tool returned, `details` included. |
| `status` | `"running"`, `"done"` or `"error"`. |
| `workspaceRoot` | The chat's workspace folder, when it has one. |
| `onOpenFile` | Opens a workspace file in the app, when the chat can. |
| `streaming` | Whether the message that holds the call is still streaming. |
| `interaction` | For a card registered `interactive`: the call's state and `respond`. |

<!-- guard: registration-options -->
| Option | Meaning |
| --- | --- |
| `summary` | `(props, t) => string`, the collapsed row's text. `t` is the app's translator. |
| `chrome` | `"card"` (the default) draws the app's card frame around the renderer; `"bare"` leaves the frame to the renderer and makes the call primary. |
| `prominence` | `"routine"` (the default) folds the call into the turn's activity group; `"primary"` shows it as its own card. |
| `defaultExpanded` | Shows a primary card open once the call completes. |
| `interactive` | Fills `interaction`, for an interactive tool. |

A renderer that throws while rendering is replaced by the default row for that call.

## Shared modules

A web half receives these modules from the app at runtime instead of bundling them. The build replaces
each import with a lookup on the app; at build time the SDK provides their type declarations. The names
each module exports are extension API 1.0.

<!-- guard: shared-modules -->
- `react`: React 19's own exports
- `react/jsx-runtime`: React 19's own exports
- `react-dom`: React 19's own exports; not `react-dom/client`
- `@thinkrail/extension-sdk/web`: `defineWebExtension`, `languageFromPath`, `numArg`, `parseToolResultContent`, `resultText`, `strArg`, `toolValueText`
- `@thinkrail/extension-sdk/resources`: `FramedResourcePreview`, `ResourcePreview`, `useOptionalResourceHost`, `useResourceScope`
- `@thinkrail/extension-sdk/ui/attention-line`: `AttentionLine`
- `@thinkrail/extension-sdk/ui/button`: `Button`, `IconButton`, `buttonDataAttributes`, `buttonVariants`, `withIconClass`
- `@thinkrail/extension-sdk/ui/dialog`: `Dialog`, `DialogClose`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogPanel`, `DialogTitle`, `DialogTrigger`, `useModalLayerOpen`
- `@thinkrail/extension-sdk/ui/fonts`: `fontsLoaded`, `fontsRevision`, `onFontsChange`, `resolveFont`, `watchFont`
- `@thinkrail/extension-sdk/ui/keyboard`: `browserPlatform`, `hasPlatformModifier`, `isApplePlatform`, `isImeComposing`, `yieldEscapeToIme`
- `@thinkrail/extension-sdk/ui/textarea`: `Textarea`
- `@thinkrail/extension-sdk/ui/theme`: `onThemeSwap`
- `@thinkrail/extension-sdk/ui/utils`: `cn`

## The build command

<!-- guard: shell -->
```bash
thinkrail-extension build [--prefix <letters>] [--entry <file>] [--css <file>] [--cwd <dir>] [--no-minify]
```

<!-- guard: build-options -->
| Option | Meaning |
| --- | --- |
| `--prefix <letters>` | The Tailwind prefix of the extension's utilities, lowercase `a`–`z` only. Required when the manifest declares `styles`; there is no default. |
| `--entry <file>` | The web entry. Default: `web/index.tsx`, else `web/index.ts`. |
| `--css <file>` | A stylesheet of your own, appended to the generated one. Needs `styles` in the manifest. |
| `--cwd <dir>` | The extension's folder. Default: the current folder. |
| `--no-minify` | Keeps the bundle and the stylesheet readable. |
| `-h`, `--help` | Prints the usage. |

The command reads `package.json` in the extension's folder and writes the bundle to the manifest's
`web` path and the stylesheet to its `styles` path, replacing what was there. The bundle is one minified
ESM file: JSX uses React's production runtime, `process.env.NODE_ENV` is `"production"`, and your
`tsconfig.json` is not read. It exits with 0 after a build, with 1 when the build fails, and with 2 on a
command line it does not understand.

The build fails on these imports in the web half, also when they come from one of your dependencies:

- `react-dom/client`, `react/compiler-runtime` and `react-compiler-runtime`;
- any `react` or `react-dom` subpath other than `react/jsx-runtime` and `react/jsx-dev-runtime`;
- `@thinkrail/extension-sdk/server`, and any SDK path not in [Shared modules](#shared-modules);
- the app's private packages `@thinkrail/ui/*`, `@thinkrail/extension-api` and
  `@thinkrail/resource-renderers`;
- CSS files.

The bundle starts with a check that throws when it is loaded outside ThinkRail or in a ThinkRail with
another API major.

## Installing and loading

**Sources.** Install package… and `~/.thinkrail/extensions.json` accept the same sources:

- `npm:<name>`, optionally with a version, as `npm:<name>@<version>`;
- a git repository, as `git:<host>/<path>` or an `https://`, `ssh://` or `git://` URL;
- a folder: an absolute path, a path starting with `~/`, or a `file://` URL.

<!-- guard: extensions-json -->
```json
{
	"extensions": [
		"npm:@thinkrail/example-extension-palette",
		"/Users/jane/code/palette"
	]
}
```

`extensions.json` lives in ThinkRail's data folder, `~/.thinkrail` unless `THINKRAIL_DATA_DIR` names
another. ThinkRail keeps other top-level fields when it writes the file. While the file does not parse,
ThinkRail ignores it, keeps the extensions it had loaded and refuses to rewrite it.

**Installing.** An npm or git source is installed with npm, so `npm` must be on the `PATH` (ThinkRail
uses the npm command configured for pi). Each installed version gets its own folder under
`~/.thinkrail/extensions/installs/`; ThinkRail removes `typebox` and `@earendil-works/*` from its
`node_modules`. With `PI_OFFLINE` set, npm and git sources are not installed; folders still load. A
failed install is retried when you update the extension or restart ThinkRail.

**States.** Each installed extension is in one of three states:

- **loaded**: the server half's tools and skills reach chats, and the web half's cards are registered;
- **incompatible**: the manifest's `api` is not supported by this ThinkRail, decided before any of the
  extension's code runs; the row says which API it was built for;
- **failed**: nothing of the extension runs, and the row shows why: the install failed, the package has
  no or an invalid manifest, a file the manifest names is missing or resolves outside the package, the
  server half threw while loading, its descriptor is malformed or named differently from the package, a
  `skillPackages` entry cannot be resolved, or an extension with the same name is already installed from
  a source listed earlier.

A web half that fails to load registers no cards; its tool calls show as default rows, and the server
half keeps working. Changes to the loaded set reach open chats when their current turn ends.
