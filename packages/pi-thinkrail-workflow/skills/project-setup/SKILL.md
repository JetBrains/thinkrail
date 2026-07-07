---
name: project-setup
description: "Use this at the very start of a brand-new, empty project when the user has an idea to explore. Turns a raw idea into a focused goal-and-requirements.md through a short, tailored conversation — vision, MVP scope, success criteria, and technology. Not for feature work inside an existing project; use the brainstorming skill for that."
---

# Project Setup

You are helping someone turn an idea into a clear, buildable specification for a brand-new project. 
The workspace is empty: there is no code yet, and no decisions have been made.
Your job is to help them think clearly, define a focused scope, and produce a single document, `goal-and-requirements.md`, that serves as the foundation for all subsequent work.
This skill is intended solely for project inception.
Once `goal-and-requirements.md` has been created and implementation begins, hand over to the `brainstorming` skill for each subsequent feature or design decision.

**Principles:**

* Build on what the user has already said in their initial request—never ask for information they have already provided.
* **Pre-filled document fast path** — if the user's initial request already contains a structured document (for example, multiple Markdown headings corresponding to specification sections, or a well-written brief covering several sections), parse it and treat those sections as **already confirmed**. 
  Save them immediately (see Step 0.5). Never ask the user to confirm content they have already written. 
  Only proceed to sections that are genuinely missing **and** required by the inferred `depth` and `audience`.
  After parsing, the only interaction should be the alternatives research question: a single yes/no question, with nothing else.
* Ask one question at a time (or one batched round using `ask_user_question`)—never overwhelm the user with an open-ended wall of text.
* Every option you present must be tailored to the user's requirements, rather than relying on generic placeholders.
* Propose a draft as early as possible—a concrete suggestion is always more effective than an open-ended question.
* **MVP first**: the right v1 is usually smaller than the user initially expects.
* **Build `goal-and-requirements.md` incrementally, one section at a time.** 
  Call `spec_create` exactly once, as soon as the first section is ready to be saved (see **"Saving the specification"** below).
  Add each subsequent confirmed section using `edit`.
  Never pre-populate unconfirmed sections with `[TBD]`—if a section has not yet been discussed, it simply does not appear in the document.
* **Infer the routing rather than asking** — determine whether the project is personal or public from the initial request, together with the Overview and Problem sections.
  Only ask the user if it is genuinely ambiguous.
* **Every section is conditional** — before moving on to a section, check the following in order:

  1. Has it already been pre-filled from the initial request (Step 0.5)? If so, skip it—it has already been saved.
  2. Is the answer already apparent from the working model or previously confirmed content? If so, skip it or pre-fill it and ask for confirmation.
  3. Is the section required for the inferred `depth` and `audience`? If not, skip it.

  Only ask about information that is both missing and required.
* **Answers accumulate** — each confirmed answer updates the working model and reduces the amount of information that still needs to be gathered.
* **Confirm inferred statements using `ask_user_question`** — when you have inferred a statement (such as the Overview, Problem, or Goals), present it as the question text with two response options: `"Looks right"` and a free-text edit field (single-select questions include this automatically—do not create your own "Other" or edit option).
  Treat the user's response as follows:

  + **"Looks right"** $\to$ the model is accurate; continue unchanged.
  + **Free-text edit** (a single fact changes) $\to$ update only that field; do not re-evaluate the routing or any other inferences.
  + **Substantial rewrite** $\to$ re-evaluate all working-model fields derived from that section before continuing.
  + **Rejection** (for example, "No, that's wrong") $\to$ discard the inference entirely and ask an open-ended question instead.
* **There is no board or ticketing system.** 
  Once the specification has been saved, state this plainly and suggest the natural next step: drafting `architecture.md`.
  There is no structured hand-off or action mechanism to invoke.


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

## Saving the spec

1. The **first** time a section is confirmed, call `spec_create` with `path: "goal-and-requirements.md"`, a slugified `id` (for example, the project name), `type: "goal-and-requirements"`, `title` (the project or product name), and `status: "draft"`.
  This creates the front matter and a minimal `## Goal` / `## Scope` skeleton.
2. Immediately call `edit` to replace the initial skeleton with the appropriate template (either the Personal Project Specification or the PRD, depending on the applicable branch). At this stage, the document should contain only the `# Title`, the `> tagline`, and the section(s) confirmed so far.
3. For each subsequently confirmed section, call `edit` to add it to the document in the order defined by the template. 
  Do not batch updates—save each section immediately after it has been confirmed, just as `spec_create` would.
