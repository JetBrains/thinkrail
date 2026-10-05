# Publishing pi packages

How-to for the packages under `pi-extensions/*`, published to npm as `@thinkrail.ai/pi-<name>` and usable
in vanilla `pi` without ThinkRail. Decisions and rationale live in [SPEC.md](SPEC.md); this file is the
checklist.

## Add a new package

1. Create `pi-extensions/<name>/` **beside** its predecessor (if one exists under `packages/`); never
   modify or delete the old package in the same PR — the wiring PR does that later.
2. `package.json`: copy `visualize/package.json` and adjust. Non-negotiables:
   - `name: "@thinkrail.ai/pi-<name>"`, `version: "0.0.0"` (the first changeset produces the first
     real version), `private` absent, `license: "Apache-2.0"`, `repository.directory`,
     `publishConfig: { access: "public", provenance: true }`.
   - `keywords` include `"pi-package"` and a `pi` manifest (`extensions`, `skills` …) **only** for an
     installable extension. A portable library (no factory) gets neither.
   - `files`: everything the entrypoints and `exports` transitively import, tests excluded. The parity
     gate installs from the tarball, so an omission fails there.
   - Pi SDK packages (`@earendil-works/pi-ai`, `pi-coding-agent`, `pi-tui`, `pi-agent-core`, `typebox`) are
     `peerDependencies: "*"` and `devDependencies: "catalog:"`. Other runtime deps: exact pins.
3. Copy `LICENSE` from the repo root. Write a `README.md` whose first lines are
   `pi install npm:@thinkrail.ai/pi-<name>` and what the package adds.
4. Create `SPEC.md` (`parent: module-pi-extensions`) and add the package to the members table in
   [SPEC.md](SPEC.md).
5. Register the package in `scripts/check-module-boundaries.ts` (`{ root: "pi-extensions/<name>", allowed: [] }`
   or the sibling it depends on) and in the fixture of `scripts/checkModuleBoundaries.test.ts`.
6. Add its expectations to `EXPECTATIONS` in `scripts/check-pi-packages.ts`: tool names, skill names, and
   a few executable cases (valid call, rejected call, one TUI render). Tools that register inside
   `session_start` need the session-bound mode — add it with the first such package.
7. Run `bun install`, then the bar below.

## The vanilla-parity bar (before the first publish)

- `bun run check:pi-packages` is green — it packs, installs into an isolated pi fixture **outside the
  repo**, and loads under **Node** (vanilla pi's runtime), so Bun-only APIs and missing `files` fail here.
- Shipped code is dual-runtime: `node:` builtins and standard ESM only; no `Bun.*`, `bun:*`,
  `import.meta.dir`.
- Every tool whose plain text result reads poorly has `renderCall`/`renderResult`; every UI call is behind
  `ctx.hasUI`.
- Manual check in a real terminal, including inside `tmux`:
  ```bash
  node_modules/.bin/pi -e pi-extensions/<name>/index.ts
  ```
- No `~/.thinkrail` paths, no host wire, no `@thinkrail/*` imports except sibling `pi-extensions/*`.

## Release a version

1. **In the PR that changes a published package**, add a changeset:
   ```bash
   bun changeset            # pick the package(s), bump type, one-paragraph summary
   ```
   Commit the generated `.changeset/<name>.md` with the change. Dependents (`subagents` → `delegation`)
   are bumped automatically when their dependency releases.
2. **To cut the release**, a maintainer on a fresh branch runs
   ```bash
   GITHUB_TOKEN="$(gh auth token)" bun run release:version  # changeset version + bun install (lockfile)
   ```
   (the GitHub changelog generator needs a token to look up PR/author links; it does not read `gh`'s
   credentials by itself)
   and opens an ordinary PR `chore(release): version pi packages`. It carries the version bumps and
   `CHANGELOG.md` entries and consumes the changeset files. Normal CI runs on it.
3. **On merge to `main`**, `.github/workflows/release-pi-packages.yml` re-runs the parity gate, publishes
   every package whose version is not on npm yet (dependencies first), and pushes `name@version` tags
   once every current version is on npm — including versions that were published manually (bootstrap)
   and tags missed by an earlier failed push. The job runs in the `npm-release` GitHub environment with
   OIDC — there are no npm tokens anywhere. While any changeset is still pending the job exits early
   with "nothing to publish" and tags nothing.

`bun run release:publish -- --dry-run` shows locally what the workflow would publish.

## First publish of a new package (one-time bootstrap)

npm Trusted Publishing can only be configured on a package that already exists, so the very first
version is published by a human who owns the `thinkrail.ai` npm org:

```bash
bun run release:pack <dir>                      # e.g. visualize → dist/pi-packages/<name>-<version>.tgz
npm login                                       # org owner, 2FA
npm publish dist/pi-packages/<tarball> --access public --provenance=false
```

`--provenance=false` is required for this one manual publish: the manifest's `publishConfig` asks for
provenance, which only a CI provider can generate. The automated release keeps provenance.

Then, on npmjs.com → the package → **Settings → Trusted Publisher → GitHub Actions**:

| field | value |
| --- | --- |
| Organization / user | `JetBrains` |
| Repository | `thinkrail` |
| Workflow filename | `release-pi-packages.yml` |
| Environment | `npm-release` |

After the first successful OIDC publish, set the package's publishing access to *Require two-factor
authentication and disallow tokens*.

## Troubleshooting

- **`check:pi-packages` fails with a module not found inside the fixture** — a runtime import is not in
  `dependencies`, or a file is missing from `files`.
- **"uses a Bun-only API"** — move the call into a `*.test.ts` or replace it with a `node:` equivalent.
- **Publish job skipped everything** — the versions on `main` are already on npm (nothing to do) or
  changesets are still pending (cut the version PR first).
- **Publish fails with `ENEEDAUTH`/403** — Trusted Publisher is not configured for that package yet (see
  bootstrap) or the workflow/environment names do not match the npm configuration exactly.
