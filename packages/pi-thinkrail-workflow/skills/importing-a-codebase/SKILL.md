---
name: importing-a-codebase
description: "Use when the repo holds real source code but no specs: the existing-codebase branch of setting-up-a-project, normally reached via that dispatcher, directly only when the situation is unmistakable. Not for empty workspaces (starting-a-new-project) or feature work in a specced project (brainstorming)."
---

# Importing a codebase

The workspace holds real code but no specs. **Reverse-engineer the spec graph the project should have
had.** When the repo already carries real spec-like documents, build the graph around them, not
parallel to them. Do as much as possible yourself, from the files; ask the user only where the code genuinely can't
tell you and the answer changes a spec.

**Hold the writing-specs bar.** Read that concept skill before drafting — everything in this flow is
inferred rather than confirmed, so its honesty rules (draft until the user reviews, unconfirmed marked
inline) bind hardest here.

## 1. Read first, ask last

Survey before you ask a single question. Read, in roughly this order:

- **Agent files (mine these first — they state intent + conventions directly):** `AGENTS.md`, `CLAUDE.md`,
  `.cursor/rules/*`, `.cursorrules`, `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurfrules`.
- **Docs:** `README`, `docs/`, `CONTRIBUTING`, ADRs.
- **Manifests & layout:** `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`, workspace globs,
  `tree`-style structure, entry points, build/test scripts.
- **Code:** entry points and the top of each candidate module — enough to see responsibilities and the
  dependency edges between them.

While you read, collect **adoption candidates**: durable, declarative documents that state the world
as it is — architecture/design docs, ADRs / decision records, domain glossaries, protocol/contract
docs. Never candidates (input only): READMEs, CONTRIBUTING, changelogs, roadmaps, TODOs,
implementation plans (finished or planned), generated API docs.

Confirm with the spec tools (`spec_grep` / `spec_graph`) that there's no graph yet. If specs already
exist, stop and hand back to the `setting-up-a-project` dispatcher — this flow is for un-specced repos.

## 2. Build a working model

From what you read, form a working model of what the project **is** and how it's **shaped** — held in
the conversation, not written to a file (this flow declares no working files):

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
it's for, explicit non-goals, and the *why* behind a non-obvious decision. Batch them per the
**asking-user-questions** concept skill; infer a concrete answer and let the user correct it rather
than asking open-ended.

If adoption candidates exist, add one question to the same round: a multiSelect listing them (grouped
when many — an `adr/` set is one option) — which should become spec-graph nodes? A contradiction
between a candidate and the code found by now goes into the round too (confirm the correction).
Skipped or declined → adopt none; candidates stay input, noted at hand-off.

If the files answered everything material, **skip the interview** and say so — don't manufacture questions
(adoption candidates alone still make a round — the offer is never dropped as "no gaps").
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
   its **responsibility** and its **boundary** (allowed deps / forbidden reaches).

**Adopted docs become nodes in place.** First, for each accepted candidate: read it carefully, then
add spec frontmatter where the file lies (`id`, `type`, `title`, `status: draft`, `parent`;
`depends-on`/`references` only where real) — content untouched. A slot an adopted doc fills is not
drafted again: an adopted architecture doc *is* the `architecture-design` node, an adopted module
design doc *is* that module's node, an ADR earns a node only while its decision is still in force.
Build the rest of the graph around them, linked by id. One exception to "content untouched": where an
adopted doc is unclear or has drifted from the code, correct that content as part of adoption and
call the correction out (in the interview round when caught in time, at hand-off otherwise).

Wire `parent` to mirror the code hierarchy and `depends-on` only on edges the code actually shows. Keep
each file **you draft** to the **writing-specs** bar — its granularity and say-it-once rules decide what counts as a
module and where shared edges live. If a boundary is genuinely unclear, ask, or leave that spec `draft`
with a one-line note — don't guess elaborately.

## 5. Validate & hand off

- Run `spec_validate`; fix dangling links, duplicate ids, parent cycles.
- Tell the user the specs are drafted on this workspace's branch — **review them in Changes; nothing merges
  until they approve** — and summarize what you inferred vs. what they confirmed, which docs were
  adopted vs. left as input, and any drift corrections made.
- Point at `brainstorming` for feature work from here on — **this workflow ends here**.
