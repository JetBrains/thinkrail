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
| `image` | Accepted and ignored: nothing shows a preview image, and the build warns that it is not used. |

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

<!-- guard: reserved-names -->
ThinkRail also refuses a package with a name it reserves; the catalog does not check this. The reserved
names are those of its built-in extensions, `ask-user-question`, `hint-mode`, `next-steps`, `visualize`
and `web-access`, and of its own `mcp` and `tool-search` slots.

Fields the manifest does not define are ignored. Paths are compared after removing `.` segments
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
- `typebox` or an `@earendil-works/*` package is in `dependencies` instead of `peerDependencies`, with
  or without a server half.

It warns, and builds anyway, when `keywords` lacks `thinkrail-extension`, when a server half is declared
but `@thinkrail/extension-sdk` is not in `dependencies`, and when the manifest has a field it does not
define.

## Server descriptor

The default export of the `server` file, made with `defineServerExtension` from
`@thinkrail/extension-sdk/server`.

<!-- guard: server-descriptor -->
| Field | Meaning |
| --- | --- |
| `name` | Required. The package name; any other name fails the load. |
| `title` | The name in Settings → Extensions & skills when the manifest has no `title`. |
| `description` | The description in Settings → Extensions & skills when the package has none. |
| `extensions` | Required. pi extension factories, `(pi: ExtensionAPI) => void`, added to every chat. May be empty. |
| `sessionExtensions` | `(session) => factories`: factories built for one chat from its services, below. |
| `interactiveTools` | An object keyed by the names of tools whose call waits for the person. |
| `artifactTools` | An object keyed by tool name: `presented(args, details)` and `picked(args, details)` return the paths of the files a successful call showed the person and the ones they chose, for the app's artifacts view. |
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
| `workspaceFiles` | `check(path, cwd)`, which rejects a file the app may not show; `scratchDir`, a git-ignored folder for generated files; `artifactsDir`, the folder for files the person keeps; and `ensureArtifactsDir(cwd)`, to call before writing there. |
| `expectToolResponse(toolCallId)` | Announces a call of an interactive tool that this extension will run and wait on. |
| `awaitToolResponse(toolCallId, signal)` | Waits for the person's answer: `{ kind: "response", value }`, `{ kind: "deferred" }` or `{ kind: "abandoned" }`. |

An interactive tool's entry in `interactiveTools` may carry `describeResponse(args, response)`, the text
the agent reads for an answer that arrives after a ThinkRail restart. On the web side, register its card
with `interactive: true`; the card then receives `interaction` and answers with
`interaction.respond(value)`.

The server entry's top level must finish within 10 seconds, or the extension fails to load ("the server
entry did not finish loading within 10 s"). The same bound applies to its factories in each chat: a
factory still running after 10 seconds is that chat's load error for the extension.

## Web descriptor

<!-- guard: web-descriptor -->
The default export of the `web` file, made with `defineWebExtension` from
`@thinkrail/extension-sdk/web`, is `{ name, toolRenderers }` and nothing else. Another field is a type
error in `defineWebExtension`; at runtime, where the build does not type-check, ThinkRail ignores it
without a warning.

