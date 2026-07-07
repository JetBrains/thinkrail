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

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.3, Node.js ≥ 22.19 (required by the
in-process `pi` engine), and an authenticated `pi` provider for agent work.

```bash
git clone <repo-url>
cd thinkrail
bun install
bun run dev
```

`bun run dev` boots the host and the web client together and cleans up on `Ctrl+C`.
On-disk app state lives under `~/.thinkrail`.

## Testing and linting

Run the fast gates before opening a PR (they also run as the husky pre-commit hook):

```bash
bun run lint        # biome
bun run typecheck   # tsc across all packages
bun run test        # unit tests (bun test, per package)
```

Every change that touches the app is verified by the end-to-end suite, which builds
the web app, boots the host on an isolated state dir, and runs headless against the
real UI:

```bash
bunx playwright install chromium   # one-time
bun run e2e          # no-agent suite (fast, no auth)
bun run e2e:full     # everything, including @agent specs (needs pi authenticated)
bun run e2e:agent    # only the @agent specs
```

Agent-driven specs are tagged `@agent` and run against a real provider on an
**isolated** `pi` agent dir — never your real `~/.pi/agent`.

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
it. See [`CLAUDE.md`](CLAUDE.md) for the spec workflow.

## Submitting changes

1. [Fork the repository](https://docs.github.com/articles/fork-a-repo) and create a
   branch off `main`.
2. Make your change, keeping it focused. Match the surrounding code style and the
   conventions in `CLAUDE.md`.
3. Add or update tests and specs, and run the checks above.
4. Open a [pull request](https://docs.github.com/articles/creating-a-pull-request)
   against `main` with a clear description of *what* changed and *why*.

Write commit messages and PR descriptions that explain the reasoning behind the
change, not just the mechanics. A maintainer will review your PR and may suggest
adjustments before merging.
