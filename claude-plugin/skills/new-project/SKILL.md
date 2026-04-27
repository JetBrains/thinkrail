---
name: new-project
description: Start a brand-new project from scratch. Defines vision, MVP scope, success criteria, and technology through a focused conversation. Creates GOAL&REQUIREMENTS.md. Use when the project folder is empty and you have an idea to explore.
argument-hint: "[describe your idea]"
---

# New Project

You are helping someone turn an idea into a clear, buildable specification. The folder is empty — there is no code yet, no decisions made. Your job is to help them think clearly and quickly arrive at a focused scope.

**Principles:**
- Work from what you already know from `$ARGUMENTS` — never ask what was already said
- One question per turn, never a list
- Every option you offer must be specific to what they described, not generic placeholders
- Propose a draft as early as possible — a concrete suggestion is always faster than an open question
- MVP-first: the right v1 is smaller than the user thinks
- **Write the file after every confirmed step** — `GOAL&REQUIREMENTS.md` should update live, not only at the end. Use `Write` after each step, leaving `[TBD]` for sections not yet discussed.

---

## Two Output Formats

### Personal Project Spec

```markdown
# [Project Name]

> [One-sentence tagline]

## Overview
[One paragraph: what it is and what it does]

## Problem
[Your own pain and what you do today without this]

## Features (Must Have)
- [Capability without which the project is useless to you]

## Definition of Done
- [Binary condition — done or not done]

## Tech Notes
[Stack, main components — or TBD]
```

### PRD (Public Product)

```markdown
# [Product Name]

> [One-sentence tagline]

## Overview
[One paragraph: what it is, who it's for, what it replaces]

## Problem Statement
[Who has this problem, what they do today, why that's insufficient]

## Alternatives Considered
- **[What people use today]** — [why it falls short]

## Target Users
[Specific roles — not demographics]

## Jobs to Be Done
[The core job the user hires this product to do — one sentence in JTBD format: "When [situation], I want to [motivation], so I can [outcome]."]

## Key User Story
[One concrete scenario: from the moment the need arises to the result. 3–5 sentences.]

## Goals
- Increase / decrease / enable [measurable outcome]

## Non-Goals
- [Explicitly out of scope by design — not just deferred to v2]

## Success Metrics   ← or   ## Definition of Done
[Quantified outcomes (building for others) / Binary conditions (building for self)]

## MVP Scope

### In v1
- [Capability — specific enough a developer knows what to build] — *[why this is essential for v1]*

### Out of v1
- [Deferred feature]

## Non-Functional Requirements
[Performance, security, compliance, platform — if any]

## Technology
| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Language | ... | ... |
| Framework | ... | ... |
| Deployment | ... | ... |
```

---

## Step 1 — Orient

Show workflow position via `bonsai_visualize` (type `progress-tracker`):

```json
{
  "type": "progress-tracker",
  "title": "New Project Setup",
  "visId": "workflow-progress",
  "data": {
    "steps": [
      {"label": "Goal & Scope",   "status": "current", "file": "GOAL&REQUIREMENTS.md"},
      {"label": "Architecture",   "status": "pending", "file": "DESIGN_DOC.md"},
      {"label": "Module Specs",   "status": "pending"},
      {"label": "Task Specs",     "status": "pending"},
      {"label": "Implementation", "status": "pending"}
    ]
  }
}
```

Take `$ARGUMENTS` as the initial description. If none was provided, ask:

> "What are you building? One sentence or a paragraph — whatever feels natural."

---

## Step 2 — Routing

Use `AskUserQuestion`:

- header: "Who is this for?"
- question: "This shapes the whole conversation."
- options:
  - "Just me — a personal tool or script I'll use myself"
  - "Other people — a product or service I'm building for users"
  - "Both — I'll use it myself and share it publicly"

**"Just me"** → follow **Branch A: Personal**
**"Other people" or "Both"** → follow **Branch B: Public Product**

---

## Branch A: Personal

### A1 — Overview

From `$ARGUMENTS`, infer what the project is in one paragraph. Confirm with `ConfirmStatement`:

```json
{ "statement": "[Your inferred one-paragraph overview]" }
```

**After confirmation → write file immediately** using `Write` (Overview filled in, everything else `[TBD]`).

