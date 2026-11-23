---
id: module-pi-extensions
type: module-design
status: draft
title: Portable pi packages (pi-extensions/)
parent: architecture
tags: [pi-extension, publishing]
references: [module-extension-sdk]
---

## Responsibility

The workspace root for pi packages ThinkRail **publishes to npm** and that must work in **vanilla `pi`**
with no ThinkRail present. Each package here is a capability (tools, skills) the agent can use anywhere;
ThinkRail is one embedder among others. The ThinkRail-specific halves of a capability live in
[[module-thinkrail-extensions]], never here.

Until a package's wiring PR lands, its predecessor under `packages/pi-*` stays untouched and loaded by the
host — two copies coexist on purpose and the wiring PR deletes the old one. A new package starts at
`version: 0.0.0` and gets its first real version from its first changeset.

## Identity and distribution

- npm name `@thinkrail/pi-<name>` (the npm org is `thinkrail`; org name = scope), directory
  `pi-extensions/<name>/`. Private workspace packages share the scope but stay `private: true`; owning
  the org keeps their names from being claimed on npm. Packages first shipped under the interim
  `thinkrail.ai` org (only `@thinkrail.ai/pi-visualize@0.1.0`) are deprecated there and point here. The
  scope is deliberate: unscoped `pi-*` names collide (`pi-subagents` is
  third-party) and the scope attributes ownership in the
  `pi.dev/packages` gallery, which is an index of npm packages carrying the `pi-package` keyword — there
  is no registry to submit to. The gallery enumerates npm's `keywords:pi-package` search, which pages only
  to offset 5000, so a valid package can be missing from its listing while its direct
  `pi.dev/packages/<name>` page works (earendil-works/pi#7885); link the direct page.
- **Two shapes.** An *installable pi extension* carries a `pi` manifest (`extensions: ["./index.ts"]`,
  `skills` where present, and a `video` gallery preview) and the `pi-package` keyword. A *portable
  library* (e.g. delegation) has named exports only — no manifest, no keyword, never a no-op factory —
  and is verified through its packed consumer. A library may carry a runtime-import-free `./core`
  contract (types and constants) beside its engine root, so a browser half can type-import its shapes
  without pulling `node:` modules into its type graph. A library that also ships a real factory is both:
  its root stays the engine its consumers import, and the manifest names a separate entry
  (session-insights: `extensions: ["./extension.ts"]`, also exported as `./extension`).
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
  resolver/loader with zero diagnostics, and registers its tools, commands and skills. (A local-path `pi install`
  installs nothing — it only records the path — so the gate never uses it.)
- **Dual runtime.** Vanilla pi is an npm CLI under Node ≥ 22.19 with jiti; ThinkRail runs the same code
  under Bun. Shipped code uses `node:` builtins and standard ESM only — no `Bun.*`, `bun:*`, or
  Bun-specific `import.meta`.
- TUI: `renderCall` and `renderResult` wherever the plain text fallback reads poorly; every UI call behind
  `ctx.hasUI`. A **manual check in a real terminal** (Ghostty/iTerm2, and inside tmux) is part of the bar.
- No ThinkRail assumptions: no `~/.thinkrail` paths, no host wire, no `@thinkrail/*` imports other than
  sibling portable packages.
- Gate: `bun run check:pi-packages` (`scripts/check-pi-packages.ts`, CI job `pi-packages`, provider-free).
  Packs the package and every pending portable workspace dependency, greps the tarball for Bun-only APIs,
  installs the tarballs plus pi at the catalog version into a temp agent dir **outside the repository**
  with pi's own npm policy (`--legacy-peer-deps`), configures `packages: ["npm:@thinkrail/pi-<name>"]`,
  then copies `scripts/pi-package-parity.node.mjs` **into the fixture** and runs it under Node so pi
  resolves from the fixture (Node ignores `import.meta.resolve`'s parent URL — resolving from the script's
  own location silently tested the repo's pi). The runner loads through `DefaultResourceLoader.reload()`,
  asserts zero errors and the expected tools/skills, and executes a per-package case table (tool calls,
  expected text/error, a `renderResult(...).render(width)` check, and an expected `terminate` flag). A
  case may script the UI the tool sees: `ui.mode` (`tui` or `rpc`), `ui.replies` answering `select`
  (a number picks that choice) and `input` in order with `null` dismissing, and `ui.keys` as raw terminal
  input fed to the component a `ui.custom` factory returns; cases without `ui` get an empty context. A
  case's `branch` (session entries) is served as `ctx.sessionManager.getBranch()`.
  Slash commands get their own table (`commands`, `commandCases`): the runner calls the registered
  handler with a scripted context in `tui`, `rpc` or `print` mode, collects its notifications (print
  mode has no UI, so stderr is captured instead), asserts their level and text, that no status is left
  behind, and the files the run must leave under the agent dir; `seed(cwd)` writes files (e.g. session
  JSONL for the fixture project) into the agent dir before pi loads. *Session-bound* tools (registered
  in `session_start`, e.g. subagents, background-commands) will need a mode that binds an isolated
  `AgentSession` on pi's faux provider — added with the first wave that ships one. Token-backed smokes
  stay on-demand.

## Release

`@changesets/cli` (catalog-pinned; `privatePackages: { version: false, tag: false }` so only this root is
ever versioned or tagged). A PR that changes a published package adds a changeset (`bun changeset`).
**Versioning is a human step**: a maintainer runs `bun run release:version` (`changeset version` +
`bun install`) on a branch and opens an ordinary PR — JetBrains' org policy forbids Actions from creating
PRs, and an ordinary PR also gets normal CI, which a bot-opened one would not. When that PR is on `main`,
`.github/workflows/release-pi-packages.yml` runs in the `npm-release` environment with `id-token: write`:
re-runs the parity gate, then `bun run release:publish` (`scripts/publish-pi-packages.ts`), which exits
early while any changeset is still pending (versions not bumped yet) and otherwise publishes
**dependencies before dependents**, each package whose version is not yet on npm: `bun pm pack`
(rewrites `workspace:*`/`catalog:` to exact versions, satisfying Decision 10) → `npm publish <tgz>
--provenance --access public` under npm Trusted Publishing (Bun has no OIDC auth; npm ≥ 11.5.1) →
`changeset tag` + push only when the script reports `readyToTag=true`: no pending changesets, not a dry
run, and every current public version is on npm (published now or earlier, e.g. by the manual
bootstrap). An early exit therefore never tags the placeholder `0.0.0`, and `changeset tag`'s skip of
existing tags makes a retry after a failed tag push safe.

Trusted Publishing is configured per *existing* package, so each new package gets one manual bootstrap
publish first: `bun run release:pack <dir>` packs it and prints the `npm publish … --provenance=false`
command for an npm-org owner (the manifest's `publishConfig.provenance` would otherwise make a local
publish fail; only CI can attest). The trusted-publisher configuration itself (`npm trust github …`) must
allow `npm publish` (npm's post-2026-09 default is stage-only) and is validated only by a first OIDC
publish within 48 hours of its creation — the manual bootstrap does not count — so it is created right
before the package's next version PR merges, not at bootstrap. Operational detail: `pi-extensions/README.md`.

The same flow, changesets and bootstrap rule also publish the ThinkRail extension SDK,
`@thinkrail/extension-sdk`, and every public `extension-examples/*` sample: `scripts/pi-packages.ts` lists
them after the pi packages, and the workflow also runs `check:extension-packages` and builds the SDK
before publishing. Both stay `private` until their first release changeset, so no version PR publishes
them at `0.0.0` ([[module-extension-sdk]] § Release and verification). The vanilla-parity bar does not apply to them (a sample is a ThinkRail extension, not
a pi package); their gate is [[module-extension-sdk]] § Release and verification.

Order: visualize → ask-user-question → next-steps → session-insights → delegation + subagents →
background-commands → spec-graph → todos. session-insights ships the vanilla-pi `/insights` command, so
it left `private` (which also puts it under the parity gate). Its `0.1.0` was bootstrapped by hand before
its gallery clip existed, and a published manifest cannot be amended, so the clip and `pi.video` arrived
in `0.2.0`, the first version the release workflow publishes for it. Its clip is recorded from the
package's synthetic test corpus (`writeInsightsCorpus`) in an isolated agent dir, never from real
sessions. Not published: `pi-thinkrail-workflow` (workspace-internal), `pi-dag` (until
it has a consumer).

## Boundary

- **Allowed deps:** pi SDK peers, sibling `pi-extensions/*`, ordinary npm runtime deps declared exactly.
- **Forbidden:** `@thinkrail/*` host packages, `packages/server`, `apps/*`, `thinkrail-extensions/*`.
- Dependency edges between siblings (e.g. subagents → delegation) are listed here when they exist:
  `subagents → delegation`, `dag → delegation`.

## Members

| package | shape | notes |
| --- | --- | --- |
| `visualize` | extension | `visualize` tool; `lovely-mermaid` for TUI box-drawing and the best-effort vanilla validation; exports `createVisualizeExtension({ validateMermaid })` so an embedder can inject a strict validator — ThinkRail does, from [[module-ext-visualize]]. Detail: [[module-pi-visualize]]. |
| `ask-user-question` | extension | `ask_user_question` tool: a terminal questionnaire in pi's interactive mode, one dialog per question in RPC hosts; exports `createAskUserQuestionExtension({ ask, guidance, filePreviews, checkFile })` so an embedder can answer through its own UI and opt into file previews with its own path check (off in vanilla pi), and a runtime-import-free `./core`. ThinkRail composes it from [[module-ext-ask-user-question]] with an asker over its answer mailbox and the host's workspace-file check. Detail: [[module-pi-ask-user-question]]. |
| `next-steps` | extension | `suggest_next_steps` tool: one-click next messages at the end of a finished turn, shown in a row above pi's editor and sent with Alt+1…9 (interactive terminal only); the agent calls it, then writes its final message last (the call ends the turn only when its message already holds an answer as text); exports `createNextStepsExtension({ guidance })` so an embedder can add its own wording; a runtime-import-free `./core` carries the branch rule hosts share. ThinkRail composes it from [[module-ext-next-steps]] with one extra guideline and draws chips instead. Detail: [[module-pi-next-steps]]. |
| `session-insights` | library + extension | Deterministic, LLM-free analysis of pi session files (discovery, index, per-session analyses, statistics, exports) behind injected locators, plus a runtime-import-free `./core` result contract the ThinkRail web half type-imports, and an `./extension.ts` manifest entry: the `/insights` command for vanilla pi over pi's default locations (`createSessionInsightsExtension({ agentDir, locations, command })`). ThinkRail composes the library from [[module-ext-session-insights]] and never loads the command (`supersedesPackages`). Publish-ready, not published (§ Release). Detail: [[module-pi-session-insights]]. |
