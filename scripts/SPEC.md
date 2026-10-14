---
id: module-repo-scripts
type: module-design
status: active
title: Repository development and conformance scripts
parent: architecture
references: [module-contracts, module-server, module-web, module-cli, module-desktop, module-ci-release, module-thinkrail-extensions]
tags: [tooling, boundaries, build]
depends-on: [module-spec-graph]
---

## Responsibility

Repository-wide development orchestration and conformance gates that do not belong to one product package. These scripts validate architecture, specification, and artifact assumptions; they never implement product behavior.

## Boundary

- **Owns:** the multi-process development launcher; exact-version/catalog validation; the PI binary-seam canary; module dependency/import boundary validation; declared-spec-surface to TypeScript-barrel conformance; and focused root contract tests that compose otherwise independent product implementations.
- **Public surface:** the root `package.json` commands consumed by developers, Husky, and CI.
- **Allowed deps:** Bun/Node, the TypeScript 7 `typescript/unstable/*` API (the async `tsgo` client plus AST type guards), `pi-spec-graph/core` for the canonical spec/frontmatter model, and `mdast-util-from-markdown` for CommonMark block structure; read-only inspection of workspace manifests and source trees; the public package metadata and bundle outputs each check validates; and test-only imports of real product internals when a root harness must prove a cross-package contract without creating a product dependency.
- **Forbidden:** product runtime logic, a second source of package or feature behavior, editing source as part of a check, or application-internal imports outside focused root contract tests. A root contract test may compose implementations but must not become the protocol source or a product dependency.

`check:boundaries` runs the checker's focused tests before scanning the real workspace. It enforces both manifest edges and static source imports, including type-only, dynamic, re-export, CommonJS, import-type, package-subpath, and relative cross-module forms. Generated/build directories, including Hutch's projected `.hutch` SDK trees and transient `.cottontail-tmp` loaders, are excluded. The current product rings and launcher edges are exhaustive: contracts, `pi-delegation`, and `pi-background-commands` → none; `pi-subagents` and `pi-dag` → `pi-delegation`; shared → contracts; server → contracts/shared plus its existing bundled extension and delegation packages; web → contracts and the browser SDK/extension entries below; CLI → server/shared; desktop → server/shared/contracts; artifact-tests → CLI/server/shared. Product packages may not import artifact-tests. A future composition root must add an explicit rule rather than silently inheriting access to every workspace package.

The extension boundary follows [[module-thinkrail-extensions]] and is registered from discovered manifests, not a fixed extension-name list:

- Discover workspace roots under `apps/*`, `packages/*`, `pi-extensions/*`, and `thinkrail-extensions/*`. Every discovered pi extension has no host workspace dependencies. Every ThinkRail extension is scanned, including extensions other than the pilot.
- Register `packages/ui` and `packages/extension-api` only when present, so the boundary-first delivery does not require future SDK manifests. Both may depend on contracts, never host internals. UI permits per-file public imports; browser consumers of extension-api must use exactly `@thinkrail/extension-api/web`, not its root, server entry, deep paths, or relative bypasses. Server consumers use its public `./server` entry.
- An extension manifest may declare the union of its halves' dependencies. Its `web/**` sources may use UI, extension-api's public `./web`, and contracts; its `server/**` sources may use extension-api's public `./server` and its corresponding `pi-extensions/<name>` package. Neither half may import the other, even within the same package, with relative paths, or with type-only syntax. Extension code may not import host internals.
- `apps/web` may consume only the exact public `@thinkrail/ext-*/web` entry of a discovered extension; `packages/server` only `@thinkrail/ext-*/server`. Root, deep, opposite-half, and relative source imports are rejected. Their manifests may depend on the extension package because manifests cannot express subpath edges. Existing server pi-package edges remain until each extension's server-wiring delivery.
- Browser sources (web app, UI, extension-api's browser half, and extension web halves) must never import extension-api's server half. All of extension-api remains runtime-browser-safe: pi types may describe the server contract, but neither entry may value-import pi. Browser sources and contracts likewise reject pi value imports, including external pi packages not registered as workspace roots. Explicit type imports/re-exports remain subject to the existing workspace-edge rules; a type-only import cannot bypass a forbidden module or source-half edge.

These are static literal-import checks, not a runtime module resolver. Negative filesystem fixtures cover the same discovery and scan entrypoint as the real workspace gate.

`check:spec-surface` enrolls only valid specs tagged `public-surface-checked`. Enrollment is explicit so adding prose cannot silently turn enforcement off: an enrolled spec must retain a bare backticked identifier list and a discoverable TypeScript barrel, or the check fails. Unenrolled prose surfaces remain descriptive and are reported only by `--list-skipped`.

The TypeScript compiler resolves the barrel's effective export names, including type-only and default exports and transitive re-exports; a CommonJS `export =` assignment is the module's singular `default` surface rather than the assigned value's synthetic members. An unresolved re-export is a violation rather than a silently incomplete surface. The declared and effective name sets must match in both directions. Filesystem-level tests exercise enrollment, resolution, and failure behavior through the same runner CI invokes.

## TypeScript access (decision, 2026-09)

TypeScript 7 ships the native `tsgo` compiler and no JavaScript parser or checker: the `typescript` package
exposes only `tsc` and the `unstable/*` API. The three checks that read TypeScript syntax or symbols
(`check:seams`, `check:boundaries`, `check:spec-surface`) therefore drive the bundled `tsgo` server through
`typescript/unstable/async` via `scripts/tsProjects.ts`. Each run declares an in-memory `tsconfig` (real files,
virtual config) so that arbitrary file lists — pi's `dist/*.js`, every workspace source tree, a barrel outside
its package's `include` — become a project without touching disk; the syntax-only checks open a lib-free,
resolution-free project, and the spec-surface check `extends` the barrel's nearest `tsconfig.json` (or a
Bundler-resolution fallback) with the barrel appended to its files. The synchronous `unstable/sync` client is
unusable under Bun (it reads Node's private stream handles), so the checks are async end to end. The
`unstable` prefix is an accepted risk: the exact catalog pin makes any API drift a reviewable bump.
