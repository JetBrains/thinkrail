---
name: making-thinkrail-extensions
description: Use when the user asks you to make, change, rebuild, switch off or remove a ThinkRail extension — agent tools with their own chat cards, settings or skills, added to ThinkRail as a package — or asks why one they made did not load. You write it to a local folder, build it with @thinkrail/extension-sdk and install it yourself by editing extensions.json. Not for plain pi packages, MCP servers, or ThinkRail's own built-in extensions.
---

# Making ThinkRail extensions

A ThinkRail extension is an npm-style package with a `thinkrail` manifest. Its **server half** gives the
agent tools (pi `registerTool`), boolean settings, interactive tools and skills; its **web half** draws a
card in chat for a tool call. Either half may be missing: a web-only extension can give cards to tools
that come from elsewhere (a pi package, an MCP server). It cannot add panels, commands, menus,
non-boolean settings or translations — say so instead of faking them.

The user asked you to write it **and install it**: do both, without asking for a confirmation click.

## Is it an extension at all?

- Only agent tools or skills, no card wanted → a plain pi package also works (Settings → Extensions →
  Install package). Make an extension when they want a card, a setting with a toggle, or ask for one.
- Wrapping an external service that already has an MCP server → configure the MCP server instead (the
  `managing-mcp-servers` skill). An MCP server is not an extension.
- Changing ThinkRail's own code or its built-in extensions → ordinary repository work, not this skill.

## Steps

### 1. Find the host and check the tools

```sh
node --version   # needs >= 22.19
npm --version
node <this skill's directory>/scripts/extensions.mjs where
```

`where` prints the data dir (`$THINKRAIL_DATA_DIR`, which ThinkRail gives every agent shell; otherwise
`~/.thinkrail`), the paths of `extensions.json` and `status.json`, `api` — the extension API this
ThinkRail loads (for example `"1.0"`) — and `hostReported`, when the host last wrote its status. If both
are `null`, ThinkRail is older than this skill or not running: use `"1.0"` and verify in Settings →
Extensions.

### 2. Check that the SDK can be installed

```sh
npm view "@thinkrail/extension-sdk@~<api>.0" version
```

A version printed → go on. A network error → tell the user npm is unreachable. An `E404` or no output →
the SDK is not on npm yet (it is published with the first ThinkRail release that supports extensions)
or not for this API:

- the user has pointed you at a ThinkRail source checkout → pack the SDK there
  (`reference/troubleshooting.md` § SDK from a checkout) and go on;
- otherwise **stop before writing files** and tell the user: "Making extensions needs the
  @thinkrail/extension-sdk package, which isn't published on npm yet for this version of ThinkRail.
  Once it is, ask me again — or, if you have a ThinkRail source checkout, tell me where it is and I'll
  build the SDK from it."

### 3. Choose the folder and names

- Folder: **`~/thinkrail-extensions/<slug>/`** unless the user names one. Never inside the current
  workspace, a chat folder or the data dir: ThinkRail deletes worktrees and owns
  `<data dir>/extensions/`, and the folder is the user's source code.
- Package name `thinkrail-ext-<slug>` (lowercase, npm rules). It is the extension's identity — the key
  of its on/off switch and settings — so do not rename it later.
- Style prefix: the slug's letters only (`word-count` → `wordcount`), lowercase a–z.
- Tool names: `snake_case`, specific to the extension (`dice_roll`, not `roll`). A name that a built-in
  tool or an earlier extension already registers stays theirs, so never reuse a name from your own tool
  list (`read`, `bash`, `edit`, `write`, …).

### 4. Write the package

```
<folder>/
  package.json        the manifest
  .npmrc              omit=peer
  server/index.ts     server half (TypeScript, loaded as source)
  web/index.tsx       web half entry (bundled by the build)
  dist/web.js         written by the build
  dist/web.css        written by the build
```

Start from the complete, working example in `reference/example.md` and change it. Details:
`reference/server-half.md` and `reference/web-half.md`. Leave out a half you do not need, together
with its manifest keys (no web half → no `web`, `styles`, `scripts.build`).

