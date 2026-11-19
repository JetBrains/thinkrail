# @thinkrail/extension-sdk

Build extensions for [ThinkRail](https://thinkrail.ai/), the agentic IDE built on pi. An extension adds
agent tools (its server half) and chat cards for them (its web half) to every ThinkRail chat.

This package carries extension API **1.0**:

- `@thinkrail/extension-sdk/server` — `defineServerExtension` and its types.
- `@thinkrail/extension-sdk/web` — `defineWebExtension({ name, toolRenderers })`, the tool-card types
  and the helpers `strArg`, `numArg`, `resultText`.
- `@thinkrail/extension-sdk/resources` (`ResourcePreview`, `FramedResourcePreview`, `useResourceScope`,
  `useOptionalResourceHost`), `@thinkrail/extension-sdk/ui/button` (`Button`, `IconButton`,
  `withIconClass`), `…/ui/utils` (`cn`) and `…/ui/theme` (`onThemeSwap`) — the app's own components,
  shared with extensions at runtime, together with `react`, `react/jsx-runtime` and `react-dom`. At
  build time they are type declarations only. Only the names listed in
  `@thinkrail/extension-sdk/shared-modules.json` exist at runtime.
- `thinkrail-extension build` — bundles the web half to one ESM file that uses the app's React and
  components, and builds its stylesheet against the app's theme.

## The package

```json
{
	"name": "thinkrail-ext-weather",
	"keywords": ["thinkrail-extension"],
	"type": "module",
	"thinkrail": {
		"api": "1.0",
		"server": "./server/index.ts",
		"web": "./dist/web.js",
		"styles": "./dist/web.css",
		"title": "Weather"
	},
	"scripts": { "build": "thinkrail-extension build --prefix weather" },
	"dependencies": { "@thinkrail/extension-sdk": "~1.0.0" },
	"peerDependencies": { "@earendil-works/pi-coding-agent": "*", "typebox": "*" },
	"devDependencies": { "@types/react": "^19.3.0", "typescript": "^5.9.0" }
}
```

- Depend on `~1.0.0`, never a caret range: the SDK's `major.minor` is the extension API it builds, and
  a bundle built by a later minor needs a ThinkRail that provides that minor.
- `server` is TypeScript source, loaded by ThinkRail as pi loads extensions. Keep pi and typebox as
  peer dependencies: ThinkRail provides them.
- `web` and `styles` are what `thinkrail-extension build` writes. The web entry is `web/index.tsx`
  (or `--entry <file>`); its default export is a `defineWebExtension` descriptor.

## Building

```sh
npx thinkrail-extension build --prefix weather
```

- `--prefix` (required with `styles`): lowercase letters unique to the extension. Write every utility
  with it — `weather:p-8 weather:bg-feedback-info-subtle` — so the stylesheet never reorders the app's
  own utilities. The app's typography classes (`tr-text-ui`, …) are used as they are.
- `--css <file>` appends your own stylesheet; `--no-minify` keeps the output readable.
- The bundle fails to load outside ThinkRail or in a ThinkRail with a different API major, with an
  error saying so. `react-dom/client` and `react/compiler-runtime` are rejected: the app owns the React
  root, and the React Compiler is not supported in API 1.0.
- The bundle imports nothing: an import of a package that is not installed, or of a Node built-in the
  bundle uses, fails the build.
- Exit codes: 0 on success (and for `--help`), 1 when the build fails, 2 on a usage error (an unknown
  command, option or argument, a missing option value, or a `web` / `styles` path that is also an
  input — the entry, `--css`, the `server` file or `package.json`). A failed build leaves the previous
  `dist/` files as they were.

Runs under Node ≥ 22.19 and Bun.
