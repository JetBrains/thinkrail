---
id: ext-railmap
type: submodule-design
status: active
title: railmap — module graph and spec drift extension
parent: module-ext-sdk
depends-on: [module-ext-sdk, module-spec-graph]
references: [submodule-server-ext, submodule-web-ext, ext-timeline]
tags: [extensions, example]
---

## Responsibility

Answers "which imports did this branch add that no spec allows?" for the active workspace checkout. It
draws the module graph the specs declare next to the one the code has, and lists the drift between them.
A ThinkRail UI extension written only against `@thinkrail/ext` and `@thinkrail/ext/view`; the SDK
README's third example.

## Model

- **Module** = a directory holding a `SPEC.md` with a spec id. A file belongs to the nearest ancestor
  module directory. A module's **ancestors** are its enclosing module directories plus its frontmatter
  `parent` chain (so `.thinkrail/extensions/timeline` sits under `module-ext-sdk`).
- **Declared edges** = `depends-on` in the frontmatter, read with `pi-spec-graph/core` (`parseFile`,
  `buildGraph`, `linkTargets`). A declaration covers every descendant of both ends: `A → B` allows any
  module under `A` to import any module under `B`. Targets that are not modules are ignored.
- **Actual edges** = import specifiers scanned with the TypeScript API (`ts.preProcessFile`: static,
  `export … from`, dynamic `import()`, `require`, `import("…")` types), resolved on the in-memory file set:
  relative paths with TS extension rules and `index` files, and workspace packages through their
  `package.json` `exports` (string, conditional objects, one `*`). Other bare specifiers are external and
  ignored.
- **Structural edges** (a module and its ancestor, either direction) never need a declaration.
- **Barrel** of a module = its `index.{ts,tsx,js,mjs}` plus, for a package directory, the files its
  `exports` name. A module with no barrel file has nothing to bypass.

## Drift kinds

| kind | key | rule |
| --- | --- | --- |
| `undeclared` | `undeclared:A>B` | an actual non-structural edge no declaration covers |
| `unused` | `unused:A>B` | `A` declares `B`, `A`'s subtree has code, and nothing under `A` imports anything under `B` |
| `bypass` | `bypass:file>target` | a relative import into another module's non-barrel file, from outside that module's subtree; test files (`*.test.*`, `*.spec.*`) and package-specifier imports are exempt |
| `no-spec` | `no-spec:dir` | code outside every module: the highest directory whose subtree has no module; files at the root are exempt |

Drift keys are stable across rebuilds, so "new drift" is a set difference.

## Host half

- Roots are built lazily: when a view `watch`es a workspace (path from `tr.workspaces`), when `may_import`
  runs, or when a session run starts. At most 4 roots stay live (least recently used goes first).
- **Cold build:** walk (skips `node_modules`, VCS/build output, and dot directories other than `.github`
  and `.thinkrail/extensions`), then read and scan files in batches, yielding between batches. The
  channel shows `building` with progress, and the last stored graph (stale) until it is ready. A root
  with more than 200k files or 20k code files fails the build (`error` state) instead of scanning a home
  directory. A root without any module reports no drift.
- **Incremental:** one recursive `fs.watch` per root (disposed with the generation), debounced 150 ms.
  Changed paths are re-read (files) or re-walked (directories), removed ones dropped, then the graph is
  derived again from the in-memory scan (pure, milliseconds on this repo). Updates of one root are
  serialized.
- Publishes `graph:<workspaceId>` = `{ root, status, graph?, stale? }` for watched workspaces. The graph
  holds modules, module edges (import count, declared, structural, bypass count), and drift, not files;
  file lists and import sites come from actions.
- `tr.store` keeps the last graph per root (4 roots max), shown stale on the next cold build.
- Actions: `watch` (`ctx.workspaceId`), `files({ module })` (own files with resolved imports), `sites({
  pairs })` (import sites of module pairs, capped), `rebuild`.

## pi side (`tr.pi`)

- Tool `may_import(from, to)`: `from` is a file, directory, or spec id; `to` is a spec id, path, package
  specifier, or an import specifier relative to the `from` file. Answers `allowed`, `undeclared`,
  `bypass` (allowed only through the barrel), or `unknown`, with the covering declaration or the fix.
- Each session keeps a drift baseline taken at its run's first `agent_start`. At `agent_before_settle` it
  re-reads the files the run's `edit`/`write` calls touched (fs events can lag), and appends one
  `railmap-drift` custom message (displayed) only when the drift has keys that are not in the baseline and
  were not reported earlier in the run. `agent_settled` resets the baseline. Changes made while the root's
  cold build was still running count toward the baseline.

## Views

- `graph` (tab): `@xyflow/react` canvas laid out with `elkjs` (layered). Levels: all top modules →
  children of a module → files of one module. Nodes show drift counts; edges are colored by state
  (declared, undeclared, structural, declared-but-unused dashed). Clicking a node shows its reverse
  closure ("what breaks if I touch X": every module that imports it, directly or transitively) and
  highlights it; clicking an edge lists its import sites. Drift chips toggle a drift-only filter.
- `drift` (panel): drift grouped by kind; **Fix with agent** opens a new chat with a prefilled prompt
  (`startChat`); **Show** opens the graph at that module.
- `drift-card` (message, `railmap-drift`): the new drift a run introduced.
- `may-import` (toolCard, `may_import`): the verdict.

## Dependencies

`@xyflow/react` and `elkjs` (views) plus `typescript` and `pi-spec-graph` (host half) are the
extension's own dependencies (`package.json`, installed by the root `bun install`: the directory is a
workspace member, so `workspace:*` and `catalog:` pins apply).
