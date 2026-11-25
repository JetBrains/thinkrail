# When an extension did not load

Read the entry with `node <skill dir>/scripts/extensions.mjs status <folder>` (or the whole
`<data dir>/extensions/status.json`). Fix the cause, rebuild if the web half changed, then
`extensions.mjs reload <folder>`. Repeat until `state` is `loaded` and `tools` lists your tools.

## `state: "failed"` — the `error` says why

| `error` contains | Cause and fix |
|---|---|
| `"styles" needs a "web" half`, `declare "server", "web" or both`, `"api" must be a "major.minor" version`, `must be a relative path that stays inside the package`, `must name a … file`, `needs a valid npm package name` | the manifest breaks a rule in SKILL.md § 4 — fix `package.json` |
| `is the name of a built-in extension` | rename the package (and both descriptors) |
| `<file> is missing from the package` | not built, or a manifest path is wrong — run the build, check `dist/` |
| `Failed to load extension: Cannot find module '@thinkrail/extension-sdk/server'` | replace the SDK value import with `import type { ServerExtension }` and `export default { … } satisfies ServerExtension` (server-half.md) |
| `Failed to load extension: Cannot find module '<pkg>'` | add the package to `dependencies` and `npm install --omit=peer` |
| `Failed to load extension: <your message>` | the server file threw while loading (top-level code) — fix it |
| `ParseError` / `SyntaxError` | a syntax error in a server file |
| `must be the package name` | the descriptor's `name` differs from `package.json` `name` — make them equal |
| `does not default-export` | `server/index.ts` needs `export default { … } satisfies ServerExtension` with a type-only SDK import |
| `is already installed from <source>` | another declared folder or package has the same name: rename this one, or remove the other declaration |
| `skill package … declares no pi.skills directories` / cannot resolve | fix `skillPackages` and `"pi": { "skills": [...] }` (server-half.md § Skills) |
| `not a ThinkRail extension` | `package.json` has no `thinkrail` key |
| `no package.json in <folder>` | the declared path is wrong |

## `state: "incompatible"`

The manifest's `api` is not loadable here: `built for extension API X; this ThinkRail supports Y` (other
major) or `newer than this ThinkRail's Y; update ThinkRail` (newer minor). Set `api` to the host's API
(`extensions.mjs where`), install the matching SDK (`~<api>.0`), rebuild, reload.

## `state: "loaded"` but a tool is missing from `tools`

The descriptor loaded, but a factory threw or never called `pi.registerTool` — typically
`session.setting("…")` with an undeclared key, or an exception while registering. The script prints a
note when `tools` is empty. Fix the factory and reload. If `tools` is right but the agent still lacks
the tool: the chat has not finished its turn yet, or the user switched the extension off in Settings →
Extensions (an extension's on/off state is not in the status file).

## My tool is listed as `shadowed`

`shadowed` names the tools your server half registers that ThinkRail already owns — a built-in
extension's (`visualize`, `ask_user_question`, …) or the host's own (`set_title`, `skill_search`, …). The
host's tool always wins, so yours never runs, and it is left out of `tools` and Settings. Rename it (keep
the card's `toolRenderers` key in step), rebuild if the web half changed, reload. A name a pi package,
an MCP server or a per-chat host tool (`Agent`, `tool_search`) owns is not detected: it stays in `tools`
but loses the same way — if the agent calls a different tool than yours, pick a more specific name.

## `fileError` at the top of the status

`extensions.json` itself was refused (not valid JSON, not `{ "extensions": [ … ] }`, an entry that is
not a string). The host keeps the last good set loaded, ignores the file until it parses, and
`extensions.mjs` refuses to write it. Fix the JSON by hand — usually a trailing comma or a missing
quote — keeping every entry; the host re-reads it within about a second.

## `state: "installing"`

Only for `npm:` / git sources: the host is still fetching. Wait. A failed fetch turns into `failed` and
is not retried until the source is declared again or ThinkRail restarts.

## The script timed out

ThinkRail is not running, uses another data dir (check `where` against the app), or is older than
status files — then look in Settings → Extensions & skills and ask the user what the row says.

## SDK from a checkout

Before `@thinkrail/extension-sdk` is on npm, a user with a ThinkRail source checkout (and Bun) can pack
it there:

```sh
mkdir -p ~/thinkrail-extensions
cd <checkout>/packages/extension-sdk && bun install && bun pm pack --filename ~/thinkrail-extensions/thinkrail-extension-sdk.tgz
cd <extension folder> && npm install --save-dev --omit=peer ~/thinkrail-extensions/thinkrail-extension-sdk.tgz
```

- `bun install` may run the checkout's own setup scripts (git hooks); it changes no tracked file, and
  nothing in the checkout needs editing.
- The packed SDK says version `0.0.0`; that is expected — its API is still the checkout's (`"1.0"`), and
  the manifest's `api` must equal it.
- `npm install --save-dev <tarball>` records a `file:` dev dependency in `package.json`; replace it with `"~<api>.0"`
  once the SDK is published, before sharing the extension.
