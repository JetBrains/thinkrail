# Contributing to ThinkRail

Thanks for your interest in ThinkRail! Contributions of all kinds are welcome — bug
reports, fixes, features, docs, and feedback.

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE), and you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and requesting features

Open a [GitHub issue](https://github.com/JetBrains/bonsai/issues). Before filing,
search existing issues to avoid duplicates. For bug reports, include:

- What you did, what you expected, and what actually happened
- Your OS, Python, and Node versions
- Relevant logs or a minimal reproduction

## Finding something to work on

Issues labelled [`up for grabs`](https://github.com/JetBrains/bonsai/labels/up%20for%20grabs)
and [`good first issue`](https://github.com/JetBrains/bonsai/labels/good%20first%20issue)
are a good place to start. If you'd like to take one, leave a comment so others
know it's being worked on. For larger changes, open an issue to discuss the
approach before investing significant effort.

## Development setup

**Prerequisites:** Node.js (with npm), Python 3.11+, and [`uv`](https://docs.astral.sh/uv/)
(installed automatically by `run.sh` if missing).

```bash
git clone https://github.com/JetBrains/bonsai.git
cd thinkrail
./run.sh
```

`run.sh` installs dependencies, starts the backend (http://localhost:8000) and
frontend (http://localhost:3000), and cleans up on `Ctrl+C`. To run pieces
individually:

```bash
cd backend && uv run python -m app.main    # backend only
cd frontend && npm run dev                  # frontend only
```

## Testing and linting

Run the relevant checks before opening a PR:

```bash
cd backend && uv run pytest        # backend tests (pytest-asyncio, auto mode)
cd frontend && npm test            # frontend tests (vitest)
cd frontend && npm run lint        # tsc --noEmit + eslint
```

End-to-end Playwright tests live in [`e2e/`](e2e/README.md): start the app with
`./run.sh`, then `cd e2e && npm test`.

## Keeping generated types in sync

Frontend TypeScript types are **generated** from backend Pydantic models — never
hand-written. After changing backend models (`api/schemas.py`, `agent/models.py`)
or the curated RPC payload models (`rpc/schema_export.py`), regenerate:

```bash
cd frontend && npm run generate
```

Generated files carry a "DO NOT EDIT" header — never modify them directly.

## Specification-driven development

ThinkRail is developed spec-first: hierarchical specs live in `.tr/` alongside
the code. When you change behaviour, update the corresponding spec in the same PR.
See `CLAUDE.md` for the spec workflow and the available `/spec-*` skills.

## Submitting changes

1. [Fork the repository](https://docs.github.com/articles/fork-a-repo) and create a
   branch off `main`.
2. Make your change, keeping it focused. Match the surrounding code style
   (see the conventions in `CLAUDE.md`).
3. Add or update tests, and run the checks above.
4. Open a [pull request](https://docs.github.com/articles/creating-a-pull-request)
   against `main` with a clear description of *what* changed and *why*.

Write commit messages and PR descriptions that explain the reasoning behind the
change, not just the mechanics. A maintainer will review your PR and may suggest
adjustments before merging.
