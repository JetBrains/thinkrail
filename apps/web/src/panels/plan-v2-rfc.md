# Plan v2 — "it's just a markdown file" (RFC, draft)

Status: draft · Owner: TBD · Decision needed before coding.

A proposal for the next Plan surface, not a replacement for the current one. The quick wins already
landed on the current Plan (`PlanPane.tsx` / `TodoList.tsx` / `useChatTodos.ts`) address the "unclear
what the agent is writing / unclear what is done / strange language / scary Trash" layer. This RFC is
about the layer below that: the mental model.

## The problem the quick wins can't fix

Users describe Plan with two kinds of complaint:

1. **Surface complaints** ("strange language", "unclear what is done", "accidental delete"). These are
   solved locally. Done.
2. **Model complaint** ("mess around chat control", "maybe we should just make it feel like editing a
   markdown file"). This is not a wording issue. The user is naming the mental model they want:
   **the Plan is the agent's and my shared document**, not a dashboard of its internal state machine.

The current Plan is a projection of several agent-internal concepts (loose vs group, promote, review
pipeline, status × glance × review axes). Even perfectly polished, that projection still reads as "a
window into something the agent owns", not "my file".

## Target metaphor

**The Plan is a live, two-party markdown document.** One file. Both parties edit it. One canonical
rendering. One export path (`planToMarkdown` is already this format).

Mental model it supports:

```
# Plan — <chat title>

<## Summary — written by the agent, pre-filled from PR body guidance>

## Tasks

- [~] Fix auth bug                             <-- my ask, promoted into a task
  - [x] Reproduce the bug
    Reproduced in auth-test.ts; token survives logout.
    ✓ bun test auth → 15 pass
  - [~] Patch rate-limit
  - [ ] Add regression test

- [x] Refactor subscription flow
  Shortened the webhook retry window and fixed the double-charge.
  ✓ bun run e2e:full subscription → 8 pass

- [ ] <my new ask typed just now>              <-- newly added, not yet promoted
```

Every current operation becomes an operation on this file:

| Current | Markdown-file equivalent |
|---|---|
| Add loose user item | Add a `- [ ] ` line at the end |
| `todo_promote` | Agent indents the user line and adds children `  - [ ] ...` |
| `todo_update status: in_progress` | `[~]` |
| `todo_update status: done` + summary | `[x]` + indented summary + `✓ check → result` line |
| User cancels task | Delete the line (with confirm) |
| Edit title | Edit the line |
| Reorder | Drag the line |
| Review status | `✓` / `⚠ needs a fix` leaf of the item |
| Plan summary | The `## Summary` block |
| `renderPrBody` | **This file verbatim** as the PR body |
| Export .md | **This file verbatim** |

The agent, through its `todo_*` tools, is already producing exactly this structure. The host-side
`renderPrBody` already linearises the plan into exactly this shape. The CLAIM of this RFC: the UI we
show the user should also BE this shape, not a reconstruction of it.

## What stays, what goes

### Stays
- The TODO store, the `todo_*` tool contract, and the per-session JSON file. The agent still writes
  through the same tools; the markdown view is a renderer and an editor on top.
- The host-side plan-level responsibilities: committing a step's delta, running the review subagent,
  pushing a PR.
- The chat tab (ChatView) stays as-is. The Plan is a separate tab; `PlanSessionLive` moves into the
  markdown view as a persistent header block (ask / live message).

### Goes
- The current `TodoList.tsx` + `PlanPane.tsx` split as "two views of the same thing with different
  sections". Plan v2 is **one view**, same in the chat popover (compact collapsed) and the plan tab
  (full).
- The current status × glance × review axis. In v2 there is **one** per-line state:
  `[ ]` todo · `[~]` doing · `[x]` done · `[!]` needs a fix. Review is the leading glyph on the
  summary line, not a second axis.
- The "Session" / "Done" card separation. In v2 done items collapse in-place by state, no section
  break.

## Open questions (must be decided before coding)

1. **Editor engine.** CodeMirror? Monaco? A bespoke renderer with contentEditable lines? Monaco is
   already in-tree for diffs — natural reuse, but overkill for lightweight line editing. Lean toward
   a bespoke renderer: a flat list of `<li>` with inline edit, no document-wide tokenizer needed.
2. **Live conflict model.** The agent writes via `todo_*` (goes through the store, triggers plan
   events); the user edits via keystrokes (goes through a new `todo_*` RPC). Both happen concurrently.
   Simplest: a last-writer-wins per field with a sync nudge when the agent's edit lands on top of
   unflushed user input. We do NOT need OT/CRDT here — the touch surface is small (one plan).
3. **New RPCs needed.** `todos.editTitle`, `todos.setStatus`, `todos.reorder`, `todos.insertAfter`.
   All already expressible as `TodoStore` methods (store already has `update`, `remove`, `add`;
   reorder is new). Thin wrappers over the existing core.
4. **Markdown fidelity vs ease of edit.** We're not building a general markdown editor. We're showing
   a markdown-SHAPED view with a very constrained grammar (title · 1 summary paragraph · 0+
   `✓ check → result` lines · child tasks). Pays for itself: never need to parse arbitrary markdown
   back into plan state.
5. **How agent updates feel to the reader.** When the agent amends a line while the user is reading,
   do we animate the change (diff flash)? Do we show "+ 1 new task" like Google Docs cursor presence?
   Lean toward: a one-second line-highlight tint; no cursor presence (noise).
6. **Where does the chat go.** Chat tab stays separate. The Plan has a persistent `PlanSessionLive`
   block at the top: current question (if any), latest agent message, composer. Clicking a task line
   does NOT open the chat; clicking the status chip does (as today).

## Cost estimate (very rough)

| Phase | Scope | Weeks |
|---|---|---|
| 0 | Design review of this RFC + mockups (Figma or coded prototype in a feature flag) | 1 |
| 1 | New store RPCs (edit title, reorder) + unit tests | 0.5 |
| 2 | Bespoke line-renderer with inline edit + status cycling | 1.5 |
| 3 | Agent-update flash + conflict-resolution UX | 0.5 |
| 4 | Chat popover reused same renderer in compact mode | 0.5 |
| 5 | Migration flag + rollout + quick-wins deprecation | 0.5 |

Total ~4.5 weeks for one engineer, assuming no major surprises in the shared Chat↔Plan hydration
layer. Risk is in phase 2 (bespoke editor): if it slips, we fall back to Monaco in markdown mode
with hidden gutter — slower but shippable.

## Decision needed

- Do we commit to v2? If yes, who owns the design review in Phase 0?
- If no, is this RFC parked (file stays here as a reference) or dropped?

Not blocking: the quick wins are already in `main`-ready state and ship independently of this
decision.

## See also

- `apps/web/src/panels/SPEC.md` — current Plan page contract.
- `apps/web/src/chat/SPEC.md` — chat view contract.
- `apps/web/src/chat/planMarkdown.ts` — the already-existing linearisation this RFC leans on.
- `packages/server/src/pr/prBody.ts` — the already-existing "plan as PR body" renderer.
- `packages/pi-todos/core/SPEC.md` — the TODO store contract (unchanged by this RFC).
