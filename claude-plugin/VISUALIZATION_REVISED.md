# Bonsai Visualization System — Revised Design

> **Status:** Design proposal
> **Replaces:** `claude-plugin/VISUALIZATION.md` (current ANSI-based system)
> **Supersedes:** `compute-dashboard.py` (to be deprecated)

## Problem Statement

The current visualization system instructs the LLM to render ANSI-colored ASCII art in the chat. This fails because:

1. **Channel mismatch:** Claude Code renders Markdown, not ANSI. The Bonsai web UI renders React components, not terminal escape codes.
2. **Bash misuse:** The LLM uses `Bash(echo -e "\e[1;36m...")` to emit ANSI colors, producing garbled output.
3. **No interactivity:** Static text boxes can't be clicked, expanded, updated, or linked to other data.
4. **Duplication:** `compute-dashboard.py` generates dashboard data externally, disconnected from the agent's live context.

### Affected Files (current ANSI instructions)

| File | Lines | Issue |
|------|-------|-------|
| `claude-plugin/VISUALIZATION.md` | All | Defines ANSI Color Output Guide |
| `claude-plugin/skills/visualisation/SKILL.md` | 48-63 | ANSI color code table |
| `claude-plugin/skills/goal-and-requirements/SKILL.md` | 17-18, 290-291 | "APPLY COLOURS... ANSI codes" |
| `claude-plugin/skills/architecture-design/SKILL.md` | 18-19, 118 | "Apply colors... ANSI codes" |
| `claude-plugin/skills/task-spec/SKILL.md` | 18-19 | "Apply colors... ANSI codes" |
| `claude-plugin/skills/module-design/SKILL.md` | 18-19 | "Apply colors... ANSI codes" |
| `claude-plugin/skills/cli-progress/SKILL.md` | 27 | References "ANSI progress display" |
| `claude-plugin/skills/spec-status/SKILL.md` | 23, 58 | References "ANSI status report" |

---

## Design Overview

### Core Principle

**Skills describe WHAT to visualize (structured data). The environment decides HOW to render it.**

- In the **Bonsai web UI**: Rich interactive React components
- In **Claude Code CLI**: Clean Markdown fallback (no ANSI, no Bash)

### Two Visualization Channels

```
┌─────────────────────────────────────────────────────────────┐
│                    VISUALIZATION SYSTEM                       │
├──────────────────────────┬──────────────────────────────────┤
│  Channel 1: LLM-Driven  │  Channel 2: Autonomous            │
│  (interactive, per-turn) │  (background, always-on)          │
│                          │                                    │
│  LLM calls MCP tool      │  VisualizationService watches     │
│  bonsai_visualize(data)  │  files, events, registry          │
│        ↓                 │        ↓                          │
│  SDK processes tool call │  Computes metrics (coverage,      │
│        ↓                 │  progress, lint, tasks)            │
│  Runner emits            │        ↓                          │
│  agent/toolCallStart     │  Emits viz/stateChanged           │
│        ↓                 │  via WebSocket                    │
│  Frontend renders        │        ↓                          │
│  VisualizationCard       │  Frontend updates ProgressTab,    │
│  inline in ChatStream    │  VizTab, StatusBar                │
├──────────────────────────┴──────────────────────────────────┤
│  Both channels share: vizStore, visualization types, CSS     │
└─────────────────────────────────────────────────────────────┘
```

---

## Channel 1: LLM-Driven Visualization

### How It Works

The LLM calls an MCP tool registered in the specdriven plugin. The existing event pipeline carries the data to the frontend.

```
1. Skill instruction tells LLM: "Call bonsai_visualize with structured data"
2. LLM generates tool call: bonsai_visualize({ type: "progress-tracker", ... })
3. Claude Agent SDK processes it via the plugin MCP server
4. Runner emits agent/toolCallStart with { toolName: "bonsai_visualize", toolInput: {...} }
5. ChatStream.tsx pattern-matches on toolName:
   - "AskUserQuestion" → QuestionCard (existing)
   - "bonsai_visualize" → VisualizationCard (new)
   - anything else → ToolCallCard (existing)
6. VisualizationCard renders the structured data as a rich component
7. MCP tool returns a compact text confirmation to the SDK
```

### Integration Point: ChatStream.tsx

Current code (`frontend/src/components/ChatStream/ChatStream.tsx:137-151`):

