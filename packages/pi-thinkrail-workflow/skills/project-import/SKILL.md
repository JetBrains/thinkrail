---
name: project-import
description: "The existing-codebase branch of project-setup: analyze a repo that has code but no specs and draft its first spec graph — goal-and-requirements.md, architecture.md, and short per-module SPEC.md files — deriving everything possible from the code and agent files (AGENTS.md, CLAUDE.md, README, manifests), and interviewing the user only for the intent the code can't reveal. Normally reached via the project-setup dispatcher."
---

# Project setup — import existing project

The workspace holds real code but no specs. **Reverse-engineer the spec graph the project should have
had.** Do as much as possible yourself, from the files; ask the user only where the code genuinely can't
tell you and the answer changes a spec.

**The bar is short, honest, on-rails specs.** Explain intent, not a file inventory. Each spec must be
small enough to read and high-signal enough that a future agent stays on rails. One `SPEC.md` per *genuine*
boundary — not per directory. Say each thing once; link by `id` instead of restating. Everything you draft
is `status: draft` — it's inferred and pending the user's review.

## 1. Read first, ask last

Survey before you ask a single question. Read, in roughly this order:

- **Agent files (mine these first — they state intent + conventions directly):** `AGENTS.md`, `CLAUDE.md`,
  `.cursor/rules/*`, `.cursorrules`, `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurfrules`.
- **Docs:** `README`, `docs/`, `CONTRIBUTING`, ADRs.
- **Manifests & layout:** `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`, workspace globs,
  `tree`-style structure, entry points, build/test scripts.
- **Code:** entry points and the top of each candidate module — enough to see responsibilities and the
  dependency edges between them.

Confirm with the spec tools (`spec_grep` / `spec_graph`) that there's no graph yet. If specs already
exist, stop and hand back to the `project-setup` dispatcher — this flow is for un-specced repos.

## 2. Build a working model

From what you read, write down (for yourself) what the project **is** and how it's **shaped**:

```
what:       one-sentence purpose (the job the codebase does)
domain:     the space it's in
stack:      languages / frameworks / runtime
modules:    the real boundaries + the dependency edges between them (who imports whom)
invariants: rules the code already enforces (layering, "X never imports Y", public surfaces)
decisions:  non-obvious choices visible in the code (and where the "why" is missing)
```

Agent files and READMEs usually hand you `what`, `invariants`, and `decisions` for free — prefer them over
re-deriving from code.

## 3. Interview only the gaps

Ask **only** what the files can't answer and that would change a spec — typically: the primary job / who
it's for, explicit non-goals, and the *why* behind a non-obvious decision. Batch via `ask_user_question`
(≤4 questions, recommended option first, each with a label + description). Infer a concrete answer and let
the user correct it rather than asking open-ended.

If the files answered everything material, **skip the interview** and say so — don't manufacture questions.
A skipped/declined question is not a blocker: record the assumption inline in the spec, marked unconfirmed.

## 4. Draft the graph, top-down

Save with the spec tools as you go (`spec_create` per node, `edit` for prose). Order:

1. **`goal-and-requirements.md`** (`type: goal-and-requirements`) — the goal + scope. This is the graph
   root; the confirmed intent lives here.
2. **`architecture.md`** (`type: architecture-design`, `parent: <goal id>`) — topology, the module
   boundaries, the real dependency edges (a small DAG only if it carries real information), and the
   invariants the code enforces.
3. **One short `SPEC.md` per genuine module** (`type: module-design`, or `submodule-design` for a
   directory-level module inside a package; `parent:` its enclosing module or `architecture`). Each states
   its **responsibility** and its **boundary** (allowed deps / forbidden reaches). The edges *between*
   sibling sub-modules belong in the **parent's** SPEC (a dependency graph), not restated in each leaf.

Wire `parent` to mirror the code hierarchy and `depends-on` only on edges the code actually shows. Keep
each file lean (see the bar above). If a boundary is genuinely unclear, ask, or leave that spec `draft`
with a one-line note — don't guess elaborately.

## 5. Validate & hand off

- Run `spec_validate`; fix dangling links, duplicate ids, parent cycles.
- Tell the user the specs are drafted on this workspace's branch — **review them in Changes; nothing merges
  until they approve** — and summarize what you inferred vs. what they confirmed.
- Point at `brainstorming` for feature work from here on.
