---
id: submodule-ext-board-openspec
type: submodule-design
status: draft
title: Board OpenSpec reader
parent: module-ext-board
references: [task-openspec-board, module-extension-api]
---

## Responsibility

What the board knows about OpenSpec 2.x, pure and testable without the CLI: a workspace's `openspec/` tree
parsed into changes, the CLI's `--json` answers read and laid over that parse, the reader that picks
between them, and the minimal YAML the change metadata needs. It never decides where a card goes; the
board maps a change's stage onto its categories.

## Boundary

- **Public surface** (`index.ts`), what the board uses: `parseOpenspec`, `stageOf`, `SPEC_DRIVEN`,
  `OPENSPEC_ARGV`, `OPENSPEC_TIMEOUT_MS`, `OpenspecReader`, `PROBE_RETRY_MS`, `parseYaml`,
  `upsertTopLevelKey` and the types `OpenspecChange`, `OpenspecSnapshot`, `ArtifactStatus`, `DeltaCount`,
  `DeltaRequirement`, `DeltaScenario`, `Stage`, `Validation`. The files behind it — `parse.ts` (the tree), `cli.ts` (argv and
  the `--json` readers, `withCli`), `reader.ts` (the CLI or the parse, per workspace), `yaml.ts` — are this
  module's own; its tests import them directly.
  `fixtureTree.ts` is a test helper over `fixtures/`, never imported by the board's runtime.
- **Allowed:** `extension-api/server` types, `node:crypto` (the tree's signature). **Forbidden:** the
  board's model, store and other files; any file read (the tree arrives as the host's fact) or process
  (runs arrive as an injected runner).

## Decisions

- **The recorded CLI is the truth.** `fixtures/<case>/` holds `openspec/**` built by the real CLI with its
  `list --all --json --sort name`, `status --all --json`, `validate --all --strict --json` and `show <name>
  --json --deltas-only` answers; the conformance tests hold the parse to them. Re-recorded for a version by
  `scripts/record-openspec-fixtures.ts` (2.1.0 now), not in CI.
- **Counting follows OpenSpec, not the docs:** a task is OpenSpec's regex verbatim on every line, fenced and
  commented ones included (its `task-progress.ts` says so; a box on a line starting `<!--` is no list item),
  only `x`/`X` done; the tracked file is the artifact `apply.tracks` names, else `tasks`, else a top-level
  `tasks.md`. Deltas come from `specs/<capability>/spec.md` files only (fences masked, comments not, as
  `parseDeltaSpec` does); a change whose specs carry no delta section has none — `show`'s fallback to the
  proposal's prose is not read. An added or modified requirement carries its statement (before its first
  `#### Scenario:`) and its scenarios' names and lines, as `show --json` reports `text` and `rawText` — held to
  the recorded answers — for the board's smart review.
- **Schemas:** the change's `.openspec.yaml`, else `config.yaml`, else `spec-driven`; a project schema
  (`openspec/schemas/<name>/schema.yaml`, which may override `spec-driven`) is parsed, a user-folder one is
  not visible and reads as unknown — the change keeps its tasks (from `tasks.md`, as `list` does) and shows
  its reason instead of a guessed chain, as `status` does.
- **Known divergences from the CLI:** a change folder holding no markdown or YAML is invisible (the tree
  carries text files only); `list` also lists dot-folders, which are skipped here as `status` skips them;
  symlinks are never followed; an output glob matching only non-text files never completes its artifact.
  `REMOVED` without a Reason is not a validation error in 2.1.0 (recorded).
- **The YAML is a subset** (block and flow collections, quoted and plain scalars, block scalars, comments);
  anything else is a `YamlError`, read as unreadable metadata. The monorepo has no YAML library in its
  catalog, and the one write — `x-thinkrail` — is a line-preserving top-level upsert.
- **The reader never waits on the CLI:** the parse answers at once; with a probed version, one CLI reading
  per workspace runs behind it, keyed by a SHA-1 of the tree, and its landing calls `onChange`.
