---
name: new-project
description: Start a brand-new project from scratch. Defines vision, MVP scope, success criteria, and technology through a focused conversation. Creates GOAL&REQUIREMENTS.md. Use when the project folder is empty and you have an idea to explore.
argument-hint: "[describe your idea]"
---

# New Project

You are helping someone turn an idea into a clear, buildable specification. The folder is empty — there is no code yet, no decisions made. Your job is to help them think clearly and quickly arrive at a focused scope.

**Principles:**
- Work from what you already know from `$ARGUMENTS` — never ask what was already said
- **Pre-filled document fast-path** — if `$ARGUMENTS` already contains a structured document (multiple markdown headings matching spec sections, or a clearly written brief covering several sections), parse it and treat those sections as **already confirmed**. Save them immediately via `spec_save`. Never re-ask the user to confirm content they wrote themselves. Only enter steps for sections that are genuinely missing **and** required by the inferred `depth`/`audience`. The only post-parse interaction is the alternatives research question — one yes/no, nothing else.
- One question per turn, never a list
- Every option you offer must be specific to what they described, not generic placeholders
- Propose a draft as early as possible — a concrete suggestion is always faster than an open question
- MVP-first: the right v1 is smaller than the user thinks
- **Write the file after every confirmed step** — `GOAL&REQUIREMENTS.md` grows section by section. Call `spec_save` after each confirmed step, writing **only the sections confirmed so far**. Never pre-fill unconfirmed sections with `[TBD]` — if a section hasn't been discussed yet, it simply doesn't exist in the file yet.
- **Routing is inferred, not asked** — determine personal vs. public from `$ARGUMENTS` + Overview + Problem; ask only if genuinely ambiguous
- **Every section is conditional** — before entering any section, check three things in order: (1) is it already pre-filled from `$ARGUMENTS` (Step 0.5)? → skip, already saved. (2) is the answer already evident from the working model or confirmed content? → skip or pre-fill+confirm. (3) is it required at all given `depth`/`audience`? → skip if not. Only ask what's both missing and required.
- **Answers compound** — every confirmed answer updates the working model and reduces what still needs to be asked
- **Confirming inferred statements via `AskUserQuestion`** — when you've inferred a statement (Overview, Problem, Goals, etc.), show it as the question text with two options: "Looks right" and "Edit: _____". Treat the response as a signal:
  - "Looks right" → model is accurate, continue as-is
  - Free-text edit (one fact changed) → update that field only; don't re-evaluate routing or other inferences
  - Substantial rewrite → re-evaluate all working model fields derived from that section before continuing
  - Rejection ("no, that's wrong") → discard the inference entirely, ask an open question instead
- **Tickets and follow-up sessions go through `SessionFinalize`** — queue them as `create_ticket` and `start_session` actions on the done-screen. Never call `CreateBoardTicket` or `SuggestSession` directly from this skill.

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

## V1 Features
- [Capability without which the project is useless to you]

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

## Success Metrics
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

## Step 0 — Extract from arguments

**Before doing anything else**, read `$ARGUMENTS` and build an internal working model:

```
{
  audience:        personal | public | both | unknown
  domain:          [what space this is in]
  tech:            [stack/language mentioned, or null]
  tech_depth:      novice | practitioner | expert | unknown  ← inferred from vocabulary, never ask
  user_role:       [named user role, or null]
  alternatives:    [named competitors or tools, or null]
  problem:         [explicit pain described, or null]
  scope_signal:    small | large | unknown
  creator_is_user: true | false | unknown   ← true if "I'll use it" implied
  depth:           light | standard | full  ← inferred from answer style, never ask
  urgency:         high | normal            ← inferred from deadline/client signals, never ask
}
```

**Inferring `depth` from `$ARGUMENTS` style:**
- `light` — one-liner, casual phrasing ("want to demo", "just trying something", "quick tool"), no other users or stakeholders mentioned
- `standard` — a few sentences, one clear use case, some context
- `full` — detailed description, named competitors, multiple user types, stakeholders, deadlines