```tsx
case "toolCallStart": {
  if ((p.toolName as string) === "AskUserQuestion") return null;
  const toolUseId = (p.toolUseId as string) ?? "";
  const end = toolStates.get(toolUseId);
  return (
    <ToolCallCard ... />
  );
}
```

New code:

```tsx
case "toolCallStart": {
  if ((p.toolName as string) === "AskUserQuestion") return null;
  if ((p.toolName as string) === "bonsai_visualize") {
    return (
      <VisualizationCard
        key={k}
        data={p.toolInput as VizData}
      />
    );
  }
  // ... existing ToolCallCard
}
```

### MCP Tool Definition

**Location:** New tool in the specdriven plugin (alongside existing skill definitions)

```typescript
// Tool schema for bonsai_visualize
{
  name: "bonsai_visualize",
  description: "Render a structured visualization in the Bonsai UI. Use this instead of ASCII art or Bash echo commands.",
  inputSchema: {
    type: "object",
    required: ["type", "data"],
    properties: {
      type: {
        type: "string",
        enum: ["progress-tracker", "summary-box", "comparison",
               "data-table", "status-list", "diagram"],
        description: "The visualization type to render"
      },
      title: { type: "string", description: "Optional title for the visualization" },
      data: { type: "object", description: "Type-specific structured data" }
    }
  }
}
```

**MCP tool behavior:**
- Validates the input against the schema
- Returns a minimal text confirmation: `"✓ Rendered: {title} ({type})"`
- In CLI fallback mode: returns a Markdown-formatted version of the visualization

### Visualization Types

#### 1. `progress-tracker`

Displays workflow step progress. Used by all skills for spec-driven workflow position.

```json
{
  "type": "progress-tracker",
  "title": "Specification-Driven Development Progress",
  "data": {
    "steps": [
      {
        "label": "Goal & Requirements",
        "status": "done",
        "file": "GOAL&REQUIREMENTS.md",
        "substeps": [
          { "label": "Goal", "status": "done" },
          { "label": "Requirements", "status": "current" }
        ]
      },
      { "label": "Architecture", "status": "pending", "file": "DESIGN_DOC.md" },
      { "label": "Module Specs", "status": "pending" },
      { "label": "Implementation", "status": "pending" }
    ]
  }
}
```

**Frontend rendering:** Vertical stepper with colored status dots, expand/collapse for substeps, clickable file links.

#### 2. `summary-box`

Bordered container showing key-value data. Used for goal confirmation, requirements summary, spec overview.

```json
{
  "type": "summary-box",
  "title": "REQUIREMENTS SUMMARY",
  "data": {
    "sections": [
      {
        "heading": "Business",
        "status": "done",
        "items": [
          { "label": "HIGH", "value": "RESTful CRUD operations" },
          { "label": "MED", "value": "JWT authentication" },
          { "label": "LOW", "value": "Rate limiting" }
        ]
      },
      {
        "heading": "Technology Stack",
        "status": "current",
        "items": [
          { "label": "Language", "value": "Python" },
          { "label": "Framework", "value": "FastAPI" },
          { "label": "Database", "value": "to-be-defined" }
        ]
      },
      {
        "heading": "Key Constraints",
        "status": "pending",
        "items": []
      }
    ]
  }
}
```

**Frontend rendering:** Card with colored section headers, status indicator per section, key-value rows. "to-be-defined" items shown as placeholder pills.

#### 3. `comparison`

Side-by-side option comparison. Used by architecture-design for approach selection.

```json
{
  "type": "comparison",
  "title": "Architecture Approach",
  "data": {
    "options": [
      {
        "name": "Monolith",
        "pros": ["Simple deployment", "Shared state"],
        "cons": ["Scaling limits"],
        "diagram": "optional ASCII or description"
      },
      {
        "name": "Microservices",
        "pros": ["Independent scaling"],
        "cons": ["Complexity", "Network overhead"],
        "diagram": "optional ASCII or description"
      }
    ]
  }
}
```

**Frontend rendering:** Two-column cards with pro/con lists, optional diagram area.

#### 4. `data-table`

Tabular data with optional sorting and status indicators.

```json
{
  "type": "data-table",
  "title": "Spec Coverage",
  "data": {
    "columns": ["Module", "Coverage", "Status", "Last Updated"],
    "rows": [
      ["backend/app/spec", "100%", "fresh", "2026-03-07"],
      ["backend/app/agent", "85%", "stale", "2026-02-28"],
      ["frontend/src/store", "70%", "fresh", "2026-03-05"]
    ],
    "statusColumn": 2
  }
}
```

