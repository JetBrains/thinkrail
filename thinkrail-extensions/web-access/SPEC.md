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

The ThinkRail wrapping of the third-party pi package **`pi-web-access`** (`web_search`, `fetch_content`,
`get_search_content`, and its `librarian` skill). The package is composed unchanged and everything it
declares loads, as `pi install` would. Being a registry extension
is what lets Settings → Extensions switch it off as a unit: tools for parents and subagent children, and
the skill.

## Boundary

One entrypoint, `@thinkrail/ext-web-access/server`, default-exporting
`defineServerExtension({ name: "web-access", title, description, extensions: [piWebAccess], childExtensions: [piWebAccess], skillPackages: ["pi-web-access"] })`.
It may import `extension-api/server`, `pi-web-access` and pi types; never host internals. There is no
`./web` yet: the chat cards for the three tools stay app-local ([[submodule-web-chat-tools-web]]) and join
by tool name, so moving them later changes nothing on the wire.

- **Not here: the headless-search policy.** Defaulting `web_search`'s `workflow` to `"none"` (else the
  package opens its browser curator, which a host machine may not even display) compensates for the
  host's UI, not for this package, so the host owns it and composes it unconditionally
  ([[submodule-server-agent]]). It must keep applying while this extension is off: that is exactly when a
  user's own install of `pi-web-access` runs.
- **`piWebAccess.js` + `piWebAccess.d.ts`** — the package ships raw `.ts` that fails the repo's strict
  `tsc`; the paired declaration types the `.js` as `ExtensionFactory`, so `tsc` never enters the
  package. The `.js` loads the package lazily: under Bun (dev, tests, the compiled binary, the desktop
  bundle) through a literal `import("pi-web-access/index.ts")` that both bundlers include; under Node —
  only the workflow harness, which loads the server barrel there ([[module-workflow-tests]]) — through
  jiti, behind a non-literal specifier so no bundler pulls jiti in. Node refuses to strip types under
  `node_modules`, so a plain import would break that harness. Replaced by a plain import once the package passes strict checks or ships types.
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

`server/index.test.ts` pins the descriptor and that the wrapped factory registers the package's tools. Composition, skill ownership and live toggling are covered in
`packages/server/src/extensions` and `packages/server/src/agent` tests.