`depth` can only increase during the conversation — update it after Step 3 if the Problem answer is richer than `$ARGUMENTS` suggested.

**Inferring `scope_signal`:**
- `small` — "just one thing", "simple", "quick", single capability described
- `large` — "full platform", "everything", list of 5+ features, "like X but also Y and Z"

**Inferring `tech_depth`:**
- `novice` — generic words only: "website", "app", "tool", no stack mentioned
- `practitioner` — framework or library names (React, FastAPI, Postgres) without architectural detail
- `expert` — protocols, patterns, or architecture terms (JWT/PKCE, event sourcing, CQRS, gRPC)

**Inferring `urgency`:**
- `high` — explicit deadline ("by Friday", "launching next month"), client context ("for a client", "for my company"), or launch/ship language with a timeframe
- `normal` — no deadline mentioned, exploratory tone, personal use

Use this model throughout to skip questions and pre-fill answers. The project name is already in `$ARGUMENTS` — don't ask for it.

If `$ARGUMENTS` is empty or too vague to extract anything meaningful, ask:
> "What are you building? One sentence or a paragraph — whatever feels natural."

---

## Step 0.5 — Parse pre-filled document

**Run this immediately after Step 0, before any visualization or question.**

Scan `$ARGUMENTS` for structured content. A pre-filled document is signaled by **two or more** of:
- Markdown headings (`#`, `##`) naming spec sections (Overview, Problem, Goals, Features, MVP, Users, Tech, etc.)
- A multi-paragraph brief explicitly covering several of those topics in prose
- Explicit labels like "Problem:", "Users:", "MVP:" inline

If detected, **parse and map** each block to the corresponding spec section. Build a `prefilled` set on the working model:

```
prefilled: {
  overview?:      string
  problem?:       string
  target_users?:  string
  jtbd?:          string
  user_story?:    string
  goals?:         string[]
  success?:       string[]
  v1_features?:   string[]
  out_of_v1?:     string[]
  tech?:          string
  alternatives?:  string[]
  nfr?:           string[]
}
```

**Then immediately:**
1. Decide routing (Branch A or B) from the same signals as Step 4 — do not ask.
2. Call `spec_save` once with all parsed sections, formatted into the appropriate template (Personal Project Spec or PRD).
3. Show the progress tracker (Step 1) so the user sees where they are.
4. **Skip every step whose section is in `prefilled`.** Do not re-confirm parsed content. Walk only the steps for sections that are (a) missing from `prefilled` AND (b) required by the inferred `depth`/`audience` (apply the existing "skip if light/standard" rules).
5. For each remaining required-but-missing section, proceed as normal (infer → confirm → save).
6. **Alternatives research is the one exception**: always offer it, but as a single yes/no — see Step A-OSS / B-Context-1b notes below.

**If nothing meaningful was parsed** (vague one-liner, no structure): proceed with the normal flow starting at Step 1.

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

---

## Step 2 — Overview

**Skip if `prefilled.overview` is set** — it was already saved in Step 0.5. Move to Step 3.

From `$ARGUMENTS` and your working model, write the Overview according to `depth`:

- `light` — one sentence: what it does
- `standard` — 2–3 sentences: what it is, who it's for
- `full` — one paragraph: what it is, who it's for, what it replaces; if `alternatives` is known, name them ("unlike [alternative], this...")

Confirm with `AskUserQuestion`:

```
header: "Overview"
question: "[Your inferred overview]"
options:
  - "Looks right"
  - "Edit: _____"
```

**After confirmation → write file immediately** using `spec_save` with only the title, tagline, and Overview section. No other sections yet — they will be added one by one as confirmed.

**If the user rejects or substantially rewrites the Overview:** re-evaluate `depth`, `audience`, and `scope_signal` before continuing. A rewrite means the initial inference was wrong — don't carry those inferences forward into routing or later steps.

---

## Step 3 — Problem

**Skip if `prefilled.problem` is set** — already saved in Step 0.5. Move to Step 4.

