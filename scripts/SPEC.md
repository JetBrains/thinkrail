---
id: module-repo-scripts
type: module-design
status: active
title: Repository development and conformance scripts
parent: architecture
references: [module-contracts, module-server, module-web, module-cli, module-desktop, module-ci-release]
tags: [tooling, boundaries, build]
depends-on: [module-spec-graph]
---

## Responsibility

Repository-wide development orchestration and conformance gates that do not belong to one product package. These scripts validate architecture, specification, and artifact assumptions; they never implement product behavior.

## Boundary

- **Owns:** the multi-process development launcher; exact-version/catalog validation; the PI binary-seam canary; module dependency/import boundary validation; and declared-spec-surface to TypeScript-barrel conformance.
- **Public surface:** the root `package.json` commands consumed by developers, Husky, and CI.
- **Allowed deps:** Bun/Node, the TypeScript compiler API, `pi-spec-graph/core` for the canonical spec/frontmatter model, and `mdast-util-from-markdown` for CommonMark block structure; read-only inspection of workspace manifests and source trees; the public package metadata and bundle outputs each check validates.
- **Forbidden:** product runtime logic, a second source of package or feature behavior, editing source as part of a check, or importing application internals to execute them.

`check:boundaries` runs the checker's focused tests before scanning the real workspace. It enforces both manifest edges and static source imports, including type-only, dynamic, re-export, CommonJS, import-type, package-subpath, and relative cross-module forms. Generated/build directories are excluded. The current product rings and launcher edges are exhaustive: contracts and `pi-delegation` → none; `pi-subagents` → `pi-delegation`; shared → contracts; server → contracts/shared plus its bundled extension and delegation packages; web → contracts; CLI → server/shared; desktop → server/shared/contracts. A future composition root must add an explicit rule rather than silently inheriting access to every workspace package.

`check:spec-surface` enrolls only valid specs tagged `public-surface-checked`. Enrollment is explicit so adding prose cannot silently turn enforcement off: an enrolled spec must retain a bare backticked identifier list and a discoverable TypeScript barrel, or the check fails. Unenrolled prose surfaces remain descriptive and are reported only by `--list-skipped`.

The TypeScript compiler resolves the barrel's effective export names, including type-only and default exports and transitive re-exports; a CommonJS `export =` assignment is the module's singular `default` surface rather than the assigned value's synthetic members. An unresolved re-export is a violation rather than a silently incomplete surface. The declared and effective name sets must match in both directions. Filesystem-level tests exercise enrollment, resolution, and failure behavior through the same runner CI invokes.