**Frontend rendering:** Styled table with sortable columns, colored status cells.

#### 5. `status-list`

Vertical list with status indicators. Used for task tracking, lint results, etc.

```json
{
  "type": "status-list",
  "title": "Task Status",
  "data": {
    "items": [
      { "label": "Implement spec parser", "status": "done", "meta": "backend/app/spec" },
      { "label": "Add graph visualization", "status": "in_progress", "meta": "frontend" },
      { "label": "Write integration tests", "status": "pending", "meta": "tests/" }
    ]
  }
}
```

**Frontend rendering:** Compact list with status icons (checkmark, spinner, circle), groupable by meta.

#### 6. `diagram`

Structural diagram (architecture, data flow, component relationships).

```json
{
  "type": "diagram",
  "title": "System Architecture",
  "data": {
    "nodes": [
      { "id": "fe", "label": "Frontend", "type": "component" },
      { "id": "ws", "label": "WebSocket", "type": "transport" },
      { "id": "be", "label": "Backend", "type": "component" },
      { "id": "sdk", "label": "Claude SDK", "type": "external" }
    ],
    "edges": [
      { "from": "fe", "to": "ws", "label": "JSON-RPC" },
      { "from": "ws", "to": "be" },
      { "from": "be", "to": "sdk", "label": "query/stream" }
    ],
    "layout": "left-to-right"
  }
}
```

**Frontend rendering:** SVG-based box-and-arrow diagram, reusing patterns from existing `GraphView/` components. For simple cases, can also render as a formatted code block.

### Status Values (Shared Across Types)

| Status | Icon | Color | Meaning |
|--------|------|-------|---------|
| `done` | `✓` | Green | Completed |
| `current` | `▶` | Blue (animated) | In progress |
| `pending` | `○` | Gray | Not started |
| `error` | `✗` | Red | Failed |
| `skipped` | `⊘` | Dim gray | Intentionally skipped |
| `stale` | `~` | Yellow | Outdated |
| `fresh` | `✓` | Green | Up to date |
| `in_progress` | `◐` | Blue | Partially complete |

---

## Channel 2: Autonomous Visualization

### VisualizationService (Backend)

**Location:** `backend/app/viz/service.py` (new module)

Replaces `compute-dashboard.py` with a live, stateful service integrated into the Bonsai backend.

```python
class VisualizationService:
    """Maintains live visualization state, pushes updates to frontend."""

    def __init__(self, config: AppConfig, spec_service: SpecService):
        self._config = config
        self._spec_service = spec_service
        self._state: DashboardState = DashboardState()
        self._notify: Callable | None = None

    # Called on startup and when files change
    async def recompute(self) -> None:
        """Recompute all dashboard metrics from registry, files, tasks."""
        # Same logic as compute-dashboard.py but in-process
        ...
        if self._notify:
            await self._notify("viz/stateChanged", self._state.to_dict())

    # Called when spec files change (wired from file watcher)
    async def on_spec_changed(self, spec_id: str) -> None: ...

    # Called on agent events (tool calls that modify files)
    async def on_agent_event(self, event: dict) -> None: ...

    # RPC method: get current state
    def get_state(self) -> dict: ...
```

### Data Model

```python
@dataclass
class DashboardState:
    coverage_pct: float
    spec_count: int
    task_count: int
    tasks_done: int
    tasks_pending: int
    lint_warnings: int
    stale_count: int
    workflow_phase: str
    workflow_steps: list[WorkflowStep]
    coverage_details: list[CoverageEntry]
    pending_tasks: list[TaskEntry]
    recommendations: list[Recommendation]
    computed_at: str
```

### WebSocket Integration

**New notifications:**

| Notification | Trigger | Payload |
|-------------|---------|---------|
| `viz/stateChanged` | File change, agent event, explicit recompute | Full `DashboardState` |

**New RPC methods:**

| Method | Purpose | Returns |
|--------|---------|---------|
| `viz/state` | Get current dashboard state | `DashboardState` |
| `viz/recompute` | Force recompute | `DashboardState` |

### Frontend Integration

**New store:** `frontend/src/store/vizStore.ts`

```typescript
interface VizStore {
  dashboard: DashboardState | null;
  loading: boolean;

  fetchState: () => Promise<void>;
  onStateChanged: (state: DashboardState) => void;
}
```

**New wireEvents subscription** (`wireEvents.ts`):