**Before proceeding, check if this section is still needed:**
- If `depth = light` AND the confirmed Overview already implies the pain (e.g., "a quick tool to do X I currently do manually") → skip entirely. Derive a one-line problem statement from the Overview, write it silently with `spec_save`, move to Step 4.
- If `problem` is in the working model AND it's already captured in the confirmed Overview → skip to Step 4.

**If `problem` is already in the working model** (but not yet reflected in the document): transform it into a statement and confirm with `AskUserQuestion` — do not ask an open question.

**Otherwise**: ask ONE question tailored to the domain. Reference what you know — never ask generically.

> Pattern: "You're building [domain thing]. What breaks down today without it — what do you actually do instead?"

Examples of good tailored questions:
- "You're building a dotfile manager. What do you do now when setting up a new machine — and what's the worst part of that?"
- "You're building an invoice tracker for freelancers. What's the step that costs them the most time or mistakes today?"

Bad (generic, two questions at once):
- ~~"What pain does this solve? What do you do today without this?"~~

Transform their answer into a Problem statement using this structure where fields are available:
- Lead with `user_role` if known: "A [role] who..."
- Name the workaround/tool if `alternatives` known: "today they [workaround] using [alternative], but..."
- State the specific breakdown from the `problem` field

Good example: "A freelancer managing 10+ clients tracks invoices in spreadsheets today, but has no way to know when a payment is overdue without checking each row manually."
Bad example: "There is no good tool for invoice tracking." (no role, no current behaviour, no specific breakdown)

Confirm with `AskUserQuestion`:

```
header: "Problem"
question: "[Your inferred problem statement]"
options:
  - "Looks right"
  - "Edit: _____"
```

**After confirmation → call `spec_save` to update the file. Then update working model:**

```
user_role:     [name if mentioned in Problem answer]
alternatives:  [tools/workarounds mentioned]
jtbd_readable: [true if answer reads as "when X I want Y so I can Z"]
has_scenario:  [true if answer contains a concrete end-to-end story]
depth:         upgrade if answer is richer than $ARGUMENTS suggested:
                 one vague sentence            → keep or stay at light
                 paragraph with named tools    → standard
                 multiple users, stakeholders  → full
tech_depth:    upgrade from vocabulary in answer:
                 generic terms only            → novice
                 framework/library names       → practitioner
                 protocols, patterns, arch     → expert
urgency:       set to high if deadline, client, or launch timeframe appears
```

---

## Step 4 — Routing (inferred)

**Do not ask "who is this for?"** Read the working model and classify:

| Signal | Route |
|--------|-------|
| `audience = personal`, first-person pain, no other users | → Branch A |
| `audience = public/both`, named user role, others' pain, alternatives mentioned | → Branch B |
| `depth = light` | → Branch A (strong signal, even if audience is ambiguous) |
| `depth = full` | → Branch B (strong signal, even if audience is ambiguous) |
| Ambiguous (mixed signals or unknown) | → Ask ONE question (below) |

**If ambiguous**, ask:

```
AskUserQuestion:
  header: "One quick thing"
  question: "Is this primarily for your own use, or are you building it for other people too?"
  options:
    - "Mostly for me — I'm the main user"
    - "For other people — I'm building it for users"
    - "Both — I'll use it and share it publicly"
```

- "Mostly for me" → Branch A
- "For other people" → Branch B, set `creator_is_user = false`
- "Both" → Branch B, set `creator_is_user = true`

---

## Branch A: Personal

**State of knowledge coming in:** Overview confirmed, Problem confirmed, `audience = personal`.

### A3 — Features

**Skip if `prefilled.v1_features` is set** — already saved in Step 0.5. Move to A5.

Think through the full domain before writing the question. Identify all logical feature groups (typically 2–4 for a personal tool). Each feature is a user-visible capability — not an implementation detail.

Send **all groups in one `AskUserQuestion`** call (`multiSelect: true` per group). Every feature is its own option — never bundle.

Show result via `bonsai_visualize` (type `summary-box`) with Must Have / Deferred split.

If `urgency = high` OR `scope_signal = large` OR total selected is large:
> "That's a wide scope for something you're building just for yourself. Want to cut some to v2?"

