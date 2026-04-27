# SpecDriven — Claude Code Specification-Driven Development Plugin

A complete specification-driven development system for Claude Code. Provides skills (slash commands), a spec registry, workflow orchestration, hooks, rich terminal visualizations, and validation tools to ensure your project is always guided by and consistent with its specifications.

## Quick Start

```bash
# Use during development
claude --plugin-dir ./plugin

# Then in Claude Code:
/specdriven:spec-init MyProject
/specdriven:goal-and-requirements  # Define goal and requirements
```

## Plugin Structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest (name, version, description)
├── skills/                      # 13 skill definitions
│   ├── goal-and-requirements/SKILL.md  # Goal + requirements (GOAL&REQUIREMENTS.md)
│   ├── architecture-design/SKILL.md
│   ├── module-design/SKILL.md
│   ├── submodule-design/SKILL.md
│   ├── task-spec/SKILL.md
│   ├── spec-init/SKILL.md
│   ├── spec-status/SKILL.md
│   ├── spec-next/SKILL.md
│   ├── spec-from-code/SKILL.md
│   ├── spec-lint/SKILL.md
│   ├── spec-review/SKILL.md
│   ├── visualization/SKILL.md   # Terminal visualization toolkit
│   └── cli-progress/SKILL.md   # CLI progress tracking
├── hooks/
│   └── hooks.json               # PostToolUse and SessionStart hooks
└── README.md
```

## Skills Overview

### Foundation Skills (1 skill)

| Skill | Command | Purpose |
|-------|---------|---------|
| Goal & Requirements | `/specdriven:goal-and-requirements` | Define project goal, requirements, and tech stack — creates GOAL&REQUIREMENTS.md |

### Specification Creation (4 skills)

| Skill | Command | Purpose |
|-------|---------|---------|
| Architecture Design | `/specdriven:architecture-design` | Create DESIGN_DOC.md — pipeline diagrams, data flow, decisions |
| Module Design | `/specdriven:module-design` | Module README.md — API docs, contracts, internals |
| Sub-Module Design | `/specdriven:submodule-design` | Focused docs for algorithms and sub-components |
| Task Specification | `/specdriven:task-spec` | Actionable bug fix / feature implementation specs |

### Visualization Skills (2 skills)

| Skill | Command | Purpose |
|-------|---------|---------|
| Visualization | `/specdriven:visualization` | Terminal visualization toolkit — ASCII diagrams, box formatting, progress indicators |
| CLI Progress | `/specdriven:cli-progress` | Workflow progress tracking — phase visualization, milestone dashboards |

### Workflow and Tooling (6 skills)

| Skill | Command | Purpose |
|-------|---------|---------|
| Initialize | `/specdriven:spec-init` | Set up spec-driven development — directories, registry, CLAUDE.md |
| Status | `/specdriven:spec-status` | Dashboard — coverage, freshness, gaps, health |
| Next | `/specdriven:spec-next` | Suggest what to specify next based on gaps and priorities |
| From Code | `/specdriven:spec-from-code` | Reverse-engineer spec skeletons from existing code |
| Lint | `/specdriven:spec-lint` | Validate spec structure, links, completeness |
| Review | `/specdriven:spec-review` | Deep review of spec accuracy against code |

## Workflow

### Dependency Graph

```
Level 0: /spec-init (project scaffolding)
    ↓
Level 1: /goal-and-requirements (GOAL&REQUIREMENTS.md)
    ↓
Level 2: /architecture-design (DESIGN_DOC.md)
    ↓
Level 3: /module-design (one per major module)
    ↓
Level 4: /submodule-design (for complex sub-components)
    ↓
