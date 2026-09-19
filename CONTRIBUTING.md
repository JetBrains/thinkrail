# Contributing to ThinkRail

Thanks for your interest in ThinkRail! Contributions of all kinds are welcome — bug
reports, fixes, features, docs, and feedback.

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE), and you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and requesting features

Open a GitHub issue. Before filing, search existing issues to avoid duplicates. For
bug reports, include:

- What you did, what you expected, and what actually happened
- Your OS, Bun, and Node versions
- Relevant logs or a minimal reproduction

## Development setup

**Prerequisites:** [Bun](https://bun.sh) 1.4.0 (the repository's pinned package
manager and runtime), Node.js ≥ 22.19 (required by the in-process `pi` engine), and
an authenticated `pi` provider for agent work.

```bash
git clone <repo-url>
cd thinkrail
bun install
bun run dev
```

`bun run dev` boots the host and the web client together and cleans up on `Ctrl+C`.
On-disk app state (projects, workspaces, worktrees) lives under `~/.thinkrail`.

To run the V1 launchers:

```bash
bun run --filter @thinkrail/cli dev  # browser launcher
bun run build:binary                 # standalone CLI artifact
bun run desktop:dev                  # package and open the Electrobun app
bun run desktop:build                # package without opening it
```

Desktop commands use the standard Electrobun CLI/configuration. Its pre-build hook
builds the shared UI and stages ThinkRail's PI/native resources; Electrobun owns
preload bundling and installer creation. Create host-native installers with
`bun run desktop:package:stable` or `bun run desktop:package:canary`.
Native/installer smoke and shared CLI/desktop probes live in
`packages/artifact-tests`, outside the application packages. Run
`bun run smoke:desktop` after a dev build; installer smoke takes an artifact path and
channel via `bun run smoke:desktop:installer <path> <stable|canary>`.

## Artifact signing

JetBrains signs the Windows CLI and desktop setup executable. The macOS CLI is signed
but not yet notarized; Linux artifacts are unsigned. Signed and notarized desktop
DMGs require the coordinated JetBrains service pipeline, which consumes Electrobun's
expanded app archive for signing and SRE DMG finalization — that intermediate archive
is not a public download, and the macOS signing limitation stands until the pipeline
update is deployed. Local installer smoke is not notarization verification.
Electrobun 2.0.1 provides no macOS Intel desktop build.

## Architecture (three rings)

- **Engine host** — `packages/server` (+ `packages/shared`), launched by `apps/cli` or
  `apps/desktop`. `createServer()` is a `Bun.serve` HTTP+WS host with an
  `AgentSessionManager` (one in-process `pi` `AgentSession` per tab).
- **The wire** — `packages/contracts`: the typed, versioned protocol (types-only).
- **UI client** — `apps/web`: mobile-first React 19 + Zustand + Tailwind v4, ships
  independently and dials a host over the wire.

The engine is **`pi` only, run in-process** via `@earendil-works/pi-coding-agent`.
`apps/web` depends on `packages/contracts` only — never on the server — which is what
makes the UI shippable on its own.

```
apps/
  cli/        V1 entrypoint: boot host + open browser
  web/        mobile-first UI client
  desktop/    Electrobun local-host launcher + native packaging
  website/    public landing + blog + vibecoding site (Cloudflare Pages)
packages/
  artifact-tests/ source-only CLI/desktop artifact and installer tests
  server/     createServer(): Bun.serve + AgentSessionManager
  contracts/  the wire (types-only)
  shared/     server-side helpers (shellEnv, freePort)
  spec-graph/ portable pi extension: spec_* tools + skill
```

## Testing and linting

Run the fast gates before opening a PR (they also run as the husky pre-commit hook):

```bash
bun run lint        # biome
bun run typecheck   # tsc across all packages
bun run test        # unit tests (root tooling + each package)
```

Every change that touches the app is verified by the end-to-end suite against the
real UI. The no-agent gate builds once and automatically uses isolated parallel
shards (half the available CPUs, capped at eight):

```bash
bunx playwright install chromium                    # one-time
bun run e2e                                         # complete no-agent gate
bun run e2e -- e2e/changes.spec.ts                  # focused iteration
bun run e2e -- --last-failed                        # repair loop
bun run e2e:serial                                  # one-host debugging fallback
bun run e2e -- --shards=12                          # explicit 1–16 override
bun run e2e:full                                    # everything; needs pi auth
bun run e2e:agent                                   # only @agent; remains serial
```

Use focused or last-failed runs while iterating, then run the complete `bun run e2e`
once before handoff. On macOS, every public browser E2E command prevents idle system sleep for the
runner's lifetime while allowing the display to sleep normally. Agent-driven specs are tagged `@agent`
and run against a real provider on an **isolated** `pi` agent dir — never your real `~/.pi/agent`.

## Module boundaries

ThinkRail is built as a set of clearly bounded, fractal modules: each package is a
module, and directories inside a package are modules too. A sub-module exposes its
public surface through an `index.ts` barrel; siblings import through that barrel,
never its internals. Every module has a `SPEC.md` that states what it owns, what it
exposes, and what it must not reach into. Keep changes within these boundaries, and
cover a module's public surface with tests where practical.

## Specification-driven development

ThinkRail is developed spec-first: hierarchical, interconnected specs live in the
repo alongside the code — top-level specs at the root
([`goal-and-requirements.md`](goal-and-requirements.md),
[`architecture.md`](architecture.md)) and a co-located `SPEC.md` for every module.
**The spec leads the code:** a change that moves or blurs a boundary, contract, or
decision updates the relevant `SPEC.md` first, then the code and the tests that pin
it. See [`AGENTS.md`](AGENTS.md) for the spec workflow.

## Submitting changes

1. [Fork the repository](https://docs.github.com/articles/fork-a-repo) and create a
   branch off `main`.
2. Make your change, keeping it focused. Match the surrounding code style and the
   conventions in `AGENTS.md`.
3. Add or update tests and specs, and run the checks above.
4. Open a [pull request](https://docs.github.com/articles/creating-a-pull-request)
   against `main` with a clear description of *what* changed and *why*.

Write commit messages and PR descriptions that explain the reasoning behind the
change, not just the mechanics. A maintainer will review your PR and may suggest
adjustments before merging.