**After confirmation → call `spec_save` to update the file** with Features section.

### A5 — Tech (conditional)

**Skip if `prefilled.tech` is set OR** `tech` is known. State inline: "I'll use [X] — let me know if that changes."

**Step 1 — Platform (skip if already clear from context)**

If the target platform (web, desktop, mobile, CLI) is not evident from the domain or previous answers, ask ONE question:

```
AskUserQuestion:
  header: "Platform"
  question: "Where will this run?"
  options: [infer 2–4 relevant options from the domain, e.g. "Web browser", "Desktop app", "CLI", "Mobile"]
```

**Step 2 — Stack suggestions, calibrated by scale and `tech_depth`**

Use `scope_signal` to determine format:

**`scope_signal = small` or `depth = light`** — suggest key libraries only (no infra, no deployment):
- Offer 2–3 minimal setups: each is a short list of the main lib/framework + one or two supporting tools
- Format: `"[Main lib] + [supporting tool] — [one-line reason]"`
- `novice`: 2 options, plain names, no jargon
- `practitioner`: 2–3 options with rationale
- `expert`: include specific patterns or constraints if relevant (e.g. "vanilla TS + Vite — zero runtime overhead")

**`scope_signal = large` or `depth = full`** — suggest complete stacks by layer:
- Each option covers: Frontend / Backend / Database / Deployment
- Offer 2–3 distinct stack profiles, each internally consistent
- Format per option: `"[Stack name]: [Frontend] + [Backend] + [DB] + [Deploy] — [one-line rationale]"`
- `novice`: 2 options, describe in plain terms what each layer does
- `practitioner`: 2–3 named stacks with a one-line rationale per stack
- `expert`: include architectural tradeoffs (e.g. monorepo vs separate services, ORM vs query builder)

Always add:
- `"I have specific constraints: _____"`
- `"Decide later"`

**After confirmation → call `spec_save` to update the file.** If "Decide later" → leave as `[TBD]`.

**Always proceed to A-OSS next — do not skip to A-Draft.**

### A-OSS — Research open-source alternatives

**Always run this step — never skip, regardless of `depth`.**

**Fast-path when document was pre-filled (Step 0.5):** ask one question first, before any search:

```
AskUserQuestion:
  header: "Alternatives"
  question: "Do you want me to research open-source alternatives and add them to the spec?"
  options:
    - "Yes — research and add"
    - "No — skip"
```

- "No" → move on (A-Draft or directly to A-Save if everything else is pre-filled).
- "Yes" → run the search/visualize/save flow below, then call `spec_save` to add **Alternatives Considered**. No further confirmation question.

**Otherwise** (normal flow): use `WebSearch` to find popular open-source repositories that already solve this problem (search GitHub using the confirmed tech). Pick the top 2–3 results by stars/activity and briefly note what each does.

Show results via `bonsai_visualize` (type `summary-box`, title "Similar open-source projects"), one entry per repo — always include `url` to the GitHub repo:
```json
{ "label": "[repo-name ★ stars]", "value": "[one-line description]", "url": "https://github.com/..." }
```

Then ask with `AskUserQuestion`:

```
header: "Similar open-source projects"
question: "Found a few repos that overlap with what you're building. Want to add them to the spec as reference?"
options:
  - "Yes — add to spec"
  - "No — skip"
  - "I'd rather fork/extend one of these: _____"
```

If "Yes" → call `spec_save` to add an **Alternatives Considered** section listing the repos. If "fork/extend" → update the Overview and Problem accordingly, then call `spec_save`.

### A-Draft — Review before saving

**Always show this summary before calling `spec_save`.**

Show via `bonsai_visualize` (type `summary-box`, `visId: "spec-draft"`):

```json
{
  "type": "summary-box",
  "title": "GOAL&REQUIREMENTS.md — Draft",
  "visId": "spec-draft",
  "data": {
    "sections": [
      {"heading": "Overview",  "items": [{"label": "", "value": "[overview]"}]},
      {"heading": "Problem",   "items": [{"label": "", "value": "[problem]"}]},
      {"heading": "V1 Features", "items": [{"label": "☐", "value": "[feature]"}]},
      {"heading": "Tech",      "items": [{"label": "", "value": "[stack or TBD]"}]}
    ]
  }
}
```

