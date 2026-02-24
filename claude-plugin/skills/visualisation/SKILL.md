---
name: visualisation
description: Utility skill for generating rich terminal visualizations in CLI. Provides patterns for ASCII diagrams, box formatting, progress indicators, architecture views, and side-by-side comparisons. Other skills reference this for consistent visual output.
---

# Terminal Visualisation Toolkit

You are a **visualization utility** for specification-driven development. Use these patterns whenever presenting information to the user in the CLI. All other skills should apply these patterns for consistent, clear visual output.

## IMPORTANT: When to Use

- This skill is invoked **automatically by other skills** when they need visualizations
- It can also be invoked **directly** to visualize existing specifications
- If invoked directly: read the current `.specs/` state and render an appropriate dashboard

## Color Output Guide

When rendering visualizations, apply ANSI color codes to make output more readable on dark terminal backgrounds. Wrap each colored segment with the appropriate code and always reset with `\e[0m` after.

**Color Reference:**

| Element | Color | ANSI Code | Description |
|---------|-------|-----------|-------------|
| Titles / Headers | Bold Cyan | `\e[1;36m` | Section titles, box headers |
| Box Borders | Cyan | `\e[36m` | `╔═╗ ┌─┐ ┏━┓` box-drawing characters |
| `[✓]` Done | Bold Green | `\e[1;32m` | Completed items, success, "saved" messages |
| `▶` Current | Bold Yellow | `\e[1;33m` | Current step marker, in-progress items |
| `[✗]` Failed | Bold Red | `\e[1;31m` | Failed items, errors, critical issues |
| `⚠` Warning | Yellow | `\e[33m` | Consistency issues, caution messages |
| `[⊘]` Skipped | Dim + Strikethrough | `\e[2;9m` | Skipped or cancelled items |
| `[ ]` Pending | Dark Gray | `\e[90m` | Not-yet items, inactive elements |
| File paths | Blue | `\e[34m` | File references, links |
| `>>> THIS <<<` | Bold Magenta | `\e[1;35m` | Active focus, highlighted component |
| `[HIGH]` priority | Bold Red | `\e[1;31m` | High priority tags |
| `[MED]` priority | Bold Yellow | `\e[1;33m` | Medium priority tags |
| `[LOW]` priority | Blue | `\e[34m` | Low priority tags |
| Labels / Keys | Bold White | `\e[1m` | Field names, table headers |
| Progress filled | Green | `\e[32m` | `████` or 🟩 filled portion of progress bar |
| Progress empty | Dark Gray | `\e[90m` | `░░░░` or ⬛ empty portion of progress bar |
| Reset | — | `\e[0m` | End of any colored segment |

**How to apply:** Wrap text with the ANSI code before it and `\e[0m` after. Example: `\e[1;32m[✓]\e[0m` renders a green checkmark. Always reset after each colored segment to prevent color bleeding.

**Fallback:** If the terminal does not support ANSI colors, the output remains readable because the symbols (`[✓]`, `▶`, `[ ]`, etc.) carry meaning on their own.

## Visualization Patterns

### 1. Box Formatting

Use Unicode box-drawing characters for structured data display:

**Double-line box** (for summaries and confirmations):
```
╔════════════════════════════════════════════════════════╗
║ TITLE                                                  ║
╠════════════════════════════════════════════════════════╣
║ Content line 1                                         ║
║ Content line 2                                         ║
╚════════════════════════════════════════════════════════╝
```

**Single-line box** (for progress and status):
```
┌─────────────────────────────────────────────────────┐
│ Title                                               │
├─────────────────────────────────────────────────────┤
│ Content                                             │
└─────────────────────────────────────────────────────┘
```

**Heavy-line box** (for highlighting current focus):
```
┏━━━━━━━━━━━━┓
┃>>> THIS <<<┃  <-- Currently active element
┃ Component  ┃
┗━━━━━┳━━━━━━┛
```

### 2. Architecture Diagrams

Use ASCII art for system architecture visualization:

```
┌──────────────────┐
│      User        │
└─────┬────────────┘
      ↑
      | input/output
      ↓
┌─────┴────────┐
│ CLI Interface│<──────────────────────────────┐
└──────┬───────┘                               |
       │  data flow label                      |
       ↓                                       |
┌──────────────┐        ┌──────────────┐       |
│ Component A  ├───────>│ Component B  │       |
└──────┬───────┘        └──────────────┘       |
       │                                       |
       ↓                                       |
┌──────────────────┐  result                   |
│ Component C      ├──────────────────────────-┘
└──────────────────┘
```

