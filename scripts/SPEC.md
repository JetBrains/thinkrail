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

- **Owns:** the multi-process development launcher; the on-demand provider sign-in smoke (`smoke:logins`); exact-version/catalog validation; the PI binary-seam canary; module dependency/import boundary validation; the UI-text gate (`check:i18n`); declared-spec-surface to TypeScript-barrel conformance; the on-demand CI flake report (`ci:flakes`); and focused root contract tests that compose otherwise independent product implementations.
- **Public surface:** the root `package.json` commands consumed by developers, Husky, and CI.
- **Allowed deps:** Bun/Node, the developer's authenticated `gh` CLI (read-only, `ci:flakes` only), the TypeScript compiler API, `pi-spec-graph/core` for the canonical spec/frontmatter model, and `mdast-util-from-markdown` for CommonMark block structure; read-only inspection of workspace manifests and source trees; the public package metadata and bundle outputs each check validates; and test-only imports of real product internals when a root harness must prove a cross-package contract without creating a product dependency.
- **Forbidden:** product runtime logic, a second source of package or feature behavior, editing source as part of a check, or application-internal imports outside focused root contract tests. A root contract test may compose implementations but must not become the protocol source or a product dependency.

`smoke:logins` boots a throwaway host in a temp HOME/data/pi-agent sandbox (no ambient credentials, real
network) and, for every provider `provider.status` lists, starts each offered sign-in method over the wire,
walks every branch of pi's select prompts, and passes when each flow reaches its first user step (a sign-in
page, a device code, or a prompt); an error frame or a 15 s stall fails it. It cancels every flow, so nothing
is ever stored, and needs no accounts — it catches a pi upgrade or registry change that breaks how a sign-in
starts, not whether a real credential is accepted. It is on demand, never a commit or CI gate, because it
depends on providers' live endpoints.

`check:boundaries` runs the checker's focused tests before scanning the real workspace. It enforces both manifest edges and static source imports, including type-only, dynamic, re-export, CommonJS, import-type, package-subpath, and relative cross-module forms. Generated/build directories, including Hutch's projected `.hutch` SDK trees and transient `.cottontail-tmp` loaders, are excluded. The current product rings and launcher edges are exhaustive: contracts, `pi-delegation`, and `pi-background-commands` → none; `pi-subagents` and `pi-dag` → `pi-delegation`; shared → contracts; server → contracts/shared plus its existing bundled extension and delegation packages; web → contracts, locales, and the browser SDK/extension entries below; CLI → server/shared; desktop → server/shared/contracts/locales; server, UI, and extension web halves may also use locales, which itself has no workspace edges; artifact-tests → CLI/server/shared. Product packages may not import artifact-tests. A future composition root must add an explicit rule rather than silently inheriting access to every workspace package.

The extension boundary follows [[module-thinkrail-extensions]] and is registered from discovered manifests, not a fixed extension-name list:

