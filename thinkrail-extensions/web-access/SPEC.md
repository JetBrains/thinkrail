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

The ThinkRail wrapping of the third-party pi package **`pi-web-access`** (including `web_search`, `fetch_content`,
`get_search_content` and `source_check`). The package is composed unchanged and everything it
declares loads, as `pi install` would. The extension preserves the `librarian` skill from
`pi-web-access` 0.13.0 (MIT, Nico Bailon), since upstream no longer ships it. Being a registry extension
is what lets Settings → Extensions switch it off as a unit: tools for parents and subagent children, and
the skill.

## Boundary

One entrypoint, `@thinkrail/ext-web-access/server`, default-exporting
`defineServerExtension({ name: "web-access", title, description, extensions: [piWebAccess], childExtensions: [piWebAccess], skillPackages: ["@thinkrail/ext-web-access"] })`.
It may import `extension-api/server`, `pi-web-access` and pi types; never host internals. There is no
`./web` yet: the existing chat cards stay app-local ([[submodule-web-chat-tools-web]]) and join
by tool name, so moving them later changes nothing on the wire.

- **Not here: the headless-search policy.** Defaulting `web_search`'s `workflow` to `"none"` (else the
  package opens its browser curator, which a host machine may not even display) compensates for the
  host's UI, not for this package, so the host owns it and composes it unconditionally
  ([[submodule-server-agent]]). It must keep applying while this extension is off: that is exactly when a
  user's own install of `pi-web-access` runs.
- The factory lazily imports the package's compiled `dist/index.js` entry when invoked, so the
  configured agent directory is in place before upstream resolves its configuration. It loads under both
  Bun and the Node workflow harness without a raw-TypeScript/Jiti adapter, and both artifact
  bundlers include it through the normal server graph. The package manifest is exported so Node
  can resolve this extension's own skill roots through `skillPackages`.
- The pinned version is this package's dependency; the host no longer depends on `pi-web-access`.
- Upstream controls tool activation (`web_enable` on models/history that select it) and exposes
  `source_check`. Existing web tools keep their dedicated cards; added tools use the host's generic
  renderer. The extension switch withholds the loader together with the tools it can activate.
- Hosted extraction fallbacks now require upstream's `fetchRouting.allowRemoteHostedProviders`
  opt-in. The wrapper preserves that choice: short script-bearing pages can return an extraction
  error in readable mode, while `mode: "raw"` uses direct HTTP without hosted fallbacks.

## Invariants

- Each extension instance owns its session's background fetches. Starting, reloading or ending
  another instance leaves those fetches and stored results alive. Upstream reference-counts
  results shared by forked histories and retains clones while a live session can use them;
  ThinkRail does not duplicate that state or cleanup.
- Switched off, a session loads none of it: no factories (new loads), its tools withheld (live), and
  its skill folder left out of pi's skill inputs, so `librarian` is gone from the session, the
  slash-command list and Settings → Skills — and a user's own `librarian` it would have shadowed loads
  instead. A live idle
  chat that had the skill loaded reloads once to drop it ([[submodule-server-agent]]).
- A user's own install of `pi-web-access` keeps working: while the extension is on, the registry copy
  wins the tool names; while it is off, the user's copy runs. Its own `librarian` is the user's and is not
  owned by this switch.

## Verification

`server/index.test.ts` pins the descriptor, deferred configuration resolution and registration of the package's tools. Composition, skill ownership and live toggling are covered in
`packages/server/src/extensions` and `packages/server/src/agent` tests.