```typescript
unsubs.push(
  client.on("viz/stateChanged", (p) => {
    useVizStore.getState().onStateChanged(p as DashboardState);
  }),
);
```

**UI placement:**

1. **New VizTab** in right panel (`ContextPanel`) — primary home for autonomous dashboard: coverage table, lint issues, task breakdown, recommendations, workflow phase
2. **StatusBar** (`frontend/src/components/AppShell/StatusBar.tsx`) — one-line summary: `"85% coverage | 13/18 tasks | 2 stale"`
3. **ProgressTab** — unchanged (stays focused on sessions, cost, activity timeline)

---

## Skill Instruction Changes

### Pattern: Before and After

**Before** (causes Bash misuse):
```markdown
- Use terminal graphics to show goal structure (see `/specdriven:visualisation` patterns)
- APPLY COLOURS from the `/specdriven:visualisation` Color Output Guide when rendering (ANSI codes for dark theme)
```

**After** (uses structured visualization):
```markdown
- Call `bonsai_visualize` tool with structured data for all visualizations
- NEVER use Bash, echo, or printf to render visual output
- NEVER embed ANSI escape codes in text output
- For simple inline status, use Markdown formatting (bold, tables, code blocks)
```

### Updated Visualization Reference

Replace the "Color Output Guide" in `VISUALIZATION.md` / `visualisation/SKILL.md` with:

```markdown
## Visualization Guide

### For structured data (preferred)
Call `bonsai_visualize` with the appropriate type:
- Workflow progress → type: "progress-tracker"
- Requirements/specs summary → type: "summary-box"
- Architecture options → type: "comparison"
- Coverage/task data → type: "data-table"
- Task/lint lists → type: "status-list"
- Architecture diagram → type: "diagram"

### For inline text (simple cases only)
Use Markdown:
- **Bold** for emphasis
- `code` for file paths, tool names
- Tables for structured data
- > Blockquotes for callouts

### Anti-patterns (NEVER do these)
- ❌ Bash echo/printf for visual output
- ❌ ANSI escape codes (\e[1;36m, etc.)
- ❌ Hand-drawn ASCII boxes in text (use bonsai_visualize instead)
```

### Per-Skill Changes

**goal-and-requirements/SKILL.md:**
- Lines 17-18: Replace ANSI instruction with `bonsai_visualize` reference
- Lines 290-291: Same replacement
- Step 1 (show progress): Replace ASCII box with `bonsai_visualize({ type: "progress-tracker", ... })`
- Step 7 (visual confirmation): Replace box with `bonsai_visualize({ type: "summary-box", ... })`
- VISUALIZATION section (lines 330-358): Replace entire ASCII template with JSON schema for `summary-box`

**architecture-design/SKILL.md:**
- Lines 18-19: Replace ANSI instruction
- Line 118: Replace "ASCII art pipeline diagram" with `bonsai_visualize({ type: "diagram", ... })`
- Approach comparison: Use `bonsai_visualize({ type: "comparison", ... })`

**task-spec/SKILL.md:**
- Lines 18-19: Replace ANSI instruction
- Confirmation displays: Use `bonsai_visualize({ type: "summary-box", ... })`

**module-design/SKILL.md:**
- Lines 18-19: Replace ANSI instruction
- Component diagrams: Use `bonsai_visualize({ type: "diagram", ... })`

**cli-progress/SKILL.md:**
- Line 27: Remove "ANSI progress display" reference
- Use `bonsai_visualize({ type: "progress-tracker", ... })` for workflow display
- OR: Rely on autonomous channel (ProgressTab already shows this data)

**spec-status/SKILL.md:**
- Lines 23, 58: Remove "ANSI" references
- Use autonomous dashboard state from `viz/state` RPC method
- Show details via `bonsai_visualize({ type: "data-table", ... })` if needed

**visualisation/SKILL.md:**
- Remove entire "Color Output Guide" section (lines 48-63)
- Replace "Visualization Patterns" (lines 65-134) with JSON schema reference
- Update direct invocation to use `viz/state` RPC + VisualizationCard

---

## CLI Fallback (Claude Code Context)

When the agent runs in Claude Code CLI (not Bonsai web UI), the MCP tool detects the context and returns Markdown instead of relying on frontend rendering.

### Detection

The MCP tool checks for the Bonsai backend connection. If absent, it falls back to Markdown rendering.

### Markdown Rendering Examples