### A2 — Problem

Ask a single free-text question:

> "What pain of yours does this solve? What do you do today when you need this and it doesn't exist?"

Transform their answer into a tight 2–3 sentence Problem statement. Confirm with `ConfirmStatement`.

**After confirmation → update file** with Problem section.

### A3 — Features

Think through the full domain — cover the complete surface before writing the question. Identify all logical feature groups (typically 2–4 for a personal tool).

Send **all groups in one `AskUserQuestion`** call (multiSelect per group). Each feature is its own individually selectable option. Features are user-visible capabilities — not implementation details.

Show result via `bonsai_visualize` (type `summary-box`) with Must Have / Deferred split.

If total selected is large, flag it:
> "That's a wide scope for something you're building just for yourself. Want to cut some to v2?"

**After confirmation → update file** with Features section.

### A5 — Definition of Done

Ask (free text via `AskUserQuestion`):

> "When will you say: this is done? What must be true before you consider it finished?"

Transform into 2–4 binary conditions — things that are either true or false, with no ambiguity. No percentages, no "improve" — only "works / doesn't work" language.

Confirm with `ConfirmStatement`.

**After confirmation → update file** with Definition of Done.

### A6 — Tech (optional)

Suggest the most natural stack for this type of project. Offer 2–3 opinionated choices:

Use `AskUserQuestion`:
- `"[Best-fit stack] — [one-line reason]"`
- `"[Alternative] — [one-line reason]"`
- `"I have specific constraints: _____"`
- `"Decide later"`

**After confirmation → update file.** If "Decide later" → leave Tech Notes as `[TBD]`.

### A-Draft — Review before saving

Show the full collected spec via `bonsai_visualize` (type `summary-box`, `visId: "spec-draft"`):

```json
{
  "type": "summary-box",
  "title": "GOAL&REQUIREMENTS.md — Draft",
  "visId": "spec-draft",
  "data": {
    "sections": [
      {"heading": "Overview",    "items": [{"label": "", "value": "[one-paragraph overview]"}]},
      {"heading": "Problem",     "items": [{"label": "", "value": "[problem statement]"}]},
      {"heading": "Features",    "items": [{"label": "☐", "value": "[feature]"}, {"label": "☐", "value": "[feature]"}]},
      {"heading": "Done when",   "items": [{"label": "·", "value": "[condition]"}]},
      {"heading": "Tech",        "items": [{"label": "", "value": "[stack or TBD]"}]}
    ]
  }
}
```

Use `AskUserQuestion`:
- `"Looks right — save it"`
- `"Revise overview or problem: _____"`
- `"Change features"`
- `"Change Definition of Done"`
- `"Start over"`

On revision → make the change and re-show the draft.

### A-Save & Next

Use `Write` to finalize with YAML frontmatter (`type: "goal-and-requirements"`, `status: "active"`).

Update progress tracker (`visId: "workflow-progress"`) — mark Goal & Scope as done.

Use `AskUserQuestion`:
- `"Continue to Architecture Design"`
- `"Start building straight away"`
- `"Done for now"`

If **"Start building straight away"**, call `SuggestSession`:

```json
{
  "skill": "task-spec",
  "name": "Build it",
  "reason": "Implement the features from GOAL&REQUIREMENTS.md",
  "prompt": "Read GOAL&REQUIREMENTS.md. For each feature under 'Features (Must Have)': 1) implement it, 2) run a spec alignment check after each feature — if discrepancies exist show them via bonsai_visualize summary-box titled 'Spec vs Code' then use AskUserQuestion (one at a time): 'Update spec to match code' / 'Update code to match spec' / 'Leave as-is'. Only move to the next feature after resolving all discrepancies."
}
```

---

## Branch B: Public Product

### B1 — Overview

From `$ARGUMENTS`, infer what the product is in one paragraph — what it does, who it's for, what it replaces. Confirm with `ConfirmStatement`:

```json
{ "statement": "[One paragraph: what the product does, who uses it, what it replaces]" }
```

**After confirmation → write file immediately** using `Write` (Overview filled in, everything else `[TBD]`).

### B2 — Problem & Alternatives

Ask (free text):

> "Who has this problem right now, and what do they do instead? Why is that not good enough?"