- Discover workspace roots under `apps/*`, `packages/*`, `pi-extensions/*`, and `thinkrail-extensions/*`. Every discovered pi extension has no host workspace dependencies. Every ThinkRail extension is scanned, including extensions other than the pilot.
- Register `packages/ui` and `packages/extension-api` only when present, so the boundary-first delivery does not require future SDK manifests. Both may depend on contracts, never host internals. UI permits per-file public imports; browser consumers of extension-api must use exactly `@thinkrail/extension-api/web`, not its root, server entry, deep paths, or relative bypasses. Server consumers use its public `./server` entry.
- An extension manifest may declare the union of its halves' dependencies. Its `web/**` sources may use UI, extension-api's public `./web`, and contracts; its `server/**` sources may use extension-api's public `./server` and its corresponding `pi-extensions/<name>` package. Neither half may import the other, even within the same package, with relative paths, or with type-only syntax. Extension code may not import host internals.
- `apps/web` may consume only the exact public `@thinkrail/ext-*/web` entry of a discovered extension; `packages/server` only `@thinkrail/ext-*/server`. Root, deep, opposite-half, and relative source imports are rejected. Their manifests may depend on the extension package because manifests cannot express subpath edges. Existing server pi-package edges remain until each extension's server-wiring delivery.
- Browser sources (web app, UI, extension-api's browser half, and extension web halves) must never import extension-api's server half. All of extension-api remains runtime-browser-safe: pi types may describe the server contract, but neither entry may value-import pi. Browser sources and contracts likewise reject pi value imports, including external pi packages not registered as workspace roots. Explicit type imports/re-exports remain subject to the existing workspace-edge rules; a type-only import cannot bypass a forbidden module or source-half edge.

These are static literal-import checks, not a runtime module resolver. Negative filesystem fixtures cover the same discovery and scan entrypoint as the real workspace gate.

`ci:flakes` (`bun run ci:flakes [--days 14] [--repo …] [--workflow ci.yml]`) prints a Markdown report of the
CI workflow's test failures over a window, read through `gh api`: runs, per-attempt jobs, and the logs of failed
test jobs only. Pure parsers read bun `(fail)` lines keyed by their `##[group]<file>:` context (the closing
`N tests failed:` summary only repeats them) and Playwright `failed`/`flaky` summary blocks. A change is a PR —
its PR runs and merge-queue entries count once — or, without a PR, a branch. Per test it counts failures,
Playwright flaky passes, distinct changes, merge-queue failures, and failures whose SHA later passed the same
job or a whole run. A test is flake-classified on a passing rerun, a flaky mark, failures for 3+ changes, or
merge-queue failures for 2+ changes; the rest are listed apart as probably genuine. Failed steps no parsed test
explains (build, install, download, or a step failing beside a test failure) are listed by step, and an
attempt counts as flake-only only when every failure in it is a flake-classified test. It automates the hand
analysis behind the 2026-10 CI-flake series; it is a diagnostic, never a gate, and has no scheduled run. Flaky
passes in otherwise green jobs are not seen, because only failed jobs' logs are read.

`check:spec-surface` enrolls only valid specs tagged `public-surface-checked`. Enrollment is explicit so adding prose cannot silently turn enforcement off: an enrolled spec must retain a bare backticked identifier list and a discoverable TypeScript barrel, or the check fails. Unenrolled prose surfaces remain descriptive and are reported only by `--list-skipped`.

The TypeScript compiler resolves the barrel's effective export names, including type-only and default exports and transitive re-exports; a CommonJS `export =` assignment is the module's singular `default` surface rather than the assigned value's synthetic members. An unresolved re-export is a violation rather than a silently incomplete surface. The declared and effective name sets must match in both directions. Filesystem-level tests exercise enrollment, resolution, and failure behavior through the same runner CI invokes.

`check:i18n` enforces [[architecture]] Decision 23 over `apps/web/src`, `packages/ui`, and extension `web/`
halves (tests and generated files excluded). With the TypeScript AST it rejects literal UI text in four
shapes: JSX text; text-bearing JSX attributes (`aria-label`, `title`, `placeholder`, `alt`, `label`,
`description`, `hint`, and `*Label`/`*Title`/`*Description`/… props), including literals reached through
conditionals, `||`/`??`, `+`, and template parts; literal children inside `{…}`; prose in text-named object
properties (`label`, `title`, `description`, `detail`, `hint`, `message`, `reason`, …); and literal
`toast.*()` messages or `errorText()` fallbacks. "Text" means a run of two or more letters after trimming
symbols, so `⌘K`, `·`, and counts pass; the bare brand `ThinkRail` is the one allowed word. It is a
heuristic floor, not a proof: review still owns strings returned from plain functions. It also checks
`packages/locales/en.json`: keys sorted, values non-empty, and every key (plural base for `_one`/`_other`)
referenced as a string literal by some UI, desktop, or locales source, so removed UI leaves no orphaned
translations. Finally it builds the web TypeScript program and fails on any **render-time read of the global
translator** ([[module-locales]] § Render reads the translator as a value): a reference to `t`, `i18n`,
`currentLocale` or `currentTranslator` from `@thinkrail/locales/react` evaluated in a render root — a
component or hook body, a class `render()`, and what they run synchronously: `useMemo`/`useState`
initializers, `useAppStore` selectors, `.map`-style callbacks, JSX function children and `render*` props;
a call (direct, through a namespace import, or passed by reference to such a callback) of any function that
reaches them synchronously, default parameters included, transitively; a module-load call; and any getter
or registered tool `summary` that reads them. Event handlers (`on*` and other non-render props), effects and
deferred callbacks are event-time and pass. Fixture tests pin each shape, both flagged and allowed. There is no suppression mechanism; a false positive is fixed in the checker with a test.