Level 5: /task-spec (implementation tasks)
```

### New Project

```
/specdriven:spec-init MyProject          # 1. Scaffold directories and registry
/specdriven:goal-and-requirements        # 2. Define goal and requirements (GOAL&REQUIREMENTS.md)
/specdriven:architecture-design          # 3. Document architecture
/specdriven:module-design src/core       # 4. Specify each module
/specdriven:task-spec add_auth           # 5. Create implementation tasks
# ... implement guided by specs ...
/specdriven:spec-lint                    # 6. Validate everything
```

### Existing Codebase

```
/specdriven:spec-init MyProject          # 1. Set up tracking
/specdriven:goal-and-requirements        # 2. Define goal and requirements
/specdriven:spec-from-code               # 3. Generate spec skeletons from code
/specdriven:spec-status                  # 4. See coverage gaps
/specdriven:spec-next                    # 5. Get prioritized recommendations
# ... fill gaps ...
/specdriven:spec-lint                    # 6. Validate
```

### Ongoing Development

```
/specdriven:cli-progress                 # Check workflow progress
/specdriven:spec-status                  # Check health
/specdriven:spec-next                    # What needs attention?
/specdriven:spec-review src/parser       # Deep review of specific module
/specdriven:task-spec fix_bug            # Document before fixing
# ... fix bug, update spec ...
/specdriven:spec-lint                    # Validate changes
```

## Architecture

```
SpecDriven Plugin
├── CLAUDE.md                 # Enforces spec-driven behavior in Claude sessions
├── Spec Index                 # YAML frontmatter in each spec + SQLite cache (outside repo)
├── Foundation Skills (1)     # Goal and requirements combined
├── Creation Skills (4)       # Generate specifications interactively
├── Visualization Skills (2)  # Rich terminal visualizations and progress tracking
├── Workflow Skills (6)       # Manage, validate, and orchestrate specs
├── Hooks                     # Automated reminders, progress tracking, and checks
└── Patterns & Templates      # Proven specification patterns
```

### Spec Index (YAML Frontmatter + SQLite)

Each spec file carries its own metadata as YAML frontmatter (id, type, status, links, tags, covers). A per-project SQLite cache (`~/.bonsai/indexes/<hash>/index.db`, stored outside the repo) enables fast queries and graph traversal — always rebuildable from frontmatter.

- **Spec entries**: type, path, status (draft/active/stale/done/deprecated), timestamps
- **Links**: parent/child, depends-on, references, implements relationships
- **Coverage**: maps which specs cover which source directories
- All creation skills auto-register specs and maintain links
- Supports types: goal-and-requirements, architecture-design, module-design, submodule-design, task-spec

### Progress Tracking (`.bonsai/.progress.yaml`)

Persistent workflow progress across sessions:
- Current phase and step status
- Step completion timestamps
- Output file references
- Updated automatically via hooks

### Hooks

- **PostToolUse**: When source code is edited, checks if the module has a spec and reminds to update. Also tracks progress when specification files change.
- **SessionStart**: Reports spec health, goal/requirements status at session start

### Terminal Visualizations

Rich CLI visualizations integrated into all skills:
- **Progress bars**: `[████████░░░░░░░░] 8/14 tasks (57%)`
- **Box formatting**: Unicode box-drawing for summaries and confirmations
- **Architecture diagrams**: ASCII art with component boxes and data flow arrows
- **Side-by-side comparisons**: For evaluating alternative approaches
- **Status indicators**: `[✓] Done  [⊘] Skipped  ▶ Current  [ ] Pending`

## Installation

### Option 1: Load as plugin (recommended)

```bash
# During development — load from local directory
claude --plugin-dir /path/to/specdriven/plugin

# Or reference in your project's .claude/settings.json:
# { "plugins": ["/path/to/specdriven/plugin"] }
```

### Option 2: Copy skills directly

```bash
# Copy skills to your project
mkdir -p /path/to/project/.claude/skills/
cp -r plugin/skills/* /path/to/project/.claude/skills/

# Or globally
cp -r plugin/skills/* ~/.claude/skills/
```

## Design Principles

These skills enforce patterns proven in large-scale AI-generated projects:

- **Goal first**: Define clear goals and requirements before design
- **Specs before code**: Write specifications first, implement second
- **Frontmatter is truth**: Each spec is self-describing via YAML frontmatter; SQLite index is a generated cache
- **Contract-first**: Document what a module DOES before how
- **Exhaustive enumeration**: Every public type, variant, field documented
- **Rationale-driven**: Every design decision includes the "why"
- **Concrete types**: Actual type names, not vague descriptions
- **Limitation honesty**: Document what doesn't work
- **Cross-references**: Specs form a navigable network
- **Freshness enforcement**: Stale specs are flagged and prioritized
- **Visual feedback**: Rich terminal visualizations at every step
- **Workflow orchestration**: `/spec-next` always knows what to do next