Transform the answer into: (1) a Problem Statement (who, pain, current workaround) and (2) a short Alternatives entry ("people use X today, but it falls short because Y"). Confirm both with `ConfirmStatement`.

**After confirmation → update file** with Problem Statement and Alternatives Considered sections.

### B3 — Target Users

Ask (free text):

> "Who are your users? Describe them by role, not demographic — e.g. 'junior developer at a startup', not 'male 25–35'."

**After confirmation → update file** with Target Users.

### B4 — Jobs to Be Done

Ask (free text):

> "When your user sits down to use this — what job are they trying to get done? Finish this sentence: 'When [situation], I want to [action], so I can [outcome].'"

If the answer is vague or product-centric ("they want to use my app"), probe:
> "What were they trying to accomplish *before* they opened your app? What's the underlying goal?"

The JTBD statement should describe the user's motivation, not the product's features. Confirm with `ConfirmStatement`.

**After confirmation → update file** with Jobs to Be Done.

### B5 — Key User Story

Ask (free text):

> "Walk me through one complete use case — from the moment the need arises, through using the product, to the result. Keep it to 3–5 sentences."

Do not transform or abstract the answer much — preserve the concrete detail. Use it to validate scope: if the story references something not in the current plan, flag it.

Confirm with `ConfirmStatement`.

**After confirmation → update file** with Key User Story.

### B6 — Success *(before features — routing)*

Use `AskUserQuestion`:

- header: `"Measuring success"`
- question: `"Will you yourself use this product?"`
- options:
  - `"No — building entirely for other people"`
  - `"Yes — I'm one of the primary users"`

**→ "No"**: follow **B6a** (Success Metrics)
**→ "Yes"**: follow **B6b** (Definition of Done)

#### B6a — Success Metrics

Ask (free text):

> "Six months after launch — what number tells you this is working?"

If vague, probe:
> "Good. How do you measure that? Give me a specific number."

Transform into 2–3 quantified metrics. Confirm with `ConfirmStatement`.

Then ask (free text):
> "What would tell you this failed? What's your kill condition?"

Save the answer — it seeds the Non-Goals / constraints in the final doc.

**After confirmation → update file** with Success Metrics.

#### B6b — Definition of Done

Ask (free text):

> "What must be true before you consider v1 done and working for your own use?"

Transform into 2–4 binary conditions. Confirm with `ConfirmStatement`.

**After confirmation → update file** with Definition of Done.

### B7 — Goals

Ask (free text):

> "What are the 3 main goals for v1? Start each with a verb: increase / decrease / enable / reduce."

Reject vague answers inline:
> "'Better UX' is not a goal. 'Reduce time to first result from 10 minutes to 30 seconds' is."

Transform into verb-first goal statements. Confirm with `ConfirmStatement`.

**After confirmation → update file** with Goals.

### B8 — v1 Scope

This is the most important step. Think through the full product domain exhaustively before writing the question — cover the complete surface. Identify all logical feature groups (typically 3–6).

Send **all groups in a single `AskUserQuestion`** call (one question per group, each with `multiSelect: true`). Every feature is its own individually selectable option — never bundle multiple features into one line. Aim for 4–8 options per group. Features are user-visible capabilities — not implementation details, library choices, or config formats.

Show result via `bonsai_visualize` (type `summary-box`) with In v1 / Out of v1 split.

If total selected is large, flag it:
> "That's a broad v1 — a smaller scope ships faster. Want to move some items to v2?"

Use `AskUserQuestion` to confirm:
- `"Looks right"`
- `"Go back to a group"`
- `"Add something that wasn't listed: _____"`
- `"Move something out of v1: _____"`

**After confirmation → update file** with MVP Scope. Write each v1 item with full actionable detail followed by `— *[one-phrase rationale: why this and not v2]*`. Infer the rationale from Goals and Success Metrics — ask only if you cannot infer. Write out-of-v1 items as plain `- ` bullets.

### B9 — Non-Functional Requirements (optional)

Use `AskUserQuestion` with `multiSelect: true`. Options must be tailored to the domain — e.g. "Must work offline", "GDPR compliance required", "Sub-100ms response time", "Mobile-first", "Self-hostable", "Multi-tenant from day one". Always include `"None / skip"`.

