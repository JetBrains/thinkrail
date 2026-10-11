# Plan as a side-rail panel — RFC (draft)

Status: draft · Owner: TBD · Decision needed before coding.

User ask (verbatim, from the chat): «давай TODO window вынесем туда же где сейчас files или specs
чтобы было отдельное окно». That is: make the plan one of the side-rail tools alongside
Files / Specs / Changes / Review, not a center editor tab.

This is a separate RFC from `plan-v2-rfc.md`. The v2 RFC is about the mental model (markdown
document). This one is about the surface placement (center-tab vs rail-tool) and can land independent
of v2 — the choice of placement does not pre-decide the mental model.

## Where Plan lives today

- **Shape:** `LayoutDocumentTab` in `apps/web/src/shell/layout/types.ts` — `kind: "document",
  documentKind: "todo-plan", sourceId: sessionId`. One Plan tab per session, lives in the center
  editor area.
- **Renderer:** `WorkspaceWorkbench.renderResourceBody` lazy-loads `PlanPane` for `tab.kind ===
  "document"`.
- **Width target:** `max-w-[52rem]` (document-scale layout — stepper + cards + commit chips + review
  slot + composer).

## Where Files / Specs / Review live

- **Shape:** `LayoutToolTab` — `kind: "tool", tool: LayoutToolId`. One per workspace, lives in a
  side-rail group (left or right).
- **Registry:** `LAYOUT_TOOLS = ["projects", "specs", "files", "changes", "review"]` in
  `apps/web/src/shell/layout/model.ts`. The underlying type is pulled from `LayoutPreset` in
  `@thinkrail/contracts`, so adding a new tool is a **contract change**, not a view-only tweak.
- **Renderer:** `WorkspaceWorkbench.toolBodies: Record<LayoutToolId, ReactNode>` — one entry per
  tool, each a workspace-scoped component.
- **Width target:** ~280–320px of a rail group (narrow, scrollable, no horizontal split).

## Target: Plan as a sixth tool

`LAYOUT_TOOLS = ["projects", "specs", "files", "changes", "review", "plan"]`. The rail tool shows the
plan of the workspace's currently active chat; the user doesn't pick a session for the rail. Opening a
plan from the chat popover ("Open plan" button) stops opening a center tab and instead focuses the
rail.

### Mockup (narrow rail, ~300px)

```
┌─ Plan ──────────────────────────┐
│ ● Working on this               │
│                                 │
│ Fix auth bug · 2/4              │
│ ───────────                     │
│ ✓ Reproduce the bug             │
│   Repro'd in auth-test.ts       │
│   ✓ bun test auth → 15 pass     │
│ ✓ Patch rate-limit              │
│ ● Add regression test           │
│ · Document the fix              │
│                                 │
│ Up next                         │
│ ───────────                     │
│ Refactor subscription flow      │
│ · 0/3                           │
│                                 │
│ Done ▸                          │
│                                 │
│ ─────────────────────────────── │
│ ● Working on this · chat ↗      │
│ > The reviewer is reading step  │
│   "Add regression test"…        │
│ ─────────────────────────────── │
│ [ Message or steer the agent ]  │
└─────────────────────────────────┘
```

What survived from the current PlanPane:

- Tasks + their steps, with `summary` preview on done items (QW-2), verification glyph (QW-3), empty
  promoted group as `planning…` (QW-6).
- The vocabulary from QW-5 (Now / Up next / Checked / Needs a fix).
- The `PlanSessionLive` block — ask card / live agent message / composer, always on.
- The Remove-with-confirm (QW-7).

What's cut or compacted:

- **The page header** (title · stepper · branch · diffstat · commits menu · PR button · menu) does
  not survive at this width. PR actions move to a kebab at the top of the rail; branch/diffstat move
  into a thin status line (or come from a chip in the chat header, not duplicated).
- **The next-action banner** (`fix | review | diverged | push | ship`) collapses to a single
  dismissible top strip when any is active; otherwise hidden.
- **Done section** is collapsed by default (one disclosure row); clicking expands it. Keeps it from
  dominating a tall-but-narrow rail.
- **Change-set chips, revisions timeline, review feedback** stay in the expanded detail of each
  item (unchanged — same `ItemBlock`).
- **Session composer** is still at the bottom but drops the live-message preview above it when space
  is tight (`@container` query).

## What needs to change

### Contract (`@thinkrail/contracts`)
1. Extend `LayoutPreset`'s tool union to include `"plan"`.
2. Decide: is `LayoutDocumentTab` with `documentKind: "todo-plan"` **removed** (no center-tab Plan
   anymore), **kept** (both surfaces, dual-mode), or **deprecated** (reads keep working, no new
   writes)? See open question Q1.
3. `pr.preview` and related RPCs don't change — they already take `(workspaceId, sessionId)`.

### `apps/web/src/shell`
4. `LAYOUT_TOOLS.push("plan")` + `LAYOUT_TOOL_DEFAULT_SIDES.plan = "right"` + `LAYOUT_TOOL_NAMES.plan
   = "Plan"` in `layout/model.ts`.
5. `WorkspaceWorkbench.toolBodies.plan = <PlanRailPane workspaceId={workspaceId}
   sessionId={activeChatSessionId}/>` — a thin wrapper that picks the right session for the current
   workspace.
