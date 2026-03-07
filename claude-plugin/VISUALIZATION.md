# Bonsai Visualization System

## Overview

The Bonsai visualization system uses a **B+C hybrid architecture**: a shared data layer (computed by a Python script) consumed by both an HTML dashboard (zero LLM tokens) and thin CLI skills (minimal tokens).

## Architecture

```
Sources of Truth                Computation              Consumers
─────────────────               ───────────              ─────────

.specs/registry.json (68KB) ─┐
.specs/.progress.json       ─┤  ┌──────────────────┐    ┌─────────────┐
Filesystem (mtimes, dirs)   ─┼─>│ compute-dashboard │ ─> │ stdout      │ -> Hook context
current_tasks/**/*.md       ─┤  │     .py           │    │ (1-line)    │    (free tokens)
*.md spec files             ─┘  │                    │    ├─────────────┤
                                │ ~150ms, stdlib     │ ─> │ dashboard   │ -> LLM skills
                                │ Zero dependencies  │    │ .json (5KB) │    (~2K tokens)
                                └──────────────────┘  ─> │ dashboard   │ -> Browser
                                                         │ .html       │    (0 tokens)
                                                         └─────────────┘
```

**Trigger:** PostToolUse hook fires on Edit|Write -> script runs -> all three outputs updated.

### Hook stdout goes to both user AND LLM

When the hook prints `[specdriven] 85% coverage | 13/18 tasks | 2 stale`, the LLM sees this automatically in conversation context. Design skills get project context for free whenever they write files.

## Components

### compute-dashboard.py

**Location:** `claude-plugin/tools/compute-dashboard.py`

Python stdlib-only script (~300 lines). Reads registry.json, progress data, task files, and source tree. Produces:

1. **stdout one-liner** -- `[specdriven] 85% coverage | 13/18 tasks done | 2 stale | 0 lint errors`
2. **dashboard.json** -- Full pre-computed metrics (~5KB for summary, more for details)
3. **dashboard.html** -- Interactive browser dashboard

**Computation pipeline:**
1. Read registry.json + progress.json
2. Discover source directories (os.walk)
3. Compute coverage (spec-to-directory matching)
4. Compute freshness (spec mtime vs code mtime)
5. Run structural lint (required sections per spec type)
6. Parse task statuses (regex on current_tasks/**/*.md)
7. Build graph (Cytoscape.js-ready format)
8. Generate recommendations (heuristic rules)
9. Write outputs

**Terminal mode:** `--terminal status|progress|lint|next|dashboard` outputs formatted ANSI text directly.

### dashboard-template.html

**Location:** `claude-plugin/tools/dashboard-template.html`

Self-contained HTML template with `{{DASHBOARD_DATA}}` placeholder. Features:

- **5 tabs:** Overview, Graph, Specs, Tasks, Lint
- **Cytoscape.js graph** with dagre layout, node colors by type + freshness
- **Auto-refresh** every 3 seconds via meta tag
- **Dark theme** matching VS Code aesthetic
- **Vendor JS** loaded from `.specs/vendor/` (copied during generation)

### Vendor Files

**Location:** `claude-plugin/tools/vendor/`

Downloaded once, copied to `.specs/vendor/` during HTML generation:
- `cytoscape.min.js` (Cytoscape.js 3.28.1)
- `dagre.min.js` (Dagre 0.8.5)
- `cytoscape-dagre.js` (Cytoscape-dagre adapter 2.5.0)

## Hook Configuration

**File:** `claude-plugin/hooks/hooks.json`

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "python3 \"$CLAUDE_PLUGIN_ROOT/tools/compute-dashboard.py\" \"$CLAUDE_PROJECT_DIR\""
      }]
    }],
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "python3 \"$CLAUDE_PLUGIN_ROOT/tools/compute-dashboard.py\" \"$CLAUDE_PROJECT_DIR\""
      }]
    }]
  }
}
```

## Skill Integration

Skills consume dashboard data instead of reading raw files:

| Skill | How it works now |
|-------|-----------------|
| `/cli-progress` | Runs `--terminal progress`, offers next actions |
| `/spec-status` | Runs `--terminal status`, reads dashboard.json for details |
| `/spec-lint` | Runs `--terminal lint`, offers auto-fixes |
| `/spec-next` | Runs `--terminal next`, adds context-aware interpretation |
| `/visualisation` | Runs `--terminal status` or directs user to HTML dashboard |
| Design skills | Hook stdout provides context automatically; read dashboard.json for details |

**Token savings:** ~90-100% reduction for status/progress/lint/next skills.

## Generated Files (not committed)

| File | Purpose |
|------|---------|
| `.specs/dashboard.json` | Computed metrics |
| `.specs/dashboard.html` | Interactive browser dashboard |
| `.specs/vendor/` | Copied vendor JS for HTML |
| `.specs/.progress.json` | Migrated from .progress.yaml |

## HTML Dashboard Features

### Visual Elements

**Node Colors:**
- Blue (#569cd6) -- Goal & Architecture specs
- Yellow (#dcdcaa) -- Module specs
- Green (#4ec9b0) -- Submodule/component specs
- Orange (#ce9178) -- Stale specs

**Interactive Features:**
1. Click node -- Show detail panel (type, status, freshness)
2. Zoom controls -- Zoom in/out, fit to view
3. Layout options -- Hierarchical (dagre), circular
4. Tab navigation -- Overview, Graph, Specs, Tasks, Lint
5. Auto-refresh -- Updates every 3 seconds

## Data Schema: dashboard.json

Key sections:
- `meta` -- project name, computation timestamp and duration
- `summary` -- one_liner, phase, coverage_pct, spec/task/lint counts
- `workflow` -- steps with status, current_step
- `coverage[]` -- per-directory: path, spec_id, freshness, mtimes
- `lint[]` -- per-issue: spec_id, path, severity, category, message, fixable
- `graph` -- nodes[] and edges[] in Cytoscape.js format
- `recommendations[]` -- priority-ordered: category, title, reason, action
- `pending_tasks[]` -- id, path, module, status