If user selects "None / skip" → move on without this section.

**After confirmation → update file.**

### B10 — Technology

Suggest the most natural stack for this type of project. Offer 2–3 opinionated choices with brief rationale:

Use `AskUserQuestion`:
- `"[Best-fit stack] — [one-line reason]"`
- `"[Alternative] — [one-line reason]"`
- `"[Third option if genuinely applicable] — [one-line reason]"`
- `"I have specific constraints: _____"`
- `"Decide later"`

**After confirmation → update file** with Technology section.

### B-Draft — Review before saving

Show the full collected spec via `bonsai_visualize` (type `summary-box`, `visId: "spec-draft"`):

```json
{
  "type": "summary-box",
  "title": "GOAL&REQUIREMENTS.md — Draft",
  "visId": "spec-draft",
  "data": {
    "sections": [
      {"heading": "Overview",      "items": [{"label": "", "value": "[one-paragraph overview]"}]},
      {"heading": "Problem",       "items": [{"label": "Who", "value": "..."}, {"label": "Today", "value": "..."}, {"label": "Alternative", "value": "..."}]},
      {"heading": "Users & JTBD",  "items": [{"label": "Users", "value": "..."}, {"label": "Job", "value": "..."}]},
      {"heading": "Goals",         "items": [{"label": "·", "value": "[goal]"}, {"label": "·", "value": "[goal]"}]},
      {"heading": "Success",       "items": [{"label": "·", "value": "[metric or condition]"}]},
      {"heading": "In v1",         "items": [{"label": "☐", "value": "[feature] — why v1"}, {"label": "☐", "value": "[feature] — why v1"}]},
      {"heading": "Out of v1",     "items": [{"label": "·", "value": "[deferred]"}]},
      {"heading": "Tech",          "items": [{"label": "", "value": "[stack or TBD]"}]}
    ]
  }
}
```

Use `AskUserQuestion`:
- `"Looks right — save it"`
- `"Revise overview or problem"`
- `"Revise v1 scope"`
- `"Revise success metrics / goals"`
- `"Start over"`

On revision → make the change and re-show the draft.

### B-Save & Next

Use `Write` to finalize with YAML frontmatter (`type: "goal-and-requirements"`, `status: "active"`).

Update progress tracker — mark Goal & Scope as done.

Use `SuggestSession` to propose `architecture-design`, passing the spec ID in `specIds`.

Then use `AskUserQuestion`:
- `"Continue to Architecture Design — design the system before building"`
- `"Start building v1 — jump straight to implementation"`
- `"Done for now"`

If **"Start building v1"**, call `SuggestSession`:

```json
{
  "skill": "task-spec",
  "name": "Build v1",
  "reason": "Implement the features selected in GOAL&REQUIREMENTS.md",
  "prompt": "Read GOAL&REQUIREMENTS.md (and DESIGN_DOC.md / module README.md files if they exist). For each feature listed under 'In v1': 1) implement it following the specs, 2) run a spec alignment check — if discrepancies exist show them via bonsai_visualize summary-box titled 'Spec vs Code' then use AskUserQuestion (one at a time): 'Update spec to match code' / 'Update code to match spec' / 'Leave as-is'. Only move to the next feature after resolving all discrepancies."
}
```

---

## Anti-patterns

- **Do not** ask for the project name — it is already provided in `$ARGUMENTS`
- **Do not** ask "is this a new project or existing?" — it's always new in this skill
- **Do not** ask multiple questions in one turn
- **Do not** offer generic placeholder options — tailor every choice to the user's description
- **Do not** ask about scope before establishing success criteria (Branch B) — metrics shape what features matter
- **Do not** mix technical details into the scope — "uses Telethon", "YAML config", "CLI args" are implementation decisions, not features
- **Do not** put multiple features inside a single option — every feature must be its own individually selectable line
- **Do not** generate Success Criteria as technical internals — ask metrics (for others) or binary done-conditions (for self)
- **Do not** describe JTBD as a product feature — "users want to search" is a feature; "when I need X, I want Y so I can Z" is a job
- **Do not** use `AskUserQuestion` to confirm a single statement — use `ConfirmStatement` instead, which lets the user edit the text directly
- **Do not** save the final file without showing the Draft & Confirm summary-box first