**Rules for architecture diagrams:**
- Use `┌─┐└─┘│─` for standard component boxes
- Use `┏━┓┗━┛┃━` for highlighted/active components
- Use `↑ ↓ ← → ↔` for data flow arrows
- Label arrows with data type/format
- Keep 5-10 components maximum
- Show primary data flow top-to-bottom or left-to-right

### 3. Side-by-Side Comparison

For presenting alternative approaches:

```
#1 [Approach Name]                   ║  #2 [Approach Name]
                                     ║
[ASCII diagram 1]                    ║  [ASCII diagram 2]
                                     ║
**Component Name**                   ║  **Component Name**
  - Purpose: [short]                 ║    - Purpose: [short]
  - Input: [what]                    ║    - Input: [what]
  - Output: [what]                   ║    - Output: [what]
                                     ║
**Key Technologies**                 ║  **Key Technologies**
  - [tech 1]                         ║    - [tech 1]
  - [tech 2]                         ║    - [tech 2]
```

If approaches don't fit side-by-side, show them sequentially with clear separators:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Approach #1: [Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Visualization and details]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Approach #2: [Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Visualization and details]
```

### 4. Section Headers

Use line separators for section breaks:

```
Section Title
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 5. Status Indicators

Use consistent symbols:

| Symbol | Meaning |
|--------|---------|
| `[✓]` | Completed / Done |
| `[⊘]` | Skipped |
| ` ▶ ` | Current / In Progress |
| `[ ]` | Pending |
| `[✗]` | Failed |
| `[~]` | Partially done |
| `○` | Optional |
| `●` | Required |

### 6. Progress Bars

For showing completion:

```
[████████░░░░░░░░] 8/14 tasks (57%)
```

Construction rules:
- Full block: `█` for completed portion
- Empty block: `░` for remaining portion
- Total width: 16 characters between brackets
- Show count and percentage after

### 7. Data Flow Visualization

For showing step-by-step flows:

```
[User] → [Input: "data"] → [Processor] → [Output: "result"] → [User]
                              |
                              v
                         [Validation]
                              |
                              v (valid)
                         [Transform]
```

### 8. Table Formatting

For structured data:

```
║ Column 1     ║ Column 2        ║ Column 3   ║
║──────────────║─────────────────║────────────║
║ Value 1      ║ Value 2         ║ Value 3    ║
║ Value 4      ║ Value 5         ║ Value 6    ║
```

### 9. Strikethrough Text

For skipped or cancelled items, use ANSI escape codes:
- `\e[9m` text `\e[m` renders as strikethrough in terminal

### 10. Requirement Priority Tags

```
[HIGH] ║ Requirement description
[MED]  ║ Requirement description
[LOW]  ║ Requirement description
```

## Direct Invocation

When invoked directly (`/specdriven:visualisation`):

### Step 1: Detect what to visualize

Read project state:
1. Check for `.specs/registry.json`
2. Check for `GOAL&REQUIREMENTS.md`
3. Check for architecture specs (DESIGN_DOC.md)
4. Check for `.specs/.progress.yaml`

### Step 2: Render dashboard

Show a combined visual dashboard of all available project state:

```
╔════════════════════════════════════════════════════════╗
║ PROJECT DASHBOARD                                      ║
╠════════════════════════════════════════════════════════╣
║                                                        ║
║ Goal & Requirements: [from GOAL&REQUIREMENTS.md or "Not defined"] ║
║   [HIGH] count  [MED] count  [LOW] count               ║
║                                                        ║
║ Specifications:                                        ║
║   Coverage: [██████░░░░] 60%                           ║
║   Total: N  Active: N  Stale: N  Draft: N              ║
║                                                        ║
║ Architecture: [Defined / Not defined]                  ║
║ Modules: N specified / M total                         ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
```

### Step 3: Offer actions

Use AskUserQuestion:

**What would you like to visualize?**
- "Architecture diagram" — Render from DESIGN_DOC.md
- "Requirements summary" — Render from GOAL&REQUIREMENTS.md
- "Specification coverage map" — Render from registry
- "Done"

## Key Principles

- **Consistency**: Always use the same symbols and patterns across all skills
- **Clarity**: Visualizations should make complex information easier to understand
- **Brevity**: Keep diagrams focused — don't overload with detail
- **Accessibility**: ASCII art should be readable in any terminal
- **Context**: Always show relevant context (what phase, what step, what's next)
