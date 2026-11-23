---
dependency: electrobun
packages: ["electrobun", "hutch"]
registry: electrobun-compatibility.md
current: apps/desktop/package.json → devDependencies.electrobun (Hutch is paired, not pinned)
latest: npm view electrobun version
---

# Playbook: upgrading Electrobun

Covers the `electrobun` npm bootstrap and the Hutch toolchain and SDK it pairs with. The registry is
`electrobun-compatibility.md`; `apps/desktop/SPEC.md` (*Build and release*) owns the pin rationale.

## Where Electrobun is pinned

- **`apps/desktop/package.json`**: `electrobun` as an exact, build-only dependency. This is the only
  pin. It selects the paired Hutch release, and no global Hutch or floating override is allowed.
- **Paired Hutch version**: `PAIRED_HUTCH_VERSION` in
  `apps/desktop/node_modules/electrobun/bin/resolve-hutch.cjs` after install. Record it; specs name the
  pair ("Electrobun 2.0.5 / Hutch 0.28.2").
- **Packaged Bun**: `build.bun.version` in `apps/desktop/electrobun.config.ts` stays equal to the root
  `packageManager` Bun, and `buildConfig.test.ts` asserts that. A framework bump never moves it. If the
  new Electrobun's default Bun differs from the pin, say so in the PR: Electrobun's own suite ran on its
  default, so desktop smoke and e2e are the gate for our runtime.
- **`buildConfig.test.ts`** also asserts the Electrobun pin, so update it with the bump.

## Scope

- Changelogs and source: <https://github.com/blackboardsh/electrobun> and
  <https://github.com/blackboardsh/hutch>, every release in the range. Gates about native behavior
  need the source at the release tag (Electrobun `package/src/core/*.zig`, Hutch `src/electrobun.zig`),
  so link it as a permalink at the tag's commit. The `librarian` skill helps here.
- **Platforms.** The release's `electrobun-artifacts.json` must publish a core for every shipped
  target (`macos-arm64`, `macos-x64`, `linux-x64`, `linux-arm64`, `windows-x64`), and the paired Hutch
  must know each one. A missing core silently drops a target; 2.0.1 had no `macos-x64`, which is why
  2.0.5 is the floor.
- Check the registry's upstream issue/PR links for status, but verify each gate in code.

## Bump

1. Change the pin in `apps/desktop/package.json`, then install with the pinned Bun. The lockfile delta
   should be the workspace pin and the package entry only (2.0.1 → 2.0.5 was two lines).
2. Fetch the toolchain: `bun run --cwd apps/desktop electrobun prepare`, or
   `.github/scripts/prepare-electrobun.sh`, which retries. The installed SDK lands in
   `~/.hutch/releases/electrobun/<version>/<platform>/`, and registry paths such as
   `api/sdks/main/proc/native.ts` are relative to it.
3. Update `buildConfig.test.ts` and run it (`bun run --cwd apps/desktop test src/buildConfig.test.ts`).

## Re-check

- **Every registry section**: window and shell, Windows identity, lifecycle and updates, build and
  typing, CI and release. Use the installed SDK for TypeScript-side gates and the tagged source for
  native and Hutch gates. Some gates are platform-only; when you cannot run that platform, record what
  the source shows and name the CI job or manual check that would confirm it.
- **Build and typing gates** are cheap to test directly: re-enable `noImplicitReturns` /
  `exactOptionalPropertyTypes` in `apps/desktop/tsconfig.json`, or drop the untyped `build.bun`
  workaround, and run the desktop typecheck (`bun run --cwd apps/desktop typecheck`).
- **Accepted gaps** (*Not temporary workarounds*): drop any gap the release closes; never remove a
  deliberate choice silently.
- **`apps/desktop/SPEC.md` behavior notes** name versions ("Electrobun 2.0.5 shows the window…").
  Re-check each against the new release and relabel or correct it, as #894 did for 2.0.1 → 2.0.5.
  Then `grep -rn "<old electrobun>\|<old hutch>" --include=*.md .` covers `architecture.md`,
  `.github/SPEC.md`, `apps/desktop/src/updates/SPEC.md` and the web notifications spec.

## Release plumbing when targets change

A newly published (or dropped) target touches more than the pin. Follow #894:
`.github/actions/build-binary/action.yml` (collector aliases, update manifest, archive names),
`apps/desktop/src/updates/enablement.ts` (updater allow-list), `packages/artifact-tests`
(`releaseArtifacts.test.ts`, `installerScripts.test.ts`), `install.sh`, the `.github/SPEC.md` asset
table and runners, and the README platform table. The macOS signing matrix lives in the private
`thinkrail-signing` pipeline; call out the follow-up in the PR instead of claiming it is done.

## Verification ladder

1. `bun run --cwd apps/desktop test` and `bun run --cwd apps/desktop typecheck`.
2. `bun run --cwd packages/artifact-tests test` (release-artifact and installer-script contracts).
3. Fast gates: `bun run lint`, `bun run typecheck`, `bun run check:spec-surface`, `bun run check:deps`.
4. `bun run desktop:build`, then `bun run smoke:desktop` (packaged window and runtime). Run
   `bun run e2e:desktop` (the no-agent suite against the host inside the packaged app) once at the
   end. Add `bun run smoke:desktop:installer` when the installer, updater or lifecycle changed.
5. The browser `bun run e2e` does not load the desktop preload; run it only if host or web code
   changed.
6. **Other platforms**: CI's Windows and Linux desktop smoke jobs gate them. List each platform-only
   check the touched registry entries name (Linux focus and paste, the Windows frame, icon and taskbar,
   the Linux tarball ownership via `tar --numeric-owner -tvzf`) under **Not verified** with its owner.
7. **Updates**: a framework bump changes the updater. Canary qualification (`.github/SPEC.md`, *Desktop
   updater qualification*) needs an observed installed-version A → B upgrade per target before stable.
   Say whether that is still pending.
