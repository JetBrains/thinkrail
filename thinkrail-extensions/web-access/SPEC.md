---
id: module-ext-web-access
type: module-design
status: active
title: Web access extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api]
references: [submodule-server-extensions, submodule-server-agent, submodule-web-chat-tools-web, module-workflow-tests]
---

## Responsibility

The ThinkRail wrapping of the third-party pi package **`pi-web-access`** (`web_search`, `source_check`,
`fetch_content`, `get_search_content` and its `web_enable` loader) plus the **`librarian` skill**. The
package is composed unchanged and everything it declares loads, as `pi install` would. Upstream dropped
`librarian` in 0.14.0, so the extension ships its own copy: adapted from `pi-web-access` 0.13.0 (MIT,
Nico Bailon; the license sits beside it) to the current package — clones are read at the path
`fetch_content` returns rather than a fixed `/tmp/pi-github-repos/<owner>/<repo>`, and recovery advice
follows the opt-in hosted fallbacks below. Being a registry extension is what lets Settings → Extensions
switch it off as a unit: tools for parents and subagent children, and the skill.

## Boundary

One entrypoint, `@thinkrail/ext-web-access/server`, default-exporting
`defineServerExtension({ name: "web-access", title, description, extensions: [piWebAccess], childExtensions: [piWebAccess], skillPackages: ["@thinkrail/ext-web-access"] })`.
It may import `extension-api/server`, `pi-web-access` and pi types; never host internals. There is no
`./web` yet: the cards for `web_search`, `fetch_content` and `get_search_content` stay app-local
([[submodule-web-chat-tools-web]]) and join by tool name, so moving them later changes nothing on the
wire; `source_check` and `web_enable` use the host's default renderer.

- **Not here: the headless-search policy.** Defaulting `web_search`'s `workflow` to `"none"` (else the
  package opens its browser curator, which a host machine may not even display) compensates for the
  host's UI, not for this package, so the host owns it and composes it unconditionally
  ([[submodule-server-agent]]). It must keep applying while this extension is off: that is exactly when a
  user's own install of `pi-web-access` runs.
- **`piWebAccess.js` + `piWebAccess.d.ts`** — the package ships untyped compiled JavaScript
  (`dist/index.js`, no `exports` map); the paired declaration types the `.js` as `ExtensionFactory`, so
  `tsc` never enters the package. The `.js` imports the entry lazily, when the factory runs: upstream
  resolves its `web-search.json` path from the agent directory at module load, and the host sets that
  directory after the registry is imported. The literal specifier loads under Bun and the Node workflow
  harness ([[module-workflow-tests]]) alike, and both artifact bundlers carry it through the normal
  server graph.
- `skillPackages` names this package itself; its manifest exports `./package.json` and declares
  `pi.skills`, so the host's owner-scoped resolver finds `skills/` like any other skill package.
- The pinned version is this package's dependency; the host no longer depends on `pi-web-access`.
- **Tool activation.** Upstream's `toolActivation: "auto"` leaves a fresh chat on a model that takes
  mid-conversation tool changes with only `web_enable`, and replays the transcript's recorded web tools
  on every `session_start`, reloads included. The host's registry-tool reconcile
  ([[submodule-server-agent]], at attach and after a reload) activates every tool of an enabled registry
  extension, so a parent chat always has the web tools and `web_enable` merely reports them enabled;
  subagent children are outside that reconcile. The switch withholds the loader with the other tools.
- **Hosted extraction is opt-in.** Since 0.14 third-party hosted fetchers (Jina Reader, Gemini URL
  context, TinyFish, Kagi, Parallel, Bright Data, …) never see a remote HTTP(S) target unless the user sets
  `fetchRouting.allowRemoteHostedProviders` in `<agent dir>/web-search.json`; the wrapper keeps that
  default. `fetch_content` therefore no longer recovers, in its default readable mode, pages whose direct
  HTTP extraction fails or looks incomplete — client-rendered apps, short pages that run scripts
  (`https://example.com`), bot and cookie walls. The call fails (`isError`) with the cause and a
  "Fallback options" list that names the opt-in and the file's absolute path. `mode: "raw"` returns the
  direct HTTP body; GitHub clones, PDFs, self-hosted Firecrawl/Crawl4AI and video are unaffected (Gemini
  Web cookies are separately opt-in through `allowBrowserCookies`).
- Upstream's once-per-version upgrade notice reads `CHANGELOG.md` beside `dist/`, which neither artifact
  embeds, and records `pi-web-access/last-seen-version.json` in the agent dir; check both on the next bump.

## Invariants

- Each extension instance (one per session) owns its session's background fetches and its holds on
  stored results. Starting, reloading or ending another instance leaves them alive; upstream drops a
  result once no live session holds it (forked histories share holds) and removes clones only when no
  live session can have been given their paths. ThinkRail duplicates none of that state or cleanup.
- Switched off, a session loads none of it: no factories (new loads), its tools withheld (live), and
  its skill folder left out of pi's skill inputs, so `librarian` is gone from the session, the
  slash-command list and Settings → Skills — and a user's own `librarian` it would have shadowed loads
  instead. A live idle
  chat that had the skill loaded reloads once to drop it ([[submodule-server-agent]]).
- A user's own install of `pi-web-access` keeps working: while the extension is on, the registry copy
  wins the tool names; while it is off, the user's copy runs. Its own `librarian` is the user's and is not
  owned by this switch.

## Verification

`server/index.test.ts` pins the descriptor, deferred configuration resolution, registration of the
package's tools, and session isolation against the real package: two instances over a local HTTP server
and a stub SearXNG, where one ending and another starting leave the first's stored results and in-flight
background fetch intact. Composition, skill ownership and live toggling are covered in
`packages/server/src/extensions` and `packages/server/src/agent` tests; the artifact probes check that the
bundled entry registers its tools and that the skill is staged under its owner folder.
