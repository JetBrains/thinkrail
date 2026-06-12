# ThinkRail — Claude Code Specification-Driven Development Plugin

A complete specification-driven development system for Claude Code. Provides skills (slash commands), a spec registry, workflow orchestration, hooks, rich terminal visualizations, and validation tools to ensure your project is always guided by and consistent with its specifications.

## Quick Start

```bash
# Use during development
claude --plugin-dir ./plugin

# Then in Claude Code:
/thinkrail:spec-init MyProject
/thinkrail:goal-and-requirements  # Define goal and requirements
```

## Plugin Structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest (name, version, description)
├── skills/                      # 20 skill definitions
│   ├── goal-and-requirements/SKILL.md  # Goal + requirements (GOAL&REQUIREMENTS.md)
│   ├── new-project/SKILL.md     # Brand-new project bootstrap
│   ├── thinkrail-brainstorm/SKILL.md  # Brainstorm new features end-to-end
│   ├── architecture-design/SKILL.md
│   ├── module-design/SKILL.md
│   ├── submodule-design/SKILL.md
│   ├── task-spec/SKILL.md
│   ├── bug-fix/SKILL.md         # Reactive bug-fix flow (spec edit + code-fix hand-off)
│   ├── spec-init/SKILL.md
│   ├── spec-status/SKILL.md
│   ├── spec-next/SKILL.md
│   ├── spec-from-code/SKILL.md
│   ├── spec-lint/SKILL.md
│   ├── spec-review/SKILL.md
│   ├── ticket-describe/SKILL.md
│   ├── ticket-specify/SKILL.md
│   ├── ticket-plan/SKILL.md
│   ├── ticket-execute/SKILL.md
│   ├── visualization/SKILL.md   # Terminal visualization toolkit
│   └── cli-progress/SKILL.md   # CLI progress tracking
├── hooks/
│   └── hooks.json               # PostToolUse and SessionStart hooks
└── README.md
```

## Skills Overview

### Foundation Skills (2 skills)

| Skill | Command | Purpose |
|-------|---------|---------|
| Goal & Requirements | `/thinkrail:goal-and-requirements` | Define project goal, requirements, and tech stack — creates GOAL&REQUIREMENTS.md |
| New Project | `/thinkrail:new-project` | Bootstrap a brand-new project: vision, MVP scope, success criteria, and technology stack |

### Brainstorming (1 skill)

| Skill | Command | Purpose |
|-------|---------|---------|
| ThinkRail Brainstorm | `/thinkrail:thinkrail-brainstorm` | Translate user intent into product + technical design + spec diff for new features or behavioural changes |

### Specification Creation (4 skills)

| Skill | Command | Purpose |
|-------|---------|---------|
| Architecture Design | `/thinkrail:architecture-design` | Create DESIGN_DOC.md — pipeline diagrams, data flow, decisions |
| Module Design | `/thinkrail:module-design` | Module README.md — API docs, contracts, internals |
| Sub-Module Design | `/thinkrail:submodule-design` | Focused docs for algorithms and sub-components |
| Task Specification | `/thinkrail:task-spec` | Actionable bug fix / feature implementation specs |

### Visualization Skills (2 skills)

| Skill | Command | Purpose |
|-------|---------|---------|
| Visualization | `/thinkrail:visualization` | Terminal visualization toolkit — ASCII diagrams, box formatting, progress indicators |
| CLI Progress | `/thinkrail:cli-progress` | Workflow progress tracking — phase visualization, milestone dashboards |

### Workflow and Tooling (6 skills)

| Skill | Command | Purpose |
|-------|---------|---------|
| Initialize | `/thinkrail:spec-init` | Set up spec-driven development — directories, registry, CLAUDE.md |
| Status | `/thinkrail:spec-status` | Dashboard — coverage, freshness, gaps, health |
| Next | `/thinkrail:spec-next` | Suggest what to specify next based on gaps and priorities |
| From Code | `/thinkrail:spec-from-code` | Reverse-engineer spec skeletons from existing code |
| Lint | `/thinkrail:spec-lint` | Validate spec structure, links, completeness |
| Review | `/thinkrail:spec-review` | Deep review of spec accuracy against code |

### Ticket Workflow (4 skills)

| Skill | Command | Purpose |
|-------|---------|---------|
| Ticket Describe | `/thinkrail:ticket-describe` | Help formulate a structured meta-ticket (What / Purpose / How / Success Criteria) |
| Ticket Specify | `/thinkrail:ticket-specify` | Create or modify specifications for a meta-ticket |
| Ticket Plan | `/thinkrail:ticket-plan` | Produce an ordered implementation plan from linked specs |
| Ticket Execute | `/thinkrail:ticket-execute` | Orchestrate execution of a meta-ticket's plan and track progress |

### Bug & Triage (1 skill)

| Skill | Command | Purpose |
|-------|---------|---------|
| Bug Fix | `/thinkrail:bug-fix` | Reactive bug-fix flow — edit existing specs (or bootstrap one) to capture correct intent for an observed bug, then suggest a code-fix session |

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
/thinkrail:spec-init MyProject          # 1. Scaffold directories and registry
/thinkrail:goal-and-requirements        # 2. Define goal and requirements (GOAL&REQUIREMENTS.md)
/thinkrail:architecture-design          # 3. Document architecture
/thinkrail:module-design src/core       # 4. Specify each module
/thinkrail:task-spec add_auth           # 5. Create implementation tasks
# ... implement guided by specs ...
/thinkrail:spec-lint                    # 6. Validate everything
```

