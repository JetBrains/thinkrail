---
id: module-pi-extensions
type: module-design
status: draft
title: Portable pi packages (pi-extensions/)
parent: architecture
tags: [pi-extension, publishing]
---

## Responsibility

The workspace root for pi packages ThinkRail **publishes to npm** and that must work in **vanilla `pi`**
with no ThinkRail present. Each package here is a capability (tools, skills) the agent can use anywhere;
ThinkRail is one embedder among others. The ThinkRail-specific halves of a capability live in
[[module-thinkrail-extensions]], never here.

Status: decided in planning; the first package (`visualize`) arrives with PR 1 of the extensions pilot.
Until a package's wiring PR lands, its predecessor under `packages/pi-*` stays untouched and loaded by the
host — two copies coexist on purpose and the wiring PR deletes the old one.

## Identity and distribution

- npm name `@thinkrail/pi-<name>`, directory `pi-extensions/<name>/`. The scope is deliberate: unscoped
  `pi-*` names collide (`pi-subagents` is third-party) and the scope attributes ownership in the
  `pi.dev/packages` gallery, which is an index of npm packages carrying the `pi-package` keyword — there
  is no registry to submit to.
- **Two shapes.** An *installable pi extension* carries a `pi` manifest (`extensions: ["./index.ts"]`,
  `skills` where present, `image`) and the `pi-package` keyword. A *portable library* (e.g. delegation)
  has named exports only — no manifest, no keyword, never a no-op factory — and is verified through its
  packed consumer.
- **Raw TypeScript, no build step** (pi loads entrypoints through jiti). `files` is a package-specific
  whitelist of everything the entrypoints and `exports` transitively import, tests excluded; `exports`
  preserves every subpath an existing consumer uses (e.g. `./core`). Pi SDK packages are
  `peerDependencies: "*"`; `@earendil-works/pi-tui` is a `"*"` peer where TUI rendering exists. The tested
  pi version is the root catalog's and is never restated here (architecture Decision 10).
- The ThinkRail host consumes these packages through `workspace:*`; the published artifact is verified by
  the parity gate, not by the host.

## Vanilla-parity bar

Required before a package's first publish, and the definition of "works in vanilla pi":

- Installs from its **packed tarball** with dependencies resolved by npm, loads through pi's own
  resolver/loader with zero diagnostics, and registers its tools and skills. (A local-path `pi install`
  installs nothing — it only records the path — so the gate never uses it.)
- **Dual runtime.** Vanilla pi is an npm CLI under Node ≥ 22.19 with jiti; ThinkRail runs the same code
  under Bun. Shipped code uses `node:` builtins and standard ESM only — no `Bun.*`, `bun:*`, or
  Bun-specific `import.meta`.
- TUI: `renderCall` and `renderResult` wherever the plain text fallback reads poorly; every UI call behind
  `ctx.hasUI`. A **manual check in a real terminal** (Ghostty/iTerm2, and inside tmux) is part of the bar.
- No ThinkRail assumptions: no `~/.thinkrail` paths, no host wire, no `@thinkrail/*` imports other than
  sibling portable packages.
- Gate: `scripts/check-pi-packages.ts` (CI, provider-free). Packs the package and every pending portable
  workspace dependency, installs the tarballs plus pi at the catalog version into a temp agent dir
  **outside the repository** with pi's own npm policy (`--legacy-peer-deps`), configures
  `packages: ["npm:@thinkrail/pi-<name>"]`, and under **Node** runs `DefaultResourceLoader.reload()`.
  Tools are then checked in one of two lifecycle modes: *registration-time* tools are executed through the
  stored definition; *session-bound* tools (registered in `session_start`, e.g. subagents,
  background-commands) through an isolated `AgentSession` on pi's faux provider. Token-backed smokes stay
  on-demand.

## Release

`@changesets/cli` (catalog-pinned), independent versions, private packages ignored. On `main`,
`changesets/action` maintains the "Version Packages" PR (`changeset version` + `bun install`). On merge,
`scripts/publish-pi-packages.ts` publishes **dependencies before dependents**, each public package not yet
on npm: `bun pm pack` (rewrites `workspace:*`/`catalog:` to exact versions, satisfying Decision 10) →
`npm publish <tgz> --provenance --access public` under npm Trusted Publishing (Bun has no OIDC auth) →
`changeset tag` only after success. Trusted Publishing is configured per *existing* package, so each new
package gets one manual bootstrap publish first.

Order: visualize → delegation + subagents → background-commands → spec-graph → todos. Not published:
`pi-thinkrail-workflow` (workspace-internal), `pi-dag` (until it has a consumer).

## Boundary

- **Allowed deps:** pi SDK peers, sibling `pi-extensions/*`, ordinary npm runtime deps declared exactly.
- **Forbidden:** `@thinkrail/*` host packages, `packages/server`, `apps/*`, `thinkrail-extensions/*`.
- Dependency edges between siblings (e.g. subagents → delegation) are listed here when they exist:
  `subagents → delegation`, `dag → delegation`.

## Members

| package | shape | notes |
| --- | --- | --- |
| `visualize` | extension | `visualize` tool; `beautiful-mermaid` for TUI box-drawing and the best-effort vanilla validation; exports `createVisualizeExtension({ validateMermaid })` so an embedder can inject a strict validator. Detail: [[pi-visualize-module]] until its spec moves here with PR 1. |
