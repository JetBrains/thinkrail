---
id: module-spec-graph
type: module-design
status: active
title: Spec-Graph pi extension
parent: architecture
depends-on: []
tags: [spec-graph, pi-extension, v1]
---

## Responsibility

`pi-spec-graph` is a portable pi-package that teaches the `pi` agent the project's **spec-graph** and lets
it search, navigate, and manage specs. It ships a **skill**, seven **`spec_*` custom tools**, and a
project-wide **`before_agent_start` rule**. It depends on nothing in this monorepo, so it runs under
vanilla `pi`; thinkrail bundles it into every session.

It manages the frontmatter schema the repo's specs use — a file is a spec once its frontmatter carries
`id` and `type`; the schema itself is documented in the skill. Frontmatter is handled with the `yaml`
library, link/metadata lists inline. `spec_create` writes new frontmatter in a canonical field order;
`spec_update` edits an existing file **in place** — it preserves the file's own field order and any
comments / nested fields, and writes back the original line ending (LF or CRLF).

## Boundary

- **Owns:** the spec model (the is-a-spec rule, the derived graph, the read index, validation), the seven
  tools, and the skill + `before_agent_start` rule.
- **Public surface:** the extension entry `index.ts` (default `ExtensionFactory`) and the `pi` manifest in
  `package.json` (`{ extensions: ["./index.ts"], skills: ["./skills"] }`) — how vanilla `pi` (`pi install`)
  and thinkrail (`additionalExtensionPaths` / `additionalSkillPaths`) load it — plus the **`pi-spec-graph/core`
  export** (the pi-free read model), consumable by hosts (thinkrail's server) without going through the
  agent. `tools/` stays internal.
- **Allowed deps:** `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `typebox` (peer); `yaml`
  (frontmatter parse/serialize); Node built-ins.
- **Forbidden:** any `@thinkrail-pi/*` package — the dependency edge is one-way (thinkrail → this
  package), which is what keeps it portable.

## Sub-modules

`core/` (`submodule-spec-graph-core`) is the pi-free spec model; `tools/` (`submodule-spec-graph-tools`)
are thin pi wrappers over it. The edge is one-way — `tools/` → `core/`, through core's barrel — and
`index.ts` wires the tools plus the `before_agent_start` rule into the extension. Each sub-spec pins its
own boundary and leaves.

## Derived read index

The filesystem is the source of truth; the model the tools read is **derived, in-memory, read-only, and
revalidated on demand**. Each read re-globs the spec set (ignoring `node_modules`/`.git`/`dist`/`build`)
and revalidates every file by `(mtimeMs, size)`: unchanged files reuse their cached parse, changed/new
files are re-parsed, vanished files are evicted, and the derived graph is rebuilt only when the spec set
actually changed. So specs added, deleted, or edited from any source — including pi's normal `write`/`edit`
— are always current, while redundant re-parse/rebuild is skipped when nothing moved. One `SpecIndex` is
reused per root (keyed by cwd) so the cache pays off across an agent's calls. The one theoretical miss is
an edit landing within the same mtime tick *and* keeping byte length identical (negligible; a content hash
is the sanctioned escalation).

## Tools

Read — `spec_grep` (content search, narrowable by metadata), `spec_get` (a node's frontmatter, resolved
links, and path — no body), `spec_graph` (a bounded subtree/ancestors/neighbors slice). Manage —
`spec_create`, `spec_update` (frontmatter only), `spec_delete`, `spec_validate`. Per-tool usage lives in
the skill and in each tool's `description`; **none edit prose** — prose is written/edited with pi's normal
`read`/`write`/`edit`.

## Knowledge delivery

Concept, schema, and workflow live in the **skill** (auto-discovered via the `pi.skills` manifest /
`additionalSkillPaths`). The always-on rule — treat specs as ground truth, read them before code,
reconcile changes against them, keep them honest — is injected once per agent run via `before_agent_start`.
Each tool carries a `description` (its constraints) and a one-line `promptSnippet` (its entry in the system
prompt's Available-tools list, matching the bundled `pi-web-access` / `pi-visualize` tools). This is
pi-native prompt influence through an extension, not host prompt assembly.

## thinkrail integration

`packages/server/src/agent/extensions.ts` layers this package into every session's
`DefaultResourceLoader` the same way as `pi-web-access`: `require.resolve("pi-spec-graph/index.ts")` on
`additionalExtensionPaths`, the package's `skills` dir on `additionalSkillPaths`. Server references it only
by resolved path (no value import), so it stays out of server's typecheck graph. Separately,
`packages/server/src/spec/` value-imports **`pi-spec-graph/core`** (the pi-free model — no pi packages in
that subtree) to serve the read-only Specs viewer over the wire — the same is-a-spec rule, parser, and
revalidate-on-read `SpecIndex` the agent tools use.

## Invariants

- The dependency edge is one-way: thinkrail depends on this package; this package depends on nothing in the
  monorepo, and `core/` imports no `@earendil-works/*`.
- The index is a derived read cache over the filesystem (the source of truth); it holds no authoritative
  state — `pi` owns state — and never serves a stale graph.
- Tools never edit prose; `spec_update` is frontmatter-only, lossless (preserves comments / nested
  fields), and never un-specs a file.

## Non-goals

UI in this package (thinkrail's Specs viewer consumes `core/` from the outside), semantic/embedding
search, a related-code frontmatter field, orphan-directory detection, and moving/renaming specs.