4. Once the specification has been finalised (A-Save / B-Save), call `spec_update` to change the `status` from `draft` to `done`.

## Working with `ask_user_question`

* Ask up to four questions per call, with two to four options for each. The `header` should be a short chip (maximum 16 characters, for example `"Overview"`). 
  Every option must include both a `label` and a `description` explaining the trade-off or what the choice means.

  Single-select questions automatically include a free-text edit field and a **Skip** option—never create your own "Other", free-text, or escape option. Setting `multiSelect: true` suppresses the free-text field (use this for the feature-group checklists described below).

* When you have a recommendation, place it first and append `"(Recommended)"` to its label.

* Group everything required for a given step into a single call—avoid chaining multiple calls together with trivial follow-up questions.

* If the user skips a question or leaves it unanswered, do not treat this as a blocker. Continue using the current working model, and note any significant gaps inline in the relevant saved section if necessary.


---

## Step 0 — Extract from the initial request

**Before doing anything else**, read the user's initial request and build an internal working model:

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

**Inferring `depth` from the initial request's style:**
- `light` — one-liner, casual phrasing ("want to demo", "just trying something", "quick tool"), no other users or stakeholders mentioned
- `standard` — a few sentences, one clear use case, some context
- `full` — detailed description, named competitors, multiple user types, stakeholders, deadlines

`depth` can only increase during the conversation — update it after Step 3 if the Problem answer is richer than the initial request suggested.

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

Use this model throughout to skip questions and pre-fill answers. The project name is already in the initial request — don't ask for it.

If the initial request is empty or too vague to extract anything meaningful, ask:
> "What are you building? One sentence or a paragraph — whatever feels natural."

---

## Step 0.5 — Parse pre-filled document

**Run this immediately after Step 0, before any question.**

Scan the initial request for structured content. A pre-filled document is signaled by **two or more** of:
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

**Then, immediately:**

1. Determine the routing (Branch A or B) using the same signals as in Step 4—do not ask the user.
2. Call `spec_create` followed by `edit` (see **"Saving the specification"**) to save all parsed sections, formatted using the appropriate template (either the Personal Project Specification or the PRD).
3. State the current status in a single line (for example: *"I've got the basics from what you wrote—there are just a few details left to pin down."*).
4. **Skip every step whose section appears in `prefilled`.** Do not ask the user to confirm content that has already been parsed. Only proceed through sections that are both (a) missing from `prefilled` and (b) required by the inferred `depth` and `audience` (applying the existing "skip if light/standard" rules).
5. For each remaining required section, follow the normal process: infer $\to$ confirm $\to$ save.
6. **Alternatives research is the only exception.** Always offer it as a single yes/no question (see the Step A-OSS / B-Context-1b notes below).

**If nothing meaningful can be parsed** (for example, a vague one-line request with no structure), follow the normal flow starting from Step 1.


---

## Step 1 — Orient

Say in one short line what you're about to do — e.g. "Let's nail down the goal and scope, then I'll save
it as `goal-and-requirements.md`." There is no progress-tracker tool here; a plain sentence is enough. Skip
this if Step 0.5 already produced a status line.

---

## Step 2 — Overview

**Skip if `prefilled.overview` is set** — it was already saved in Step 0.5. Move to Step 3.

From the initial request and your working model, write the Overview according to `depth`:

- `light` — one sentence: what it does
- `standard` — 2–3 sentences: what it is, who it's for
- `full` — one paragraph: what it is, who it's for, what it replaces; if `alternatives` is known, name them ("unlike [alternative], this...")

Confirm with `ask_user_question`:

```
header: "Overview"
question: "[Your inferred overview]"
options:
  - label: "Looks right"
    description: "The overview above is accurate as written."
  - label: "Edit: describe what's off"
    description: "Something about the overview needs to change."
```

Section: `## Overview`.

**If the user rejects or substantially rewrites the Overview:** re-evaluate the `depth`, `audience`, and `scope_signal` before continuing. A substantial rewrite indicates that the initial inference was incorrect—do not carry those inferences forward into the routing decision or any subsequent steps.

---

## Step 3 — Problem

**Skip if `prefilled.problem` is set** — already saved in Step 0.5. Move to Step 4.

