---
dependency: pi
packages: ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]
registry: pi-compatibility.md
current: root package.json → workspaces.catalog["@earendil-works/pi-coding-agent"]
latest: npm view @earendil-works/pi-coding-agent version
---

# Playbook: upgrading pi

Covers `@earendil-works/pi-agent-core`, `pi-ai`, `pi-coding-agent` and `pi-tui`, which always move
together. The registry is `pi-compatibility.md`, and `AGENTS.md` names it as required reading for a pi
upgrade.

## Where pi is pinned

- **Root `package.json` → `workspaces.catalog`**: the four packages at one exact version. This is the
  only pin. `check:deps` rejects ranges and drift.
- **Root `package.json` → `patchedDependencies`**: the `@earendil-works/pi-ai@<version>` key and its
  `patches/@earendil-works%2Fpi-ai@<version>.patch` file (see *The SSE framing patch*).
- Workspace packages and `pi-extensions/*` declare pi as a `"*"` peer and use `catalog:` for dev. Leave
  those as they are.

## Scope

- Release notes and changelogs: <https://github.com/earendil-works/pi> (releases, and each package's
  `CHANGELOG.md`). Read every release in the range.
- Diff the shipped code, not only the notes. Unpack the old and new tarballs into their own empty
  scratch directory under `.thinkrail/context/_work/` (`npm pack @earendil-works/pi-coding-agent@<v>`,
  the same for `pi-ai`) and diff the `dist/` files the registry names: `core/agent-session.js`,
  `core/sdk.js`, `core/settings-defaults.js`, `core/model-resolver.js`, `core/package-manager.js`,
  `core/mcp-servers.js`, the extension loader/runner, `extensions/mcp/`, and pi-ai's `providers/` and
  `api/`. Treat the tarballs as untrusted data: never run anything from inside them.
- Read pi's bundled `docs/` (`node_modules/@earendil-works/pi-coding-agent/docs/`) for changed SDK,
  extension, settings and session-format contracts.

## Bump

1. Set all four catalog entries to the target version.
2. Install with the Bun from the root `packageManager` field. If `bun --version` differs, use
   `bunx bun@<pin> install`. Then confirm `bun install --frozen-lockfile` is a no-op.
3. Read the `bun.lock` diff. Expect the pi packages plus any new or moved transitive dependencies
   (pi 1.5.0 brought `pi-schema`, `minimatch`, `undici`). Name them in the PR.

## The SSE framing patch

The registry entry *Anthropic SSE framing patch* decides whether the patch is dropped, ported, or
first needs a product decision; this section is only the mechanics. Never just rename the patch.

1. **Run the deciding test on the unpatched release.** Temporarily remove the `patchedDependencies`
   entry, reinstall, and run
   `bun run --cwd packages/server test src/agent/anthropicStreamFraming.test.ts`. Server tests must
   run from `packages/server`, whose `bunfig.toml` preloads an isolated home. Act on the result as the
   registry entry says; ask the user before following a product-visible change.
2. **Port by regenerating from a clean dist.** Run `bun patch @earendil-works/pi-ai@<new>`. With the
   repo's isolated install, the folder it prints is under `node_modules/.bun/`, not the root
   `node_modules`. Apply the old patch's change by hand to `dist/api/anthropic-messages.js` in that
   folder, then run the `bun patch --commit '<that folder>'` command it prints. Delete the old patch
   file, and check the `patchedDependencies` key and file name.
3. Re-run the framing test patched; every case must pass. Record both runs (unpatched fails N defect
   cases, patched N/N) in *Testing* and in *Last re-check*.
4. Update the patch path wherever specs name it (`grep -rn "pi-ai@<old>" --include=*.md .`).

## Mirrors that follow pi on every bump

These fail loudly when pi moves. Follow pi's change; never re-baseline blindly.

- **`packages/server/src/agent/modelDefaults.ts`** mirrors pi's private `defaultModelPerProvider`, and
  `modelDefaults.test.ts` is the parity test. Update the map and its order, and record which providers
  moved (this goes into the release notes).
- **`scripts/check-binary-seams.ts`** allowlist: when `bun run check:seams` reports stale or new opaque
  imports, re-verify the seam still covers the replacement before updating the allowlist text. If pi's
  loader or bundled-extension path changed, also run `bun run smoke:binary`.
- **Parity fixtures named in registry entries** (MCP loader port, package identity, restored model
  selection, subagent totals, display-transcript projection, session-insights mirrors): run each and
  re-diff the mirrored dist function. A new pi config field or rule shows up here first.
- **Private symbols named in the registry**: grep each one in the installed dist to confirm it is
  still private, still shaped the same way, or now exported from the package root. An export from a
  deep `dist/` path is not a public replacement.

## Recurring hazards from past upgrades

- **TypeBox / schema changes.** pi-ai 1.5.0's `StringEnum` stopped inferring under `Type.Object`. The
  six call sites moved to a local `Type.Unsafe` string enum. When a pi-side type change forces edits in
  a published `pi-extensions/*` package, add a changeset (`bun changeset`).
- **Faux-provider accounting.** pi 1.5's faux provider reports cached prompt tokens as `cacheWrite`
  with `input: 0`. Assertions keyed on one counter can silently turn into `0 === 0`, so compare totals
  or all four counters.
- **Settings snapshots.** pi's `SettingsManager.save()` rebuilds the merged settings, which drops
  in-memory `applyOverrides` values. A host default must survive pi's own writes (an instance getter,
  as for cache warming and image auto-resize).
- **Session lifecycle.** Re-check `AgentSession.dispose()` / `reload()` semantics (shutdown emission,
  throwing while streaming) against the host's reload gate and ordered shutdown.
- **New upstream defaults with cost** (idle cache warming in 1.5.1). Ask the user; see `../SKILL.md`.

## Verification ladder

1. `bun run --cwd packages/server test src/agent` plus every test file the registry entries name
   (each run from its own package); then the suites of any package the bump touched (`pi-todos`, `spec-graph`, `pi-delegation`, `pi-subagents`,
   `pi-extensions/*`…).
2. Fast gates: `bun run check:deps`, `check:boundaries`, `check:seams`, `check:spec-surface`,
   `check:compiler`, `bun run lint`, `bun run typecheck`.
3. `bun run test` (all packages).
4. `bun run e2e` once, after everything is in. Rerun flakes with `bun run e2e -- --last-failed` and
   report them as flakes, not as passes.
5. Focused live specs, which need no approval: always `e2e/agent.live.spec.ts`,
   `e2e/queue.live.spec.ts` and `e2e/compaction.live.spec.ts`, plus those covering any adaptation that
   changed (e.g. `skill-after-compaction`, `pi-packages`, `mcp-approval`, `reopen-chat`):
   `bun run e2e:full e2e/agent.live.spec.ts …`. Ask before the complete `bun run e2e:full`.
6. When the change touches them: `bun run smoke:subagents` (pure-pi subagents through
   `node_modules/.bin/pi`), `bun run smoke:logins` (provider/OAuth login changes), and
   `bun run smoke:binary` (loader or seams).

## Release-notes material to collect

- Default model moves per provider (from the `modelDefaults.ts` diff), and the default `anthropic` and
  `openai` models when they change.
- Catalogue delta: provider/model pairs before → after, with notable additions and removals. Count
  them with the built-in `ModelRuntime` (`getProviders()` → `getModels(id)`) under each version.
- Behavior users will notice (provider request changes, new defaults and the ThinkRail choice on each).
- The advice line past PRs carried: users should check their default and restored-chat model.