Use `AskUserQuestion`:
- `"Looks right — save it"`
- `"Revise overview or problem: _____"`
- `"Change features"`
- `"Start over"`

### A-Save & Next

Use `spec_save` to finalize with `type: "goal-and-requirements"`, `status: "done"`.

Then call `SessionFinalize` to declare the done-screen contract. The user
drives the next step from the buttons it renders.

```json
{
  "summary": "Project planted. Doc saved to GOAL&REQUIREMENTS.md.",
  "artifacts": [
    { "path": "GOAL&REQUIREMENTS.md", "openOnDone": true }
  ],
  "actions": [
    {
      "type": "start_session",
      "id": "next-architecture",
      "title": "Continue → Architecture",
      "description": "Sketch the stack & modules in a DESIGN_DOC.md before tickets start running.",
      "skillId": "architecture-design",
      "primary": true
    },
    {
      "type": "navigate",
      "id": "skip-to-board",
      "title": "Skip → Open workspace",
      "description": "Architecture can wait. Land on the board now.",
      "target": "board"
    },
    // For each V1 feature, add one create_ticket action. The user clicks
    // 'Add to board' per item or 'Add all remaining' for bulk.
    {
      "type": "create_ticket",
      "id": "v1-feat-<slug>",
      "title": "<feature name>",
      "body": "<one-line rationale>",
      "state": "pending"
    }
    // ...repeat per V1 feature
  ]
}
```

After `SessionFinalize`, send a brief confirmation ("Spec saved.") and end your turn.

Update progress tracker via `bonsai_visualize` — mark Goal & Scope as **done**:

```json
{
  "type": "progress-tracker",
  "title": "New Project Setup",
  "visId": "workflow-progress",
  "data": {
    "steps": [
      {"label": "Goal & Scope", "status": "done", "file": "GOAL&REQUIREMENTS.md"},
      {"label": "Architecture",   "status": "pending", "file": "DESIGN_DOC.md"},
      {"label": "Module Specs",   "status": "pending"},
      {"label": "Task Specs",     "status": "pending"},
      {"label": "Implementation", "status": "pending"}
    ]
  }
}
```

---

## Branch B: Public Product

**State of knowledge coming in:** Overview confirmed, Problem confirmed, working model updated, `audience = public | both`, `creator_is_user = true | false`.

**If `depth = light`** (quick demo, tool to share with a team, no serious stakeholders):
- B-Context: if `user_role` is known → confirm inline in one turn; if not → infer from domain and confirm, don't ask open-ended
- B-Goals: skip
- B-NFR: skip
- B-Scope: treat like Branch A — fewer feature groups (2–3), lean toward the single essential thing
- B-Success: go directly to B-Success-Done (binary conditions only)

### B-Context — Users, JTBD, Story

**Skip the gather/confirm flow for any of Target Users / JTBD / User Story that are already in `prefilled`** — they were saved in Step 0.5. If all three are pre-filled, skip directly to Step 1b (alternatives research). Only run the gather/confirm flow for the ones that are missing.

Target Users, Jobs to Be Done, and Key User Story describe the same thing from different angles. Ask once to gather all the information, then confirm **one block at a time** — each section gets its own `AskUserQuestion` confirmation before moving to the next.

**Step 1 — Gather (one question or pre-fill):**

If `user_role` is known AND (`has_scenario = true` OR `jtbd_readable = true`): skip the question, proceed directly to confirmation.

Otherwise ask:
> "Describe your user doing the thing your product helps with — who are they, and what happens from the moment the need arises to when they're done?"

If the answer is too abstract, probe once:
> "Give me a specific person: what are they doing right before they reach for [the product]?"

Synthesize from the answer (or working model):
- **Target Users** — the role
- **Jobs to Be Done** — "When [X], I want [Y], so I can [Z]" (derive from story; never ask directly)
- **Key User Story** — the scenario expanded to 3–5 sentences