**Before proceeding, check whether this section is still required:**

* If `depth = light` **and** the confirmed Overview already implies the underlying problem (for example, *"a quick tool to do X, which I currently do manually"*), skip this section entirely. 
  Derive a one-line problem statement from the Overview, save it silently using `edit`, and proceed to Step 4.
* If `problem` already exists in the working model **and** is fully captured by the confirmed Overview, skip directly to Step 4.


**If `problem` is already in the working model** (but not yet reflected in the document): transform it into a statement and confirm with `ask_user_question` — do not ask an open question.

**Otherwise**: ask ONE question tailored to the domain. Reference what you know — never ask generically.

> Pattern: "You're building [domain thing]. What breaks down today without it — what do you actually do
> instead?"

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

Confirm with `ask_user_question`:

```
header: "Problem"
question: "[Your inferred problem statement]"
options:
  - label: "Looks right"
    description: "The problem statement above is accurate as written."
  - label: "Edit: describe what's off"
    description: "Something about the problem statement needs to change."
```

Section: `## Problem`. Then update working model:

```
user_role:     [name if mentioned in Problem answer]
alternatives:  [tools/workarounds mentioned]
jtbd_readable: [true if answer reads as "when X I want Y so I can Z"]
has_scenario:  [true if answer contains a concrete end-to-end story]
depth:         upgrade if answer is richer than the initial request suggested:
                one vague sentence            $\to$ keep or stay at light
                paragraph with named tools    $\to$ standard
                multiple users, stakeholders  $\to$ full
tech_depth:    upgrade from vocabulary in answer:
                generic terms only            $\to$ novice
                framework/library names       $\to$ practitioner
                protocols, patterns, arch     $\to$ expert
urgency:       set to high if deadline, client, or launch timeframe appears
```

---

## Step 4 — Routing (inferred)

**Do not ask "who is this for?"** Read the working model and classify:

| Signal | Route |
|--------|-------|
| `audience = personal`, first-person pain, no other users | $\to$ Branch A |
| `audience = public/both`, named user role, others' pain, alternatives mentioned | $\to$ Branch B |
| `depth = light` | $\to$ Branch A (strong signal, even if audience is ambiguous) |
| `depth = full` | $\to$ Branch B (strong signal, even if audience is ambiguous) |
| Ambiguous (mixed signals or unknown) | $\to$ Ask ONE question (below) |

**If ambiguous**, ask:

```
ask_user_question:
  header: "Who's this for"
  question: "Is this primarily for your own use, or are you building it for other people too?"
  options:
    - label: "Mostly for me"
      description: "I'm the main user — a personal project spec."
    - label: "For other people"
      description: "I'm building it for other users — a full PRD."
    - label: "Both"
      description: "I'll use it myself and share it publicly — a full PRD."
```

- "Mostly for me" $\to$ Branch A
- "For other people" $\to$ Branch B, set `creator_is_user = false`
- "Both" $\to$ Branch B, set `creator_is_user = true`

---

## Branch A: Personal

**State of knowledge coming in:** Overview confirmed, Problem confirmed, `audience = personal`.

### A3 — Features

**Skip if `prefilled.v1_features` is set** — already saved in Step 0.5. Move to A5.

Think through the full domain before writing the question. Identify all logical feature groups (typically 2–4 for a personal tool). Each feature is a user-visible capability — not an implementation detail.

Send **all groups in one `ask_user_question` call** (`multiSelect: true` per group). Every feature is its own option — never bundle.

Recap the result in one short list: Must Have vs. Deferred.

If `urgency = high` OR `scope_signal = large` OR total selected is large:
> "That's a wide scope for something you're building just for yourself. Want to cut some to v2?"

Section: `## V1 Features` — selected features as a checklist.

### A5 — Tech (conditional)

**Skip if `prefilled.tech` is set OR** `tech` is known. State inline: "I'll use [X] — let me know if that
changes."

**Step 1 — Platform (skip if already clear from context)**

If the target platform (web, desktop, mobile, CLI) is not evident from the domain or previous answers, ask
ONE question:

```
ask_user_question:
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

Always add a final free-text option for "I have specific constraints" and one for "Decide later".

Section: `## Tech Notes` — chosen stack with one-line rationale. If "Decide later" → leave the section as `[TBD]`.

**Always proceed to A-OSS next — do not skip to A-Draft.**

