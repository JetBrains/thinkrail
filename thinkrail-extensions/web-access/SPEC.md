---
id: module-ext-web-access
type: module-design
status: active
title: Web access extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api]
references: [submodule-server-extensions, submodule-server-agent, submodule-web-chat-tools-web]
---

## Responsibility

The ThinkRail wrapping of the third-party pi package **`pi-web-access`** (`web_search`, `fetch_content`,
`get_search_content`, and its `librarian` skill). The package is composed unchanged — ThinkRail adds only
a headless policy — and everything it declares loads, as `pi install` would. Being a registry extension
is what lets Settings → Extensions switch it off as a unit: tools for parents and subagent children, and
the skill.

## Boundary

One entrypoint, `@thinkrail/ext-web-access/server`, default-exporting
`defineServerExtension({ name: "web-access", title, description, extensions: [headlessSearchPolicy, piWebAccess], childExtensions: [same], skillPackages: ["pi-web-access"] })`.
It may import `extension-api/server`, `pi-web-access` and pi types; never host internals. There is no
`./web` yet: the chat cards for the three tools stay app-local ([[submodule-web-chat-tools-web]]) and join
by tool name, so moving them later changes nothing on the wire.

- **`headlessSearchPolicy`** — a `tool_call` hook that defaults `web_search`'s `workflow` to `"none"`
  unless the agent chose one; without it the package would open its browser curator, which a ThinkRail
  host never shows. It rides with the package in both sets so a child searches headlessly too.
- **`piWebAccess.js` + `piWebAccess.d.ts`** — the package ships raw `.ts` that fails the repo's strict
  `tsc`. The `.js` re-exports its default factory (Bun, `bun build --compile` and the desktop bundler
  follow it into the package); the paired declaration types it as `ExtensionFactory`, so `tsc` never
  enters the package. Replaced by a plain import once the package passes strict checks or ships types.
- The pinned version is this package's dependency; the host no longer depends on `pi-web-access`.

## Invariants

- Switched off, a session loads none of it: no factories (new loads), its tools withheld (live), and
  its skill folder left out of pi's skill inputs, so `librarian` is gone from the session, the
  slash-command list and Settings → Skills — and a user's own `librarian` it would have shadowed loads
  instead. A live idle
  chat that had the skill loaded reloads once to drop it ([[submodule-server-agent]]).
- A user's own install of `pi-web-access` keeps working: while the extension is on, the registry copy
  wins the tool names; while it is off, the user's copy runs. Its own `librarian` is the user's and is not
  owned by this switch.

## Verification

`server/index.test.ts` pins the descriptor, that the default export is the package's own factory, and
the headless default. Composition, skill ownership and live toggling are covered in
`packages/server/src/extensions` and `packages/server/src/agent` tests.