6. "Which session's plan?" selector: use the workspace's **last-focused chat tab**; fall back to the
   workspace's single chat if there's only one; show a "no plan — open a chat" empty state otherwise.

### `apps/web/src/panels`
7. `PlanPane` splits into:
   - `PlanDocument` — the current document-scale page body (preserve for v2 / exports / test
     fixtures).
   - `PlanRailPane` — the narrow version used by the rail. Shares `ItemBlock`, `SessionBlock`,
     `GroupSection`, `PlanSessionLive`, `PlanSummary` with `PlanDocument` (which is the point: we
     keep one source of truth per sub-component).
   - If Q1 says "rail only", drop `PlanDocument` and inline its surviving pieces into
     `PlanRailPane` — don't ship a dead file.
8. The chat popover's `TodoList.tsx:TodoRows` keeps its compact form — users will still peek the plan
   from the chat strip without leaving the chat tab.
9. "Open plan" (`todo-open-plan`) stops opening a center tab; it focuses or opens the Plan tool in
   the right rail (via `requestToolView(workspaceId, "plan")`).

### Migration (data on disk)
10. Existing layout documents still carry `LayoutDocumentTab{documentKind:"todo-plan"}` entries. On
    load, migrate them to a `plan` tool tab in the right rail; the migration lives in
    `apps/web/src/shell/layoutState/`.

## Open questions

**Q1. One Plan or two?** Rail-only (Option A, simpler, one surface, forces narrow layout for everyone)
vs rail-plus-center (Option B, keep the document-scale Plan as a "zoom in" tab the user can open from
the rail kebab). Rail-plus-center means we have two renderers to maintain forever.
→ **Recommendation:** A. Narrow surface is enough; v2 (markdown-doc) is the real "zoomed" surface,
and until then "Download .md" / "Copy" already give the full-canvas view when a reader needs it.

**Q2. Whose plan does the rail show?** The active chat tab's plan is the obvious answer; what about
when there is no active chat tab, or when two chats are open side-by-side (center split)?
→ **Recommendation:** show the most-recently-focused chat's plan; when none, show the "no plan yet"
empty state with a "Start a chat" CTA. For center splits, the rail follows the focused chat
(same rule the Changes rail already uses for diffs).

**Q3. Where does the composer live?** The rail is narrow. A composer at the bottom of a 300px
column may feel cramped.
→ **Recommendation:** keep it at the bottom of the rail. Many editors have narrow chat panels
(Cursor, Zed, VS Code Copilot). The Enter/Shift+Enter convention is familiar. If the rail is
*really* narrow (user shrank it below some threshold), the composer collapses to a one-click "Open
chat" button that focuses the center chat composer.

**Q4. Default side?** Files/Specs/Changes/Review default to the right rail; Projects to the left.
Plan is read-write and task-oriented — closer to Files than to Projects. Right rail.

**Q5. Is Plan always visible?** Current Plan is only opened explicitly (click "Open plan" in the
chat strip). Should the rail Plan be visible by default on workspace open, or require explicit "+
Plan" from the rail-tool menu like other tools?
→ **Recommendation:** no auto-show. Keep the opt-in behavior; the quick-wins already surfaced the
plan enough from the chat strip for discoverability. A default-visible rail would push the
workbench on narrow screens.

**Q6. Discoverability for existing users?** Users opening the center-tab Plan after this ships
should not land on a dead "Not found" state. The migration (step 10) rewrites existing center-tab
Plans into rail tabs, but a stale URL / deep link may still try to open a center-document Plan.
→ **Recommendation:** keep the resolver for `documentKind: "todo-plan"` for one release that
redirects to the rail tool, logging a telemetry breadcrumb. Delete the next release.

## Cost estimate

| Phase | Scope | Days |
|---|---|---|
| 0 | This RFC + design review | 0.5 |
| 1 | Contract change (`@thinkrail/contracts`) + regenerate types | 0.5 |
| 2 | `PlanPane` → split into `PlanRailPane` + shared sub-components; narrow styling | 1.0 |
| 3 | `WorkspaceWorkbench` wiring + `toolBodies.plan` + active-session selector | 0.5 |
| 4 | Layout migration + the one-release center-tab redirect | 0.5 |
| 5 | Open-plan button targets the rail; e2e tests for the new flow | 0.5 |
| Total | | ~3.5 days (one engineer) |

This is scoped to **placement**, not model. Combined with Plan v2 (markdown-doc) if that lands, the
rail version becomes the markdown-doc rendered compact.

## Decision needed

- A or B on Q1 (one Plan or two)?
- Approve the recommendations on Q2–Q6?
- Approve the contract change + the one-release redirect for existing document tabs?

## See also

- `apps/web/src/panels/plan-v2-rfc.md` — the separate RFC on mental model (markdown-doc). Orthogonal
  to this one; both can land independently or together.
- `apps/web/src/shell/layout/types.ts` — current layout tab discriminated union.
- `apps/web/src/shell/layout/model.ts` — `LAYOUT_TOOLS`, `LAYOUT_TOOL_DEFAULT_SIDES`,
  `LAYOUT_TOOL_NAMES`.
- `apps/web/src/shell/WorkspaceWorkbench.tsx` — `renderResourceBody` and `toolBodies` wiring.
- `apps/web/src/panels/SPEC.md` — current Plan page contract.