### A-OSS — Research open-source alternatives

**Always run this step — never skip, regardless of `depth`.**

**Fast-path when document was pre-filled (Step 0.5):** ask one question first, before any search:

```
ask_user_question:
  header: "Alternatives"
  question: "Do you want me to research open-source alternatives and add them to the spec?"
  options:
    - label: "Yes — research and add"
      description: "Search GitHub for similar projects and list them in the spec."
    - label: "No — skip"
      description: "Don't research alternatives."
```

- "No" → move on (A-Draft or directly to A-Save if everything else is pre-filled).
- "Yes" → run the search/save flow below, then `edit` to add **Alternatives Considered**. No further confirmation question.

**Otherwise** (normal flow): use `web_search` to find popular open-source repositories that already solve this problem (search GitHub using the confirmed tech), then `fetch_content` on promising results to confirm what they do. 
Pick the top 2–3 results by stars/activity and briefly note what each does.

Recap the findings as a short list (repo name, one-line description, URL), then ask with
`ask_user_question`:

```
header: "Similar projects"
question: "Found a few repos that overlap with what you're building. Want to add them to the spec as reference?"
options:
  - label: "Yes — add to spec"
    description: "List these repos under Alternatives Considered."
  - label: "No — skip"
    description: "Don't add them."
  - label: "I'd rather fork/extend one: name it"
    description: "Use one of these as a starting point instead of building from scratch."
```

If "Yes" $\to$ `edit` to add an **Alternatives Considered** section listing the repos (with URLs). 
If "fork/extend" → update the Overview and Problem accordingly, then `edit`.

### A-Draft — Review before saving

**Always show this summary before finalizing.**

Recap the full draft in plain markdown (Overview / Problem / V1 Features / Tech, in template order), then
confirm with `ask_user_question`:

```
header: "Draft review"
question: "Here's the draft — save it as-is?"
options:
  - label: "Looks right — save it"
    description: "Finalize goal-and-requirements.md as shown."
  - label: "Revise overview or problem"
    description: "Something in Overview/Problem needs to change first."
  - label: "Change features"
    description: "Go back and adjust the V1 feature list."
  - label: "Start over"
    description: "Discard the draft and restart from Step 0."
```

### A-Save & Next

`spec_update` to move `status` from `draft` to `done`.

Tell the user plainly: the spec is saved to `goal-and-requirements.md`. 
Suggest, as a plain next step, that they can now sketch `architecture.md` (stack & modules) before diving into implementation — there is no structured hand-off mechanism here, just say it and end your turn.

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

**Skip the gather/confirm flow for any of Target Users / JTBD / User Story that are already in `prefilled`** — they were saved in Step 0.5.
If all three are pre-filled, skip directly to Step 1b (alternatives research).
Only run the gather/confirm flow for the ones that are missing.

Target Users, Jobs to Be Done, and Key User Story describe the same thing from different angles. 
Ask once to gather all the information, then confirm **one block at a time** — each section gets its own `ask_user_question` confirmation before moving to the next.

**Step 1 — Gather (one question or pre-fill):**

If `user_role` is known AND (`has_scenario = true` OR `jtbd_readable = true`): skip the question, proceed directly to confirmation.

Otherwise ask:
> "Describe your user doing the thing your product helps with — who are they, and what happens from the
> moment the need arises to when they're done?"

If the answer is too abstract, probe once:
> "Give me a specific person: what are they doing right before they reach for [the product]?"

Synthesize from the answer (or working model):

- **Target Users** — the role
- **Jobs to Be Done** — "When [X], I want [Y], so I can [Z]" (derive from story; never ask directly)
- **Key User Story** — the scenario expanded to 3–5 sentences

