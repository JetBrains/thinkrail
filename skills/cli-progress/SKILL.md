---
name: cli-progress
description: Show and track specification-driven development progress. Displays phase progress, milestone completion, and workflow status with rich terminal visualizations. Use at the beginning of any phase or to check overall progress.
---

# CLI Progress Tracker

You are the **progress tracker** for specification-driven development. You display rich progress visualizations at the beginning of each phase and on demand.

## IMPORTANT: Interaction Style

- This skill can be invoked directly or called by other skills
- When invoked, immediately read project state and render progress
- Use the **AskUserQuestion** tool to offer next actions
- Apply colors from the `/specdriven:visualisation` Color Output Guide when rendering (ANSI codes for dark theme)

## Progress File

Track progress in `.specs/.progress.yaml`:

```yaml
project: [name]
phase: [goal|requirements|specification|implementation]
started: [ISO timestamp]
updated: [ISO timestamp]
workflow:
  status: [pending|in_progress|completed]
  steps:
    - name: [step-name]
      status: [pending|in_progress|completed|skipped]
      started_at: [timestamp]
      completed_at: [timestamp]
      outputs: [list of created files]
```

## Phase Progress Visualization

### Main Workflow Progress

Show at the beginning of each phase and after each step completes:

```
┌─────────────────────────────────────────────────────┐
│         Specification-Driven Development Progress   │
├─────────────────────────────────────────────────────┤
│ STEP                          Output(s)             │
├─────────────────────────────────────────────────────┤
│ [✓] 1. Goal & Requirements    GOAL&REQUIREMENTS.md  │
│  ▶ 2. Architecture           DESIGN_DOC.md         │
│ [ ] 3. Module Specs           src/*/README.md       │
│ [ ] 4. Task Specs             current_tasks/        │
└─────────────────────────────────────────────────────┘

Legend: [✓] Done  [⊘] Skipped   ▶  Current  [✗] Failed  [ ] Pending
```

For skipped steps, use ANSI strikethrough:
- Text between `\e[9m` and `\e[m` renders as strikethrough

### Milestone Progress Dashboard

Show detailed progress when multiple tasks exist:

```
Implementation Progress Dashboard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Overall: [████████░░░░░░░░] 8/14 tasks (57%)

By Milestone:
[✓] Project Setup       3/3   [████████████]
[~] Core Functionality  4/5   [█████████░░░]
[ ] Integration         0/3   [░░░░░░░░░░░░]
[ ] Testing             0/2   [░░░░░░░░░░░░]
[ ] Documentation       0/1   [░░░░░░░░░░░░]

By Priority:
Required: 7/10 (70%)  [███████░░░]
Optional: 1/4  (25%)  [██░░░░░░░░]

Current Task: [task description]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Specification Coverage Progress

Show spec coverage from registry:

```
╔════════════════════════════════════════════════════════╗
║ SPECIFICATION COVERAGE                                 ║
╠════════════════════════════════════════════════════════╣
║                                                        ║
║ Coverage: [██████░░░░] 60% (6/10 modules)              ║
║                                                        ║
║ Specs:  Total:  8  Active: 5  Stale: 2  Draft: 1       ║
║ Tasks:  Active: 3  Completed: 5  Pending: 2            ║
║                                                        ║
║ Module Coverage:                                       ║
║ [✓] src/core/         README.md (active)               ║
║ [✓] src/parser/       README.md (active)               ║
║ [~] src/auth/         README.md (stale)                ║
║ [ ] src/database/     — no spec —                      ║
║ [ ] src/api/          — no spec —                      ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
```

## Process

### Step 1: Read project state

1. Read `.specs/.progress.yaml` (if exists)
2. Read `.specs/registry.json` (if exists)
3. Scan for `GOAL&REQUIREMENTS.md`
4. Check for specification files (DESIGN_DOC.md)
5. Check for task files in `current_tasks/`

### Step 2: Determine current phase

Based on what exists:
- No GOAL&REQUIREMENTS.md → Phase: Goal & Requirements
- No DESIGN_DOC.md → Phase: Architecture Design
- Missing module specs → Phase: Module Specification
- All specs exist → Phase: Implementation / Maintenance

### Step 3: Render progress visualization

Show the appropriate progress visualization based on current phase.

Always include:
1. **Phase progress** — the main workflow steps with status
2. **Current position** — where the user is now
3. **What's next** — suggested next step

### Step 4: Update progress file

If `.specs/.progress.yaml` doesn't exist, create it.
Update with current state.

### Step 5: Offer actions

Use AskUserQuestion:

**How should we proceed?**
- "Continue to [next step name] (Recommended)"
- "Skip [next step] and continue with [step after next]"
- "Skip all up to [next mandatory step]"
- "Review completed steps"

## Workflow Presets

When starting a new project, offer workflow presets (inspired by bonsai):

```
How do you want to proceed?
- [ ] Full    : Goal & Requirements -> Architecture -> Modules -> Tasks
- [ ] Simple  : Goal & Requirements -> Architecture -> Tasks
- [ ] Minimal : Goal & Requirements -> Architecture
```

## Integration with Other Skills

Other skills should call upon these visualization patterns:

1. **Before starting**: Show phase progress with current step highlighted
2. **After completing**: Update progress and show updated visualization
3. **On error/skip**: Mark step accordingly and show updated progress

## After Completion

Use AskUserQuestion:

**What's next?**
- "[Continue to next step] (Recommended)"
- "/spec-status — Detailed coverage report"
- "/visualisation — Full project dashboard"
- "Done for now"

## Key Principles

- **Always show context**: User should always know where they are in the workflow
- **Non-blocking**: Progress display should be quick and not interrupt workflow
- **Persistent**: Progress is tracked in `.specs/.progress.yaml` across sessions
- **Accurate**: Always read actual file state, don't rely solely on cached progress