**progress-tracker → Markdown:**
```markdown
### Specification-Driven Development Progress

| Step | Status | File |
|------|--------|------|
| **Goal & Requirements** | ✓ Done | `GOAL&REQUIREMENTS.md` |
| Architecture | ○ Pending | `DESIGN_DOC.md` |
| Module Specs | ○ Pending | |
```

**summary-box → Markdown:**
```markdown
### REQUIREMENTS SUMMARY

**Business** ✓
| Priority | Requirement |
|----------|-------------|
| HIGH | RESTful CRUD operations |
| MED | JWT authentication |

**Technology Stack** ▶ (current)
| Component | Choice |
|-----------|--------|
| Language | Python |
| Framework | FastAPI |
| Database | *to-be-defined* |
```

---

## Migration from compute-dashboard.py

### What compute-dashboard.py Currently Does

1. Reads `registry.json`, `.progress.json`, task files, source tree
2. Computes: coverage, freshness, lint, task status, graph, recommendations
3. Outputs: stdout one-liner (for hooks), `dashboard.json`, `dashboard.html`
4. Triggered by: PostToolUse hook (Edit|Write) and SessionStart hook

### Migration Plan

| Current | New | Phase |
|---------|-----|-------|
| `compute-dashboard.py` script | `VisualizationService` in backend | Phase 2 |
| PostToolUse hook trigger | File watcher + agent event subscription | Phase 2 |
| `dashboard.json` static file | Live `DashboardState` in memory + RPC | Phase 2 |
| `dashboard.html` standalone page | VizTab in Bonsai right panel | Phase 2 |
| stdout one-liner for hooks | StatusBar component (already exists) | Phase 2 |
| Cytoscape.js graph in HTML | Existing `GraphView` component (already exists) | Already done |

### Coexistence Period

During migration, both systems run in parallel:
- `compute-dashboard.py` continues via hooks (unchanged)
- `VisualizationService` is built and tested independently
- Once parity is confirmed, hooks are removed and `compute-dashboard.py` is deprecated

---

## Implementation Roadmap

### Phase 0: Stop the Bleeding (Immediate)

**Goal:** Stop LLM from using Bash for visualization. No new infrastructure.

**Changes:**
1. Update all 8 skill files: remove ANSI color instructions, add "NEVER use Bash for visualization"
2. Replace ANSI patterns with Markdown formatting instructions
3. Update `VISUALIZATION.md` to remove Color Output Guide

**Effort:** ~1 hour
**Risk:** Low — text-only changes to prompt files

### Phase 1: LLM-Driven Visualization (MCP Tool + Frontend)

**Goal:** Skills use structured data via MCP tool. Frontend renders rich components.

**Changes:**
1. Create `bonsai_visualize` MCP tool in specdriven plugin
2. Create `VisualizationCard` React component with renderers for each type
3. Add pattern match in `ChatStream.tsx` for `bonsai_visualize` tool calls
4. Update skill files to use `bonsai_visualize` instead of text boxes
5. Add CLI Markdown fallback in MCP tool

**New files:**
- `claude-plugin/tools/visualize-tool/` — MCP tool implementation
- `frontend/src/components/ChatStream/VisualizationCard.tsx` — main renderer
- `frontend/src/components/ChatStream/viz/` — per-type renderers (ProgressTracker, SummaryBox, etc.)
- `frontend/src/types/viz.ts` — TypeScript types for visualization data

**Modified files:**
- `frontend/src/components/ChatStream/ChatStream.tsx` — add viz tool pattern match
- `claude-plugin/skills/*/SKILL.md` — update visualization instructions
- `claude-plugin/VISUALIZATION.md` — reference new system

**Effort:** ~3-5 days
**Risk:** Medium — new component + MCP tool, but follows established patterns

### Phase 2: Autonomous Visualization (Backend Service)

**Goal:** Replace `compute-dashboard.py` with live backend service. Dashboard data available in UI without LLM calls.

**Changes:**
1. Create `backend/app/viz/` module with `VisualizationService`
2. Add `viz/state` and `viz/recompute` RPC methods
3. Add `viz/stateChanged` WebSocket notification
4. Create `vizStore.ts` Zustand store
5. Add `VizTab` to right panel (ContextPanel)
6. Wire file watcher events to VisualizationService
7. Update `StatusBar` with live one-liner

**New files:**
- `backend/app/viz/__init__.py`
- `backend/app/viz/service.py`
- `backend/app/viz/models.py`
- `backend/app/rpc/methods/viz.py`
- `frontend/src/store/vizStore.ts`
- `frontend/src/components/ContextPanel/modes/VizTab.tsx`

