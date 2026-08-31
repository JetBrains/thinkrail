---
id: module-repo-scripts
type: module-design
status: active
title: Repository development and conformance scripts
parent: architecture
references: [module-contracts, module-server, module-web, module-cli, module-desktop, module-ci-release]
tags: [tooling, boundaries, build]
---

## Responsibility

Repository-wide development orchestration and conformance gates that do not belong to one product package. These scripts validate architecture and artifact assumptions; they never implement product behavior.

## Boundary

- **Owns:** the multi-process development launcher; exact-version/catalog validation; the PI binary-seam canary; and module dependency/import boundary validation.
- **Public surface:** the root `package.json` commands consumed by developers, Husky, and CI.
- **Allowed deps:** Bun/Node and build-time TypeScript; read-only inspection of workspace manifests and source trees; the public package metadata and bundle outputs each check validates.
- **Forbidden:** product runtime logic, a second source of package or feature behavior, editing source as part of a check, or importing application internals to execute them.

`check:boundaries` runs the checker's focused tests before scanning the real workspace. It enforces both manifest edges and static source imports, including type-only, dynamic, re-export, CommonJS, import-type, package-subpath, and relative cross-module forms. Generated/build directories are excluded. The current product rings and launcher edges are exhaustive: contracts and `pi-delegation` → none; `pi-subagents` → `pi-delegation`; shared → contracts; server → contracts/shared plus its bundled extension and delegation packages; web → contracts; CLI → server/shared; desktop → server/shared/contracts. A future composition root must add an explicit rule rather than silently inheriting access to every workspace package.