### Existing Codebase

```
/thinkrail:spec-init MyProject          # 1. Set up tracking
/thinkrail:goal-and-requirements        # 2. Define goal and requirements
/thinkrail:spec-from-code               # 3. Generate spec skeletons from code
/thinkrail:spec-status                  # 4. See coverage gaps
/thinkrail:spec-next                    # 5. Get prioritized recommendations
# ... fill gaps ...
/thinkrail:spec-lint                    # 6. Validate
```

### Ongoing Development

```
/thinkrail:cli-progress                 # Check workflow progress
/thinkrail:spec-status                  # Check health
/thinkrail:spec-next                    # What needs attention?
/thinkrail:spec-review src/parser       # Deep review of specific module
/thinkrail:task-spec fix_bug            # Document before fixing
# ... fix bug, update spec ...
/thinkrail:spec-lint                    # Validate changes
```

## Architecture

```
ThinkRail Plugin
├── CLAUDE.md                 # Enforces spec-driven behavior in Claude sessions
├── Spec Index                 # YAML frontmatter in each spec + SQLite cache (outside repo)
├── Foundation Skills (2)     # Goal & requirements + new-project bootstrap
├── Brainstorming (1)         # End-to-end design for new features
├── Creation Skills (4)       # Generate specifications interactively
├── Visualization Skills (2)  # Rich terminal visualizations and progress tracking
├── Workflow Skills (6)       # Manage, validate, and orchestrate specs
├── Ticket Workflow (4)       # Describe / specify / plan / execute meta-tickets
├── Bug & Triage (1)          # Reactive bug-fix with spec-first philosophy
├── Hooks                     # Automated reminders, progress tracking, and checks
└── Patterns & Templates      # Proven specification patterns
```

### Spec Index (YAML Frontmatter + SQLite)

Each spec file carries its own metadata as YAML frontmatter (id, type, status, links, tags, covers). A per-project SQLite cache (`~/.tr/indexes/<hash>/index.db`, stored outside the repo) enables fast queries and graph traversal — always rebuildable from frontmatter.

- **Spec entries**: type, path, status (draft/active/stale/done/deprecated), timestamps
- **Links**: parent/child, depends-on, references, implements relationships
- **Coverage**: maps which specs cover which source directories
- All creation skills auto-register specs and maintain links
- Supports types: goal-and-requirements, architecture-design, module-design, submodule-design, task-spec

### Progress Tracking (`.tr/.progress.yaml`)

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
claude --plugin-dir /path/to/thinkrail/plugin

# Or reference in your project's .claude/settings.json:
# { "plugins": ["/path/to/thinkrail/plugin"] }
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