The `thinkrail` manifest — the host rejects the extension unless:

- `name` is a valid npm name and not a built-in's; the server descriptor's `name` is exactly it;
- `api` is `"major.minor"` equal to `api` from step 1 (the SDK build accepts only its own API; the host
  refuses another major or a newer minor);
- at least one of `server` / `web`; `styles` only together with `web`;
- paths are relative, inside the package, no `..`, no backslash: `server` ends in `.ts`/`.mts`/`.cts`/
  `.js`/`.mjs`/`.cjs`, `web` in `.js`/`.mjs`, `styles` in `.css`;
- `title` / `image`, if present, are non-empty strings;
- `@earendil-works/*` and `typebox` are `peerDependencies`, never `dependencies` (ThinkRail provides
  its own; the build fails otherwise). `@thinkrail/extension-sdk` is a `dependency`.

### 5. Build and check

```sh
cd <folder>
npm install --omit=peer            # SDK from a checkout: npm install --omit=peer <tarball>
npm run build                      # = thinkrail-extension build --prefix <prefix>
```

`--omit=peer` keeps ThinkRail's own pi and typebox out of the folder (it provides them). A server-only
extension needs only the install. Then check before installing: the build exited 0, `dist/web.js` and
`dist/web.css` exist, and it printed no `UNRESOLVED_IMPORT` warning (a package you forgot to install —
the bundle would fail in the app). Build errors name the file and the rule
(`reference/web-half.md` § Build errors). The build does not type-check, and the host loads the server
half by stripping types: type errors do not stop it, runtime errors do — step 7 shows them.

### 6. Install

```sh
node <this skill's directory>/scripts/extensions.mjs add <folder>
```

It adds the absolute folder path to `<data dir>/extensions.json` (creating `{ "extensions": [] }` if
missing, keeping every other entry and key, writing atomically; it refuses to touch a file that is not
valid JSON), waits for the host to read it and prints the extension's status entry. Without `node`,
edit the file the same way by hand: parse it, append the path, write a temporary file and rename it over —
never leave invalid JSON, because the host then ignores the whole file and refuses to rewrite it.

The host watches the file, loads the folder in place and lists it in Settings → Extensions. Open chats
get the new tools **when their current turn ends** — your own chat included, so the tool is not callable
in this turn. Do not try to call it now.

### 7. Read the outcome

The printed entry comes from `<data dir>/extensions/status.json`, which the host rewrites after every
change: `{ api, updatedAt, fileError?, extensions: [{ source, name, version, state, error?, tools? }] }`.

- `loaded` and `tools` lists your tool names → done. A `loaded` server half with a tool missing from
  `tools` threw or skipped `registerTool` in its factory — fix it.
- `failed`, `incompatible`, or a top-level `fileError` → `reference/troubleshooting.md`, fix, rebuild and
  run `reload`. Do not hand the user a broken extension.

### 8. Tell the user

- what you installed (title, tools, card, settings) and the folder path;
- that it runs code on their machine and in the app, like any installed extension;
- that it is in **Settings → Extensions**, where they can switch it off, change its settings or remove
  it;
- that the tools reach a chat from its next turn;
- to share it later, they can publish it to npm: https://thinkrail.ai/docs/build-an-extension/.

## Change, switch off, remove

- **After editing:** rebuild if the web half changed, then
  `node <this skill's directory>/scripts/extensions.mjs reload <folder>`. The host reloads a folder only
  when `package.json` or a manifest file (`server` entry, `web`, `styles`) changed; `reload` touches
  `package.json`, so edits to other server files are picked up too. Open chats see it after their turn.
- **Switch off:** the user's switch in Settings → Extensions; there is no file for it. If a loaded
  extension's tools are missing, check whether it is switched off there.
- **Uninstall:** `node <this skill's directory>/scripts/extensions.mjs remove <folder>` (or the
  Remove button). The folder stays — it is the user's; delete it only if they ask.
