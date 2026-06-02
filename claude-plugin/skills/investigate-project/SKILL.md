---
name: investigate-project
description: Read an existing codebase and produce a technical DESIGN_DOC.md plus a draft GOAL&REQUIREMENTS.md from what the code reveals. Use for the existing-project onboarding flow when the user has code but no specs yet.
icon: "🔎"
group: Foundation
argument-hint: "[project-name]"
---

# Investigate Project (existing-project onboarding)

You are reading an **existing codebase** and turning it into a technical
specification. Code is the source of truth — your job is to read it, not
to interview the user about a project they already built. The session
runs as the **Investigation** step of the existing-project onboarding
chain (see `frontend/src/components/Wizard/registry.ts`). Two more steps
follow on the done-screen (Clarify and Verify & save) — your finalize
contract hands the draft off to them.

## Quick Context

The user message that started this session contains the **selected file
list** (root files / folders / agent-guidance files the user kept
checked on the detect screen). Treat that list as the starting points
for code reading. Follow imports outward from those entry points
instead of scanning the whole tree.

Before reading, call `spec_search` to confirm no spec already covers
this project. If `DESIGN_DOC.md` already exists, stop and report rather
than overwriting.

## Outputs

Three artifacts, in this order:

1. **`DESIGN_DOC.md`** at the project root — the primary deliverable.
   `type: "architecture-design"`, `status: "done"`. Architecture facts
   the code substantiates: module graph, public APIs per module, data
   flow, key design decisions you can *observe* (e.g. "uses event-loop
   pattern: see `app/main.py:42`"). Save section-by-section via
   `spec_save`. Never use ASCII art for diagrams — use `bonsai_visualize`
   in chat and a Mermaid fenced block in the file.
2. **`GOAL&REQUIREMENTS.md`** at the project root, draft only —
   `type: "goal-and-requirements"`, `status: "draft"`,
   `generated_by: "investigate-project"`. Fill only sections that the
   code substantiates (Overview, Current State, Technology from the
   manifest, Constraints from CLAUDE.md / AGENTS.md / public APIs).
   Use `[TBD — clarified in next session]` wherever intent isn't
   visible in code, and append 2–4 `## Open Questions`, each tied to a
   `file:line` reference.
3. **A finding ticket queue** delivered via `SessionFinalize` (see Step 9).

## Core Principles

- **Ask about the document up front, not about the project.** Before
  reading any code, ask only the two shape decisions you *can* make
  blind: which *sections* the doc includes and how *deep* (abstraction
  level) it goes. Depth is not breadth: "which sections" is what the doc
  *covers*; "how deep" is how far *into each module* it drills before
  the detail belongs in a separate `/module-design` spec instead. How
  the graph is *organized* is decided later, visually (Step 3b) — you
  can't sensibly choose by-layer vs by-domain before reading the code.
- **Derived lists are selectors, not the author's choice.** Whenever you
  produce a list the user might want to curate — candidate graph
  organizations, the project's capabilities, etc. — *show the
  candidates* (rendered diagrams via `bonsai_visualize`, or the bullet
  list) and then run `AskUserQuestion` so the user picks what goes in.
  Don't silently decide for them. Applies to the Module Graph variants
  (Step 3b) and the capabilities list (Step 7).
- **Skeleton from facts, not fiction.** Never invent rationale — only
  capture decisions whose evidence you can point to in code. If you
  can't cite a file, mark it `[TBD]` and add an Open Question.
- **One section per `spec_save`.** Build DESIGN_DOC.md incrementally.
  Never write the whole doc in a single `Write` at the end. Same for
  the G&R draft.
- **Targeted questions, not a guided interview.** This is not
  `new-project` — the user already built it. After the Document Setup
  step, ask `AskUserQuestion` only when the *code itself* is
  ambiguous (e.g. two plausible data-flow framings). Open-ended "why"
  goes to the Clarify session, not here.
- **Short Mermaid labels.** Graph nodes show structure, not contents.
  A label is `module-name/` plus optionally a 2–4 word role tag. File
  lists go in `## Modules` bullets, never inside a node. If after
  shortening a label still contains `( ) [ ] , : / text`, wrap it in
  `"…"` as a fallback.

## Step-by-Step Process

> **Do not emit a `workflow-progress` tracker.** The onboarding chain
> steps (What we'll read → Investigation → Clarify → Verify & save) are
> owned by the host's top stepper, which derives them from a single
> source (`frontend/src/components/Wizard/registry.ts`). A hand-written
> copy here only drifts out of sync. The only in-chat progress this
> skill emits is `doc-progress` (the DESIGN_DOC sections — see Step 1.5),
> which is *this skill's own* progress, not the chain's.

### Step 1 — Document Setup (ask the user)

Before reading any code, run **one** `AskUserQuestion` call with two
questions so the user shapes the document up front. Keep the two axes
distinct: Q1 is *breadth* (what the doc covers), Q2 is *depth* (how far
into each module it drills). Graph organization is **not** asked here —
it's chosen visually in Step 3b, once there's real structure to look at.

```
AskUserQuestion (two questions in a single call):

Q1 — header: "Sections"  (multiSelect: true)
   question: "Which sections should DESIGN_DOC include?
              Overview + Module Graph are always included."
   options:
     - "Data Flow — how types/data move between modules"        (default-checked)
     - "Design Decisions — observable tech/pattern choices, each with file:line evidence"

   (Findings are NOT a section option — they're always collected while
    reading and always become board tickets at finalize. Don't gate
    them on this question.)

Q2 — header: "Depth"
   question: "How deep should the architecture description go?"
   options:
     - "Container level — modules + their public APIs, one map.
        Deeper per-module detail spins out into separate /module-design
        specs later (default; recommended)"
     - "Component level — also describe each module's internal
        structure inline in DESIGN_DOC"
     - "Decide after reading the code — I propose where to stop, you confirm"
```

Tailor the Q1/Q2 option labels to the project when you can — e.g. for a
tiny CLI tool, soften the "spins out into /module-design specs" wording
if there's realistically only one module. Graph-variant labels get
tailored later, in Step 3b, against the real directories.

Persist the answers as the working model:

```
sections:    set of {data-flow, design-decisions}
             (overview + module-graph always present)
abstraction: container | component | decide-later
graph_org:   set later in Step 3b (user picks a rendered variant)
```

These switches drive the rest of the flow:

- `data-flow ∉ sections` → skip Step 5 (Data Flow).
- `design-decisions ∉ sections` → skip Step 6 (Design Decisions).
- Findings are **always** collected while reading (Step 2.6) and
  **always** emitted as board tickets in Step 9 — never gated on Q1.
- `abstraction = container` → Step 4 stays at module + public-API
  level; do **not** drill into module internals. At Step 9, recommend a
  `/module-design` session for each module that warrants its own spec.
- `abstraction = component` → Step 4 additionally adds a `## <Module>`
  subsection per module describing its internal structure. No
  `/module-design` spin-off recommendations (the detail is inline).
- `abstraction = decide-later` → read the code first (Step 2), then in
  Step 4 propose where to stop and ask one confirmation question.
- `graph_org` is set in Step 3b when the user picks a rendered variant,
  then reused by Step 4's `## Modules` grouping — no separate question.

If a switch is genuinely not needed (e.g. the project is a single file
or a one-module library — no graph, no depth choice), state inline what
you'll do (`"I'll skip the graph — it's a single module"`) and drop that
question. Only ask the user when the choice matters.

### Step 1.5 — Section progress tracker

Build the **ordered section list** from the Q1 answers — always
`Overview`, `Module Graph`, `Modules`; then `Data Flow` and
`Design Decisions` only if selected. (Findings is not a doc section —
it always becomes tickets in Step 9, regardless of Q1.) Show it via
`bonsai_visualize` `type: "progress-tracker"` with its own
`visId: "doc-progress"` (this skill's own progress — not the chain
stepper, which the host owns):

```json
{
  "type": "progress-tracker",
  "title": "DESIGN_DOC sections",
  "visId": "doc-progress",
  "data": {
    "steps": [
      {"label": "Overview",         "status": "current"},
      {"label": "Module Graph",     "status": "pending"},
      {"label": "Modules",          "status": "pending"}
      // + {"label": "Data Flow", ...} / {"label": "Design Decisions", ...}
      //   only for sections the user selected
    ]
  }
}
```

**After every `spec_save` in Steps 3–6, re-emit this tracker** with the
just-saved section marked `done` and the next one `current`. This is
how the user watches the doc build up section by section — the list and
its order are fixed here so the rest of the flow just advances it.

### Step 2 — Read the code

From the selected paths in the kickoff message:

1. **Project type** — `package.json`, `Cargo.toml`, `pyproject.toml`,
   `go.mod`, etc. Read it; capture name, version, deps.
2. **Entry points** — `main.*`, `index.*`, `app.*`, `__init__.py`,
   `mod.rs`. Read them top-to-bottom.
3. **Module graph** — for each top-level directory, list the files,
   read the public interface (exports, `mod.rs`, `index.ts`,
   `__init__.py`), and follow imports to map dependencies.
4. **Data flow** — extract types flowing between modules: function
   parameter types, return types, message/event types.
5. **Agent guidance** — read any `CLAUDE.md`, `AGENTS.md`,
   `.cursorrules`, etc. that the user kept checked.
6. **Findings (collect as you read)** — keep a running list of:
   - `incomplete` — function/branch defined but never called
   - `todo` — TODO / FIXME / XXX comments in core paths
   - `security` — hardcoded secrets, `eval`, missing auth on public
     routes, plain HTTP in critical flows (be conservative)
   - `dependency` — pinned versions with obvious major
     vulnerabilities or year-out-of-date deps
   - `deadcode` — exports nothing else imports

   Cap at 8 findings. Each must reference `file:line`.

### Step 3 — Overview, then Module Graph (DESIGN_DOC.md)

Build these two sections as **two separate `spec_save` calls**, in
order, so the document is never empty while the tracker shows a later
section as `current`. Each save must land *before* you advance the
tracker past it.

**3a — Overview (creates the file).** Call `spec_save` to create
`DESIGN_DOC.md` with YAML frontmatter (`type: "architecture-design"`,
`status: "active"`), `# <Project Name>`, and `## Overview` — one
paragraph summarising what the code does, in the third person, citing
the entry-point file. Nothing else yet.

Advance `doc-progress`: mark `Overview` `done`, `Module Graph`
`current`. The file now holds real content before you move on — don't
proceed until the save returned.

**3b — Module Graph (render variants, the user picks).** Don't choose
the organization yourself. Render **2–3 candidate graphs** of the *same*
modules, each grouped differently, via `bonsai_visualize`
`type: "diagram"` (structured `nodes`/`edges`, NOT ASCII) — a distinct
`visId` per variant:

- `module-graph-by-layer` — grouped by layer (the actual top-level dirs,
  e.g. `frontend/ backend/ db/ infra/`).
- `module-graph-by-domain` — grouped by business capability (auth /
  billing / …), **only if** the code has discernible domains.
- `module-graph-hybrid` — layers on top, domains inside — **only if** it
  genuinely reads clearer than the other two.

```json
{
  "type": "diagram",
  "title": "Module Graph — by layer",
  "visId": "module-graph-by-layer",
  "data": {
    "nodes": [
      {"id": "frontend", "label": "frontend/ — UI"},
      {"id": "backend",  "label": "backend/ — API"}
    ],
    "edges": [{"from": "frontend", "to": "backend", "label": "REST"}]
  }
}
```

Render only the variants that make sense for *this* project — never
fabricate a domain split that isn't in the code. Then run **one**
`AskUserQuestion` ("Which module graph fits best?") listing the rendered
variants so the user picks. Persist the choice as `graph_org`.

`spec_save` the **chosen** variant only as `## Module Graph` — a
```mermaid `graph TD` block mirroring it, short labels per the principle
above. The unpicked variants were just for comparison; don't save them.

Advance `doc-progress`: mark `Module Graph` `done`, `Modules` `current`.

### Step 4 — Confirm component boundaries

**Graph organization.** `graph_org` was already set in Step 3b when the
user picked a rendered variant. Reuse it directly — group the
`## Modules` bullets the same way. Do **not** ask again.

**Abstraction stopping point.** If `abstraction = decide-later`: now
that the code is read, state where you'll stop (container vs component)
based on what you saw — e.g. `"3 large modules with rich internals →
I'll go component-level on those two, container on the rest"` — and ask
**one** `AskUserQuestion` to confirm if it's genuinely ambiguous;
otherwise proceed.

Save `## Modules` — one bullet per module:
`**\`<dir>/\`** — <one-line role from public API>. Public API: <names>.
Depends on: <others from import analysis>.`

**If `abstraction = component`** (or a module you flagged for it under
`decide-later`): additionally save a `## <module>/` subsection per
module — internal sub-parts, key types, and how the public API is
implemented. Keep it to what the code shows. This is the detail that,
at container level, would instead be deferred to a `/module-design`
spec.

Advance `doc-progress`: mark `Modules` `done`, next selected section
`current`.

### Step 5 — Data flow

**Skip if `data-flow ∉ sections`.** Move directly to Step 7 (G&R draft).

Show via `bonsai_visualize` `type: "diagram"` (left-to-right):

```json
{
  "type": "diagram",
  "title": "Data Flow",
  "visId": "data-flow",
  "data": {
    "nodes":  [{"id": "in", "label": "..."}],
    "edges":  [{"from": "in", "to": "...", "label": "..."}],
    "layout": "left-to-right"
  }
}
```

If the auto-detected flow has a non-obvious choice (e.g. event bus vs
direct calls), ask one `AskUserQuestion` to confirm; otherwise save
straight away. Section: `## Data Flow` — a ```mermaid `graph LR` block
plus one short paragraph per major flow.

Advance `doc-progress`: mark `Data Flow` `done`, next selected section
`current`.

### Step 6 — Design decisions (only what code substantiates)

**Skip if `design-decisions ∉ sections`.**

Scan for observable decisions: framework choice (from manifest),
storage choice (from imports / config), sync vs async (from
signatures), pattern (event-driven vs request/response, monolith vs
modular). For each, **only** record it if you can point to evidence.

Section: `## Design Decisions` — a table `Decision | Choice | Evidence`,
one row per observed decision. The "Evidence" column is a `file:line`
reference. **Do not** add a "Rationale" column — rationale is intent,
not code, and belongs in the Clarify session.

If you'd like to record *why*, append the question to the G&R Open
Questions list instead.

`spec_save` once per row. Advance `doc-progress`: mark
`Design Decisions` `done` (it's the last doc section — all sections
should now read `done`).

### Step 7 — Draft GOAL&REQUIREMENTS.md

`spec_save` a second artifact at the project root:
`type: "goal-and-requirements"`, `status: "draft"`,
`generated_by: "investigate-project"`.

Fill only what code substantiates:

- `## Overview` — same paragraph as DESIGN_DOC's overview.
- `## Current State` — the capabilities the code actually ships (look
  at public commands, REST endpoints, exported functions). This is a
  **selector, not your call**: first show the user the full discovered
  list (a short visualization or an inline bullet list), then run
  **one** `AskUserQuestion` (`multiSelect: true`, "Which capabilities
  should the doc highlight?") so the user marks what to keep. Save only
  the selected ones — each a user-visible capability, not an
  implementation note.
- `## Target Users` — only if the audience is clear from CLI flags,
  auth model, or package metadata. Otherwise `[TBD — clarified in next
  session]`.
- `## Technology` — table populated from the manifest
  (`Aspect | Choice | Source`). Source is the manifest file path.
- `## Constraints` — read from `CLAUDE.md` / `AGENTS.md` /
  `pyproject.toml` (python version, etc.) / existing tests.
- `## Open Questions` — 2-4 questions the code couldn't answer, each
  tied to a `file:line` reference. These become the must-asks for the
  Clarify session. Examples:
  - "What user role does `app/auth/jwt.py:54` (token expiry = 5 min)
    target? Short-session UX or compliance requirement?"
  - "Is the lack of pagination on `/api/users` (see
    `routes/users.py:18`) intentional for small deployments only?"

Promote DESIGN_DOC frontmatter `status: "active"` → `status: "done"`
via `spec_save` once DESIGN_DOC is complete (G&R stays draft).

### Step 8 — Final review

Show the result via `bonsai_visualize` `type: "summary-box"`:

```json
{
  "type": "summary-box",
  "title": "Investigation complete",
  "visId": "investigation-summary",
  "data": {
    "sections": [
      {"heading": "Architecture",       "items": [
        {"label": "Modules",    "value": "[count]"},
        {"label": "Pattern",    "value": "[observed pattern]"}
      ]},
      {"heading": "Draft G&R Open Questions", "items": [
        {"label": "Q", "value": "[first open question]"}
      ]},
      {"heading": "Findings",           "items": [
        {"label": "Total", "value": "[count]"},
        {"label": "Top",   "value": "[shortest finding title]"}
      ]}
    ]
  }
}
```

Then move directly to Step 9 — there's no "edit a section" loop here.
Edits happen in the next session (Clarify).

### Step 9 — `SessionFinalize` contract

The done-screen renders both artifacts in a tab switcher and surfaces
the Clarify session as a recommendation (not a guaranteed next step —
the user can skip to the workspace).

```json
{
  "summary": "Investigation done. DESIGN_DOC.md saved; G&R draft ready to clarify.",
  "artifacts": [
    { "path": "DESIGN_DOC.md",          "openOnDone": true },
    { "path": "GOAL&REQUIREMENTS.md",   "openOnDone": true }
  ],
  "actions": [
    {
      "type": "start_session",
      "id": "next-clarify",
      "title": "Continue → Clarify the G&R draft (N questions)",
      "description": "Refine the draft into a final GOAL&REQUIREMENTS.md by answering the questions the code couldn't.",
      "skillId": "new-project",
      "primary": true,
      "prompt": "⚠️ Onboarding hand-off — these sections were inferred from CODE ONLY by the previous Investigation session. They are educated guesses, not verified intent. Treat them as a starting point, not as confirmed content.\n\nYour job in this Clarify session:\n  • For every section below, ask the user whether the inference is correct. Be specific — propose what's there and ask \"Is this right, or should I rewrite?\".\n  • Save each section the moment it's confirmed. As soon as the user approves a section (unchanged or after a rewrite), `spec_save` that one section immediately — before moving to the next question. Do NOT batch saves to the end: the document must always reflect what the user just confirmed.\n  • The Open Questions section lists gaps the code couldn't fill. Walk those one by one with `AskUserQuestion`. These are the must-asks.\n  • Goals and Target Users especially need real user input — code rarely reveals intent. Probe deeper if the user gives short answers.\n  • DESIGN_DOC.md is already done from code. Do NOT touch it — the architecture facts are stable.\n  • Once every section has been confirmed and saved, do a final `spec_save` that only promotes frontmatter `status: \"draft\"` → `status: \"done\"`.\n\n--- Draft GOAL&REQUIREMENTS.md (inferred from code) ---\n<paste the full draft body verbatim, including the Open Questions section>"
    },
    {
      "type": "navigate",
      "id": "skip-to-board",
      "title": "Skip → Open workspace",
      "description": "Defer the clarify session. Land on the board to plan tickets now.",
      "target": "board"
    }
    // If `abstraction = container`, append one start_session per module
    // that warrants its own spec (large public API, rich internals you
    // deliberately did NOT drill into). This is how container-level
    // depth defers detail instead of bloating DESIGN_DOC. Omit entirely
    // for `abstraction = component` — the detail is already inline.
    , {
      "type": "start_session",
      "id": "module-<dir>",
      "title": "Spec the <dir>/ module (/module-design)",
      "description": "DESIGN_DOC maps <dir>/ at container level. Drill into its internals as a dedicated module spec.",
      "skillId": "module-design",
      "prompt": "Onboarding hand-off — investigate-project mapped this module at container level only. Design its internals as a module README.md. Module: <dir>/. Public API observed: <names>. Depends on: <others>. Start by reading the module's source, then spec it."
    }
    // ...repeat per module worth spinning off
    //
    // ALWAYS append one create_ticket per finding (≤8) from Step 2.6.
    // These are the board tickets — never gate them on a question.
    // If there are zero findings, simply add no create_ticket actions.
    , {
      "type": "create_ticket",
      "id": "finding-<slug>",
      "title": "<finding title with file:line>",
      "body": "<one-line summary — what & where>",
      "state": "pending"
    }
    // ...repeat per finding
  ]
}
```

**Replace the `<paste …>` placeholder in the `prompt` field with the
full draft G&R body** (including the Open Questions section), so the
Clarify session's system prompt receives the verbatim draft. The next
agent uses that as its starting point — it does not need to re-read
the file.

After `SessionFinalize`, send a brief confirmation
("Investigation done.") and end your turn. Do **not** call
`SuggestSession` or open an `AskUserQuestion` at the end — the user
picks the next step from the done-screen buttons.