**Modified files:**
- `backend/app/main.py` — register VizService
- `backend/app/rpc/server.py` — register viz RPC methods
- `frontend/src/store/wireEvents.ts` — subscribe to viz notifications
- `frontend/src/components/AppShell/StatusBar.tsx` — show one-liner
- `frontend/src/components/ContextPanel/ContextPanel.tsx` — add VizTab

**Effort:** ~5-7 days
**Risk:** Medium — new backend service, but computation logic is ported from existing script

### Phase 3: Deprecate compute-dashboard.py

**Goal:** Remove old system once new system has parity.

**Changes:**
1. Remove PostToolUse and SessionStart hooks for `compute-dashboard.py`
2. Remove `compute-dashboard.py` and `dashboard-template.html`
3. Remove generated files: `.specs/dashboard.json`, `.specs/dashboard.html`, `.specs/vendor/`
4. Update `VISUALIZATION.md` → point entirely to this document
5. Clean up any remaining references

**Effort:** ~1 day
**Risk:** Low — removal after parity confirmed

---

## Design Decisions (Resolved)

### D1: Hybrid Collapse for Repeated Visualizations

**Decision:** When the LLM calls `bonsai_visualize` multiple times with the same `vizId`, previous cards auto-collapse to a thin "updated" marker. The latest card renders in full.

**Why:** Preserves history (expandable) while keeping chat clean. Avoids the complexity of in-place DOM replacement.

**Schema addition:** All viz types accept an optional `vizId: string` field. When present, ChatStream scans backward for previous events with the same `vizId` and collapses them.

**Implementation pattern** (follows existing SubagentBlock approach):

```tsx
// In ChatStream.tsx — pre-scan phase (alongside toolStates, activeSubagents)
const latestVizByVizId = new Map<string, number>(); // vizId → last event index
for (let i = 0; i < events.length; i++) {
  const ev = events[i];
  if (ev.eventType === "toolCallStart" && ev.payload.toolName === "bonsai_visualize") {
    const vizId = (ev.payload.toolInput as any)?.vizId;
    if (vizId) latestVizByVizId.set(vizId, i);
  }
}

// In render — for bonsai_visualize events:
const vizId = (p.toolInput as any)?.vizId;
const isLatest = !vizId || latestVizByVizId.get(vizId) === i;
if (!isLatest) {
  return <CollapsedVizMarker key={k} title={vizTitle} />;
}
return <VisualizationCard key={k} data={p.toolInput as VizData} />;
```

**CollapsedVizMarker:** Thin bar with icon + "Requirements Summary (updated)" text, expandable on click.

### D2: Full Persistence

**Decision:** Persist visualization events in full, same as all other agent events.

**Why:** Session restore needs to show visualizations. The `_persisting_notify` pipeline in `service.py:296-307` already handles this automatically — no extra work needed. Disk cost is acceptable since viz data is structured JSON (typically 1-5KB per event).

### D3: New VizTab in Right Panel

**Decision:** Add a dedicated VizTab in the ContextPanel (right panel) for autonomous dashboard data.

**Why:** Separation of concerns — ProgressTab stays focused on sessions/cost/activity. VizTab shows spec health: coverage details, lint issues, task breakdown, recommendations. This maps cleanly to the data sections in `DashboardState`.

**ContextPanel tab order:** Agent | Spec | Code | **Viz** (new)

The VizTab is always available (not context-dependent like Spec/Code tabs), since dashboard data is project-wide.

### D4: Auto-Allow for bonsai_visualize

**Decision:** Auto-allow without user approval. Display-only tool with no side effects.

**Implementation** in `runner.py:49-97` (`can_use_tool` hook):

```python
async def can_use_tool(
    tool_name: str,
    input_data: dict[str, Any],
    context: ToolPermissionContext,
) -> PermissionResultAllow | PermissionResultDeny:
    if tool_name == "AskUserQuestion":
        # ... existing question handling ...
    elif tool_name == "bonsai_visualize":
        # Auto-allow: display-only, no side effects
        return PermissionResultAllow(behavior="allow")
    else:
        # ... existing approval flow ...
```

**Note:** Unlike `AskUserQuestion` (which modifies `updated_input` in the response), `bonsai_visualize` passes through unchanged — the frontend handles rendering from the original `toolInput`.