**Step 1b — Research alternatives (always, don't wait for the user to provide them):**

**Fast-path when document was pre-filled (Step 0.5):** ask one question first, before searching:

```
ask_user_question:
  header: "Alternatives"
  question: "Do you want me to research competing products and add them to the spec?"
  options:
    - label: "Yes — research and add"
      description: "Search for competing products and list them in the spec."
    - label: "No — skip"
      description: "Don't research alternatives."
```

- "No" $\to$ move on. If `prefilled.alternatives` already exists, save it as-is; otherwise leave the section out.
- "Yes" $\to$ run the flow below, then `edit` to add **Alternatives Considered**. No further confirmation question.

**Otherwise** (normal flow):

Use `web_search` to find real competing products in this space. For each result that looks relevant, use `fetch_content` to understand what it does.

Recap results as a short list (product name, one-line description, URL — always include the URL), then ask with `ask_user_question`:

```
header: "Existing tools"
question: "Which of these are closest to what you're building?"
options:
  - label: "[Product A]"
    description: "[one-line description of the gap it leaves]"
  - label: "[Product B]"
    description: "[one-line description of the gap it leaves]"
  - label: "None of these — mine is different"
    description: "Say what makes this distinct instead."
  - label: "Haven't looked yet — need time"
    description: "Pause and come back once you've checked the links."
```

If "Haven't looked yet" → pause and tell the user to explore the links and come back. Don't proceed until they answer.

From the selected alternatives, synthesize **Alternatives Considered** — one entry per product, always with a URL and a specific gap it leaves (not "mine is different" alone).

If the user already named alternatives in their initial request or in the Problem answer: still verify them and look for others they may have missed.

**Step 2 — Confirm one block at a time:**

Confirm each section with its own `ask_user_question` (header = section name, question = inferred text, options: "Looks right" / an edit row), in order. Only move to the next after the current one is approved.
`edit` right after each confirmation (one section at a time, not batched):

1. `## Target Users`
2. `## Jobs to Be Done`
3. `## Key User Story`
4. `## Alternatives Considered` *(only if `alternatives` is known from user input or research; otherwise skip)* — extra option "Add one I know"

**After all four confirmations → update working model:**
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
ask_user_question:
  header: "Primary user"
  question: "Will you yourself use this product?"
  options:
    - label: "No"
      description: "Building entirely for other people."
    - label: "Yes"
      description: "I'm one of the primary users."
```

#### B-Success-Metrics (building for others)

Ask (free text):
> "Six months after launch — what number tells you this is working?"

If vague, probe: "How do you measure that? Give me a specific number."

Transform into 2–3 quantified metrics. Confirm with `ask_user_question` (header: "Success Metrics", question: the inferred metrics, options: "Looks right" / an edit row).

Then ask: "What would tell you this failed? What's your kill condition?"

Section: `## Success Metrics`. Then read the answer and update the working model:
```
depth:    upgrade to full if they immediately gave numbers (they think in KPIs)
urgency:  set to high if they mentioned a launch date or external deadline
```

#### B-Success-Done (building for self, or both)

Ask (free text):
> "What must be true before you consider v1 done and working for your own use?"

Transform into 2–4 binary conditions. Confirm with `ask_user_question` (header: "Done Conditions", question: the inferred conditions, options: "Looks right" / an edit row).

Section: `## Done Conditions`. Then read the answer and update the working model:
```
urgency:      set to high if deadline appears
scope_signal: upgrade to large if they listed many unrelated conditions
```

---

### B-Goals

**Skip if `prefilled.goals` is set** — already saved in Step 0.5. Move to B-Scope.

**Skip entirely if `depth = light`.** Move straight to B-Scope.

**Infer first, confirm — don't ask open-ended.**

From Problem and Success answers, derive 3 verb-first goals. Confirm with `ask_user_question`:

```
header: "Goals"
question: "Goals for v1:\n• [Verb] [specific outcome]\n• [Verb] [specific outcome]\n• [Verb] [specific outcome]"
options:
  - label: "Looks right"
    description: "These three goals are accurate as written."
  - label: "Edit: describe what's off"
    description: "One or more goals need to change."
```

If the user edits or rejects, ask:
> "What's the main outcome v1 needs to move? Start with a verb."

Reject vague inline: "'Better UX' isn't a goal — 'Reduce time to first result from 10 min to 30 sec' is."

Section: `## Goals` — bullet list of verb-first outcomes.

---

### B-Scope — v1

**Skip if `prefilled.v1_features` is set** — already saved in Step 0.5. Move to B-NFR.

**This step comes after B-Success — don't start scope selection before success criteria are confirmed.**

This is the most important step. Think through the full product domain exhaustively before writing the
question. Identify all logical feature groups (typically 3–6). Ground each feature in what the user
described — not generic placeholders.

Send **all groups in a single `ask_user_question` call** (`multiSelect: true` per group). Every feature is
its own individually selectable option — never bundle. Aim for 4–8 options per group. Features are
user-visible capabilities — not implementation details.

Recap the result as In v1 / Out of v1.

If `urgency = high`: open with "Given your timeline, I'd push everything non-essential to v2 — let's be
ruthless about what goes in v1."

If `scope_signal = large`: open with "Given the scope you described, I've split features into groups —
expect a wide list. We'll trim to v1 together."

If `urgency = high` OR `scope_signal = large` OR total selected is large:
> "That's a broad v1 — a smaller scope ships faster. Want to move some items to v2?"

Confirm with `ask_user_question`:
- `"Looks right"`
- `"Go back to a group"`
- `"Add something that wasn't listed"`
- `"Move something out of v1"`

Section: `## MVP Scope` with `### In v1` / `### Out of v1` sub-sections. Each v1 item gets a rationale that
directly cites a specific Goal or Success condition:

- ✓ `— *enables Goal: reduce time to first invoice*`
- ✓ `— *required for: user sends invoice without help (Success)*`
- ✗ `— *core feature*` — too vague, always link to something specific

If a feature has no clear link to any Goal or Success condition → move it to Out of v1 by default. Only
keep it if the user argues for it.

Out-of-v1 as plain bullets.

---

### B-NFR (conditional)

**Skip if `prefilled.nfr` is set** — already saved in Step 0.5. Move to B-Tech.

**Skip if `depth = light` or `depth = standard`.** Only surface for `depth = full` projects.

**Skip automatically if:** domain is a CLI tool, read-only dashboard, or a simple personal utility shared
publicly. Move on without asking.

Otherwise use `ask_user_question` with `multiSelect: true`. Options tailored to the domain — e.g. "Must
work offline", "GDPR compliance", "Sub-100ms response", "Mobile-first", "Self-hostable", "Multi-tenant".
Always include a "None / skip" option.

Section: `## Non-Functional Requirements` — bullet list of the selected items.

---

### B-Tech (conditional)

**Skip if `prefilled.tech` is set OR** `tech` is known. State inline: "I'll use [X] — let me know if you
want to discuss alternatives."

**Step 1 — Platform (skip if already clear from context)**

If the target platform is not evident from the domain or previous answers, ask ONE question:

```
ask_user_question:
  header: "Platform"
  question: "Where will this run?"
  options: [infer 2–4 relevant options from the domain]
```

**Step 2 — Stack suggestions, calibrated by scale and `tech_depth`**

Branch B projects are almost always `scope_signal = large`. Suggest complete stacks by layer:

- Each option covers all relevant layers for this domain (e.g. Frontend / Backend / Database / Auth /
  Deployment)
- Offer 2–3 distinct stack profiles, each internally consistent
- Format per option: `"[Stack name]: [layer1] + [layer2] + ... — [one-line rationale]"`
- `novice`: 2 options, describe each layer in plain terms; include a "help me decide" escape hatch
- `practitioner`: 2–3 named stacks with a one-line rationale per stack (default)
- `expert`: highlight architectural tradeoffs between options (e.g. monolith vs microservices, REST vs
  GraphQL, managed vs self-hosted)

If `depth = light` (quick tool, team utility): fall back to key-libraries format — no deployment or infra
layer needed.

Always add a final free-text option for "I have specific constraints" and one for "Decide later".

Section: `## Technology` — table with `Aspect | Choice | Rationale`. If "Decide later" → leave entries as
`[TBD]`.

---

### B-Draft — Review before saving

**Always show this summary before finalizing.**

Recap the full draft in plain markdown (Overview / Problem / Users & JTBD / Goals / Success / In v1 / Out of v1 / Tech, in template order), then confirm with `ask_user_question`:

```
header: "Draft review"
question: "Here's the draft — save it as-is?"
options:
  - label: "Looks right — save it"
    description: "Finalize goal-and-requirements.md as shown."
  - label: "Revise overview or problem"
    description: "Something in Overview/Problem needs to change first."
  - label: "Revise v1 scope"
    description: "Go back and adjust MVP Scope."
  - label: "Revise success / goals"
    description: "Go back and adjust Goals or Success Metrics."
```

On revision → make the change and re-show the draft.

### B-Save & Next

`spec_update` to move `status` from `draft` to `done`.

Tell the user plainly: the spec is saved to `goal-and-requirements.md`. Suggest, as a plain next step, that they can now sketch `architecture.md` (stack & modules) before diving into implementation — there is no structured hand-off mechanism here, just say it and end your turn.