ThinkRail registers the renderers under the package name. `toolRenderers` is keyed by tool name; each
entry is `{ renderer, options }`, where `renderer` is a React component receiving `ToolRenderProps`
(a function component, or one made with `memo`, `forwardRef` or `lazy`). Which card wins when two
register one tool name is under [Names ThinkRail keeps](#names-thinkrail-keeps).

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
| `width` | `"column"` (the default) keeps the card in the chat's text column; `"content"` lets it grow to its content's width, up to the pane. |
| `defaultExpanded` | Shows a primary card open once the call completes. |
| `interactive` | Fills `interaction`, for an interactive tool. |
| `dock` | With `interactive`: a call the app is waiting on is shown above the message box, the transcript row as its stub. |
| `composerSuggestions` | `(args, result) => string[]`: when the call ends a finished turn, the strings become one-click next messages above the message box. |

ThinkRail reads only these eight options and ignores any other key in `options`. A renderer that throws
while rendering is replaced by the default row for that call; it is tried again when the call's status or
streaming state changes.

## Shared modules

A web half receives these modules from the app at runtime instead of bundling them. The build replaces
each import with a lookup on the app; at build time the SDK provides their type declarations. Extension
API 1.0 is exactly these modules and, in each, exactly these names; any other name is not shared, even
when React's type declarations offer it. Importing such a name fails the build, by name or read from a namespace
import in your own code (inside a dependency that is only a warning). Read from a default import
(`React.unstable_…`), it builds and is `undefined` at runtime. Later API minors may add modules and names; only a new major removes one.

<!-- guard: shared-modules -->
- `react`: `Activity`, `Children`, `Component`, `Fragment`, `Profiler`, `PureComponent`, `StrictMode`, `Suspense`, `ViewTransition`, `addTransitionType`, `cache`, `cacheSignal`, `cloneElement`, `createContext`, `createElement`, `createRef`, `forwardRef`, `isValidElement`, `lazy`, `memo`, `startTransition`, `use`, `useActionState`, `useCallback`, `useContext`, `useDebugValue`, `useDeferredValue`, `useEffect`, `useEffectEvent`, `useId`, `useImperativeHandle`, `useInsertionEffect`, `useLayoutEffect`, `useMemo`, `useOptimistic`, `useReducer`, `useRef`, `useState`, `useSyncExternalStore`, `useTransition`, `version`
- `react/jsx-runtime`: `Fragment`, `jsx`, `jsxs`
- `react-dom`: `browser`, `createPortal`, `flushSync`, `preconnect`, `prefetchDNS`, `preinit`, `preinitModule`, `preload`, `preloadModule`, `requestFormReset`, `useFormStatus`, `version`
- `@thinkrail/extension-sdk/web`: `defineWebExtension`, `numArg`, `resultText`, `strArg`
- `@thinkrail/extension-sdk/resources`: `FramedResourcePreview`, `ResourcePreview`, `useOptionalResourceHost`, `useResourceScope`
- `@thinkrail/extension-sdk/ui/button`: `Button`, `IconButton`, `withIconClass`
- `@thinkrail/extension-sdk/ui/theme`: `onThemeSwap`
- `@thinkrail/extension-sdk/ui/utils`: `cn`

`react`, `react/jsx-runtime` and `react-dom` also have a default export, so `import React from "react"`
works. There is no dialog, text field or keyboard module in API 1.0: a card draws its own.

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
`web` path and the stylesheet to its `styles` path. Both are written to temporary files beside their
targets and replace them only when both are built, so a failed or interrupted build leaves the previous
files as they were. The bundle is one minified ESM file: JSX uses React's production runtime,
`process.env.NODE_ENV` is `"production"`, and your `tsconfig.json` is not read.

<!-- guard: exit-codes -->
It exits with 0 after a build or `--help`, with 1 when the build fails, and with 2 on a usage error: a
command other than `build`, another argument after it, an unknown option, a missing option value, or a
`web` or `styles` path that would overwrite an input (the web entry, `--css`, the `server` file,
`package.json` or a module the build read), that equals, contains or sits inside the other output, that
is a folder, or that resolves outside the package.

The build fails on these imports in the web half, also when they come from one of your dependencies:

- `react-dom/client`, `react/compiler-runtime` and `react-compiler-runtime`;
- any `react` or `react-dom` subpath other than `react/jsx-runtime` and `react/jsx-dev-runtime`;
- `@thinkrail/extension-sdk/server`, and any SDK path not in [Shared modules](#shared-modules);
- the app's private packages `@thinkrail/ui/*`, `@thinkrail/extension-api` and
  `@thinkrail/resource-renderers`;
- CSS files;
- a package that is not installed, and a Node built-in the bundle uses (one that only unused code
  imports is dropped);
- any import still left in the bundle after bundling: the app loads the bundle as one file and cannot
  resolve imports.

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

Install package… decides the kind from the fetched `package.json`: a package with a `thinkrail`
manifest is installed as an extension, for you, in every project; any other package is installed as a
pi package, exactly as before extensions existed. `extensions.json` holds extensions only: another
package listed there is a failed row.

**States.** Each installed extension is in one of three states:

- **loaded**: the server half's tools and skills reach chats, and the web half's cards are registered;
- **incompatible**: the manifest's `api` is not supported by this ThinkRail, decided before any of the
  extension's code runs; the row says which API it was built for;
- **failed**: nothing of the extension runs, and the row shows why: the install failed, the package has
  no or an invalid manifest or a reserved name, a file the manifest names is missing or resolves outside
  the package, the server half threw while loading or did not finish loading within 10 seconds, its
  descriptor is malformed or named differently from the package, a `skillPackages` entry cannot be
  resolved, or an extension with the same name is already installed from a source listed earlier.

A web half that fails to load registers no cards; its tool calls show as default rows, and the server
half keeps working. Changes to the loaded set reach open chats when their current turn ends.

**Reloading.** At start and whenever `extensions.json` changes, ThinkRail reloads a folder source whose
`package.json` or manifest files changed since the last load. **Update** reloads any source: an npm or
git source is installed again into a fresh folder and replaces the old one only once it loads; a folder
source is evaluated again in place. Either way the server entry is evaluated afresh whatever its file
type, and so is every TypeScript file it imports; a plain-JavaScript file the entry of a folder source
imports, its own or a dependency's, keeps its first version until ThinkRail restarts.

### Names ThinkRail keeps

An installed extension is added to a chat after everything ThinkRail owns: its built-in extensions, its
own tools and session tools, and its MCP and tool-search slots. A tool, command or flag name the
extension shares with any of them stays ThinkRail's: the extension's registration of that name has no
effect, and its other registrations work. Where ThinkRail knows the name up front (a built-in extension's
tool or one of its own fixed tools), Settings leaves it out of the extension's tools and `status.json`
lists it under `shadowed`; a name that exists only inside a chat (the subagent tool, MCP tools, tool
search) is still listed. pi loads a user's own pi packages before every extension
ThinkRail adds, so a pi package keeps a tool name it shares with an installed extension; between two
installed extensions, the one listed first in `extensions.json` keeps it.

Cards follow a different rule, because a card may be meant for a tool from elsewhere: a card ThinkRail
registers for a tool by its exact name wins over an installed one, while MCP tools, which ThinkRail
draws by their `mcp__` prefix, show an installed extension's card when one is registered for their
exact name. Between installed extensions, the one listed first wins.