**Step 1b — Research alternatives (always, don't wait for the user to provide them):**

**Fast-path when document was pre-filled (Step 0.5):** ask one question first, before searching:

```
AskUserQuestion:
  header: "Alternatives"
  question: "Do you want me to research competing products and add them to the spec?"
  options:
    - "Yes — research and add"
    - "No — skip"
```

- "No" → move on. If `prefilled.alternatives` already exists, save it as-is; otherwise leave the section out.
- "Yes" → run the flow below, then call `spec_save` to add **Alternatives Considered**. No further confirmation question.

**Otherwise** (normal flow):

Use `WebSearch` to find real competing products in this space. For each result that looks relevant, use `WebFetch` to understand what it does.

Show results via `bonsai_visualize` (type `summary-box`, title "Existing solutions"), one entry per product — always include `url` (never omit it):
```json
{ "label": "[Product Name]", "value": "[one-line description]", "url": "https://..." }
```

Then ask with `AskUserQuestion`:

```
header: "Existing solutions"
question: "Which of these are closest to what you're building?"
options:
  - "[Product A]"
  - "[Product B]"
  - "[Product C]"
  - "None of these — mine is different: _____"
  - "Haven't looked at them yet — need time to check"
```

If "Haven't looked yet" → pause and tell the user to explore the links and come back. Don't proceed until they answer.

From the selected alternatives, synthesize **Alternatives Considered** using `bonsai_visualize` (type `summary-box`, title "Alternatives Considered") — one entry per product, always with `url`:
```json
{ "label": "[Product Name]", "value": "[what it does] — [specific gap]", "url": "https://..." }
```

If the user already named alternatives in `$ARGUMENTS` or in the Problem answer: still verify them and look for others they may have missed.

**Step 2 — Confirm one block at a time:**

Confirm each section with its own `AskUserQuestion` (header = section name, question = inferred text, options: "Looks right" / "Edit: _____"), in order. Only move to the next after the current one is approved. **After each individual confirmation, call `spec_save` immediately — do not wait until all sections are done.**

1. Target Users → confirm → **call `spec_save` now**
2. Jobs to Be Done → confirm → **call `spec_save` now**
3. Key User Story → confirm → **call `spec_save` now**
4. Alternatives Considered *(only if `alternatives` is known from user input or research; skip otherwise)* → confirm with options "Looks right" / "Edit: _____" / "Add one I know: _____" → **call `spec_save` now**

**After all confirmations → update working model:**
```
user_role:     refine if a more specific role emerged
has_scenario:  set to true if they gave a concrete story
scope_signal:  upgrade to large if they described multiple distinct user types or use cases
depth:         upgrade if the answer was detailed and specific
urgency:       set to high if they mentioned a deadline or client context
```

---

### B-Success

**Skip if `prefilled.success` is set** — already saved in Step 0.5. Move to B-Goals.

**If `creator_is_user` was already set in Step 4 (routing), skip the question below and go directly to the matching branch.**

**If `depth = light` or `depth = standard`** → always go to **B-Success-Done** (binary conditions are enough; skip quantified metrics).

**If `creator_is_user = false`** → go to **B-Success-Metrics**
**If `creator_is_user = true`** → go to **B-Success-Done**
**If `creator_is_user = unknown`** → ask ONE question:

```
AskUserQuestion:
  header: "Measuring success"
  question: "Will you yourself use this product?"
  options:
    - "No — building entirely for other people"
    - "Yes — I'm one of the primary users"
```

#### B-Success-Metrics (building for others)

Ask (free text):
> "Six months after launch — what number tells you this is working?"

If vague, probe: "How do you measure that? Give me a specific number."

Transform into 2–3 quantified metrics. Confirm with `AskUserQuestion` (header: "Success Metrics", question: the inferred metrics, options: "Looks right" / "Edit: _____").

Then ask: "What would tell you this failed? What's your kill condition?"

**After confirmation → call `spec_save` to update the file. Read the answer:**
```
depth:    upgrade to full if they immediately gave numbers (they think in KPIs)
urgency:  set to high if they mentioned a launch date or external deadline
```

#### B-Success-Done (building for self, or both)

Ask (free text):
> "What must be true before you consider v1 done and working for your own use?"

Transform into 2–4 binary conditions. Confirm with `AskUserQuestion` (header: "Done Conditions", question: the inferred conditions, options: "Looks right" / "Edit: _____").

**After confirmation → call `spec_save` to update the file. Read the answer:**
```
urgency:      set to high if deadline appears
scope_signal: upgrade to large if they listed many unrelated conditions
```

---

### B-Goals

**Skip if `prefilled.goals` is set** — already saved in Step 0.5. Move to B-Scope.

**Skip entirely if `depth = light`.** Move straight to B-Scope.

**Infer first, confirm — don't ask open-ended.**

From Problem and Success answers, derive 3 verb-first goals. Confirm with `AskUserQuestion`:

```
header: "Goals"
question: "Goals for v1:\n• [Verb] [specific outcome]\n• [Verb] [specific outcome]\n• [Verb] [specific outcome]"
options:
  - "Looks right"
  - "Edit: _____"
```

If the user edits or rejects, ask:
> "What's the main outcome v1 needs to move? Start with a verb."

Reject vague inline: "'Better UX' isn't a goal — 'Reduce time to first result from 10 min to 30 sec' is."

**After confirmation → call `spec_save` to update the file.**

---

### B-Scope — v1

**Skip if `prefilled.v1_features` is set** — already saved in Step 0.5. Move to B-NFR.

**This step comes after B-Success — don't start scope selection before success criteria are confirmed.**

This is the most important step. Think through the full product domain exhaustively before writing the question. Identify all logical feature groups (typically 3–6). Ground each feature in what the user described — not generic placeholders.

Send **all groups in a single `AskUserQuestion`** call (`multiSelect: true` per group). Every feature is its own individually selectable option — never bundle. Aim for 4–8 options per group. Features are user-visible capabilities — not implementation details.

Show result via `bonsai_visualize` (type `summary-box`) with In v1 / Out of v1 split.

If `urgency = high`: open with "Given your timeline, I'd push everything non-essential to v2 — let's be ruthless about what goes in v1."

If `scope_signal = large`: open with "Given the scope you described, I've split features into groups — expect a wide list. We'll trim to v1 together."

If `urgency = high` OR `scope_signal = large` OR total selected is large:
> "That's a broad v1 — a smaller scope ships faster. Want to move some items to v2?"

Use `AskUserQuestion` to confirm:
- `"Looks right"`
- `"Go back to a group"`
- `"Add something that wasn't listed: _____"`
- `"Move something out of v1: _____"`

**After confirmation → call `spec_save` to update the file.** Each v1 item gets a rationale that directly cites a specific Goal or Success condition:

- ✓ `— *enables Goal: reduce time to first invoice*`
- ✓ `— *required for: user sends invoice without help (Success)*`
- ✗ `— *core feature*` — too vague, always link to something specific

If a feature has no clear link to any Goal or Success condition → move it to Out of v1 by default. Only keep it if the user argues for it.

Out-of-v1 as plain bullets.

---

### B-NFR (conditional)

**Skip if `prefilled.nfr` is set** — already saved in Step 0.5. Move to B-Tech.

**Skip if `depth = light` or `depth = standard`.** Only surface for `depth = full` projects.

**Skip automatically if:** domain is a CLI tool, read-only dashboard, or a simple personal utility shared publicly. Move on without asking.

Otherwise use `AskUserQuestion` with `multiSelect: true`. Options tailored to the domain — e.g. "Must work offline", "GDPR compliance", "Sub-100ms response", "Mobile-first", "Self-hostable", "Multi-tenant". Always include `"None / skip"`.

**After confirmation → call `spec_save` to update the file.**

---

### B-Tech (conditional)

**Skip if `prefilled.tech` is set OR** `tech` is known. State inline: "I'll use [X] — let me know if you want to discuss alternatives."

**Step 1 — Platform (skip if already clear from context)**

If the target platform is not evident from the domain or previous answers, ask ONE question:

```
AskUserQuestion:
  header: "Platform"
  question: "Where will this run?"
  options: [infer 2–4 relevant options from the domain]
```

**Step 2 — Stack suggestions, calibrated by scale and `tech_depth`**

Branch B projects are almost always `scope_signal = large`. Suggest complete stacks by layer:

- Each option covers all relevant layers for this domain (e.g. Frontend / Backend / Database / Auth / Deployment)
- Offer 2–3 distinct stack profiles, each internally consistent
- Format per option: `"[Stack name]: [layer1] + [layer2] + ... — [one-line rationale]"`
- `novice`: 2 options, describe each layer in plain terms; include a "help me decide" escape hatch
- `practitioner`: 2–3 named stacks with a one-line rationale per stack (default)
- `expert`: highlight architectural tradeoffs between options (e.g. monolith vs microservices, REST vs GraphQL, managed vs self-hosted)

If `depth = light` (quick tool, team utility): fall back to key-libraries format — no deployment or infra layer needed.

Always add:
- `"I have specific constraints: _____"`
- `"Decide later"`

**After confirmation → call `spec_save` to update the file.**

---

### B-Draft — Review before saving

**Always show this summary before calling `spec_save`.**

Show via `bonsai_visualize` (type `summary-box`, `visId: "spec-draft"`):

```json
{
  "type": "summary-box",
  "title": "GOAL&REQUIREMENTS.md — Draft",
  "visId": "spec-draft",
  "data": {
    "sections": [
      {"heading": "Overview",     "items": [{"label": "", "value": "[overview]"}]},
      {"heading": "Problem",      "items": [{"label": "Who", "value": "..."}, {"label": "Today", "value": "..."}, {"label": "Alternative", "value": "..."}]},
      {"heading": "Users & JTBD", "items": [{"label": "Users", "value": "..."}, {"label": "Job", "value": "..."}]},
      {"heading": "Goals",        "items": [{"label": "·", "value": "[goal]"}]},
      {"heading": "Success",      "items": [{"label": "·", "value": "[metric or condition]"}]},
      {"heading": "In v1",        "items": [{"label": "☐", "value": "[feature] — why v1"}]},
      {"heading": "Out of v1",    "items": [{"label": "·", "value": "[deferred]"}]},
      {"heading": "Tech",         "items": [{"label": "", "value": "[stack or TBD]"}]}
    ]
  }
}
```

Use `AskUserQuestion`:
- `"Looks right — save it"`
- `"Revise overview or problem"`
- `"Revise v1 scope"`
- `"Revise success / goals"`
- `"Start over"`

On revision → make the change and re-show the draft.

### B-Save & Next

Use `spec_save` to finalize with `type: "goal-and-requirements"`, `status: "done"`.

Then call `SessionFinalize` to declare the done-screen contract. Same
shape as A-Save above:

- `summary`: short banner about the saved spec.
- `artifacts`: include `GOAL&REQUIREMENTS.md` (at project root, **not** under `.bonsai/`) with `openOnDone: true`.
- `actions`: at minimum a primary `start_session` for `architecture-design`,
  a `navigate` to `board` as the skip path, plus one `create_ticket` per
  V1 feature (use the rationale as `body`) and one `create_ticket` per
  named alternative ("Research <Alternative>"). All in `state: "pending"`.

The user applies each queued ticket from the done screen.

Update progress tracker via `bonsai_visualize` — mark Goal & Scope as **done**:

```json
{
  "type": "progress-tracker",
  "title": "New Project Setup",
  "visId": "workflow-progress",
  "data": {
    "steps": [
      {"label": "Goal & Scope", "status": "done", "file": "GOAL&REQUIREMENTS.md"},
      {"label": "Architecture",   "status": "pending", "file": "DESIGN_DOC.md"},
      {"label": "Module Specs",   "status": "pending"},
      {"label": "Task Specs",     "status": "pending"},
      {"label": "Implementation", "status": "pending"}
    ]
  }
}
```

