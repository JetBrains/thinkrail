---
name: goal-and-requirements
description: Define and clarify a project or feature goal interactively. Creates a clear goal statement and description that guides all subsequent design and implementation. Use when starting a new project or feature.
argument-hint: "[project-or-feature-description]"
---

# Name & Goal & Idea Proposal & Requirements/Technology Selection

You are creating a the **Foundational Specification** that guides all subsequent design and implementation work. Help the user articulate a clear, focused project/feature name, goal, description, technology stack, and requirements through interactive structured multi-choice decisions — never leave them staring at a blank page.

## IMPORTANT: Interaction Style

- Use the **AskUserQuestion** tool for every decision
- If code exists, **analyze it first** to provide context-aware suggestions
- Offer **3-5 choices** per question, never open-ended dumps
- Proactively suggest refined versions
- **Use `bonsai_visualize` tool** with structured data for all visualizations (progress trackers, summary boxes, confirmations)
- **NEVER** use Bash, echo, printf, or ANSI escape codes for visual output

## Output

Creates `GOAL&REQUIREMENTS.md` at the project root with structure (add more sections if needed):

```markdown
* Project\Feature name: [name]
* Category: [new-project|new-feature|improvement|optimization|bug-fix|refactor]
* Priority: [critical|high|medium|low]

## Goal
  [Single clear statement of what the project aims to achieve]

## Description

  [1-2 paragraph description of the project/feature]

## Requirements / Technology stack

  [Requirements, constraints, and Technology stack; No architecture yet]

```

## Step-by-Step Guided Process For Goal and Description

### Step 1: Show Progress

Show current workflow position by calling `bonsai_visualize` with type `progress-tracker`:
```json
{
  "type": "progress-tracker",
  "title": "Specification-Driven Development",
  "vizId": "workflow-progress",
  "data": {
    "steps": [
      {"label": "Goal & Requirements", "status": "current", "file": "GOAL&REQUIREMENTS.md"},
      {"label": "Architecture", "status": "pending", "file": "DESIGN_DOC.md"},
      {"label": "Module Specs", "status": "pending"},
      {"label": "Task Specs", "status": "pending"},
      {"label": "Implementation", "status": "pending"}
    ]
  }
}
```

### Step 2: Initial Input

If `$ARGUMENTS` is provided, use it as the initial description.

If code exists, analyze the project structure for context and check for `package.json`, `Cargo.toml`, `setup.py`, `go.mod`, or similar to auto-detect.

### Sub-step 2.1: Analyze existing code (if any)

If there's already a codebase:
- Read `package.json`, `Cargo.toml`, `setup.py`, etc. for project metadata
- Scan directory structure for main components
- Look for existing test setup, CI config, Docker files
- Extract dependency list
- Pre-fill as much as possible — present findings and ask user to confirm/correct

### Sub-step 2.2: Ask for description (if none provided)

Otherwise ask: "What is your project or feature about? Describe it briefly."

Listen to user's description (can be rough/unstructured).

### Step 3: Clarifying Questions

Based on initial input, ask clarifying questions as multi-choice selections (use `AskUserQuestion`). Ask at least 2-3 questions to get: the main goal, kind of application/feature, target users, purpose.

**Question 1 — Category:**
- "New project" — Building something from scratch
- "New feature" — Adding capability to existing project
- "Improvement / optimization" — Making something better/faster
- "Bug fix / correctness" — Something isn't working right
- "Other: _____"

**Question 2 — Type** (adapt based on category; multiSelect: true):
- "CLI tool" — Command-line application
- "Library/SDK" — Code others import and use
- "Web application" — Server/frontend web app
- "System/Infrastructure" — Low-level systems software
- "API / Service" — Application programming interface
- "Database" — Structured data storage
- "Mobile app" — Mobile app for iOS/Android
- "IoT device" — Hardware device that connects to the internet
- "Other: _____"

**Question 3 — Purpose:** (multiSelect: true)
- "Production use"
- "Prototype / MVP"
- "Demonstration / learning"
- "Research / experiment"
- "Other: _____"

**Question 4 — Target users:** (for new project/feature only; multiSelect: true)
- "Developers (library users)" — Other programmers will use this as a dependency
- "Developers (contributors)" — Other programmers will modify this code
- "End users (non-technical)" — Non-technical users will interact with this
- "System administrators"
- "Internal team" — Used within your organization only
- "Mixed audience"
- "Other: _____"

**Priority level:**
- "Critical" — Urgent
- "High" — Significant impact on correctness, performance, or usability
- "Medium" — Notable improvement, can be scheduled
- "Low" — Nice-to-have, do when time permits


### Step 4: Draft Goal Statement

Based on responses, draft a goal statement. Show it using `bonsai_visualize` with type `summary-box`:
```json
{
  "type": "summary-box",
  "title": "Proposed Goal",
  "vizId": "goal-draft",
  "data": {
    "sections": [
      {"heading": "Goal", "items": [{"label": "Statement", "value": "[drafted goal]"}]},
      {"heading": "Category", "items": [{"label": "Type", "value": "[category]"}]}
    ]
  }
}
```

Use AskUserQuestion:
- "Yes, perfect"
- "Close, but needs refinement"
- "No, let me rephrase"

If refinement needed:
- Ask specific questions about what to adjust
- Show 3-5 alternative phrasings as choices
- Let user pick or combine
- Repeat until goal is clear

### Step 5: Draft Description

Draft a 1-2 paragraph description. Show it using `bonsai_visualize` with type `summary-box`:
```json
{
  "type": "summary-box",
  "title": "Proposed Description",
  "vizId": "description-draft",
  "data": {
    "sections": [
      {"heading": "Description", "items": [{"label": "Text", "value": "[draft description]"}]},
      {"heading": "Key Aspects", "items": [
        {"label": "What", "value": "[what the project does]"},
        {"label": "Why", "value": "[why it's needed]"},
        {"label": "Who", "value": "[who will use it]"}
      ]}
    ]
  }
}
```

Use AskUserQuestion:
- "Yes, accurate"
- "Needs more detail"
- "Too verbose, simplify"
- "Rewrite needed"

If refinement needed:
- Ask specific questions about what to adjust
- Show 3-5 alternative phrasings as choices
- Let user pick or combine
- Repeat until description is clear

## Step 6: Validation

Check:
- Goal is one clear statement (not multiple goals)
- Description is 1-2 paragraphs (not too brief, not too long)
- Goal and description are consistent and do not contradict
- Goal is specific enough to guide design
- No unnecessary technical jargon
- User explicitly confirmed

### Tips for Good Goals

Share with users if they struggle:

**Good goals are:**
- Specific: "Build a CLI calculator" not "Make a calculator"
- Focused: One primary objective, not many
- Measurable: Clear when it's achieved
- User-oriented: Mentions who benefits

**Examples of refinement:**
- Vague: "Create an app" -> Specific: "Create a mobile expense tracker for personal budgeting"
- Too broad: "Build a platform for everything" -> Focused: "Build a blog platform with Markdown support"

### Step 7: Visual Confirmation

Show the complete goal specification using `bonsai_visualize` with type `summary-box`:
```json
{
  "type": "summary-box",
  "title": "Goal Specification",
  "vizId": "goal-confirmation",
  "data": {
    "sections": [
      {"heading": "Goal", "items": [{"label": "Statement", "value": "[goal statement]"}]},
      {"heading": "Description", "items": [{"label": "Text", "value": "[description]"}]},
      {"heading": "Metadata", "items": [
        {"label": "Category", "value": "[category]"},
        {"label": "Priority", "value": "[priority]"}
      ]}
    ]
  }
}
```

Use AskUserQuestion:
- "Save to GOAL&REQUIREMENTS.md"
- "Revise goal"
- "Revise description"
- "Start over"

### Step 8: Project Name

Use AskUserQuestion and clarify the project/feature name; suggest 3—5 options.

**Question — What is the project/feature name:** (for new project/feature only) 
- [suggested name 1] [brief explanation] — Suggest name and description
- [suggested name 2] [brief explanation] — Suggest name and description 2
- ...    — Suggest name and description 3, 4
- "[suggested name 5] [brief explanation]" — Suggest name and description 5
- "Other: _____" — User input name himself
- "Provide more options" — generate list of suggested names and explanations, let user choose

### Step 9: Save Output

1. Write `GOAL&REQUIREMENTS.md` with proper md and required output formatting
2. Confirm: "Goal and description are saved to GOAL&REQUIREMENTS.md"
3. Show file path as clickable link: `[GOAL&REQUIREMENTS.md](./GOAL&REQUIREMENTS.md)`

### Step 10: Registry Integration

Update `.specs/registry.json` (if exists; create and update if doesn't):
1. Add entry with `type: "goal-and-requirements"`, `status: "active"`, `tags: ["{priority}", "{category}"]`
2. If code exists and modules are detected, add `references` links to affected module specs

### Step 11: Show Progress

Show updated workflow position by calling `bonsai_visualize` with type `progress-tracker` (update the vizId `workflow-progress` so the existing card refreshes):
```json
{
  "type": "progress-tracker",
  "title": "Specification-Driven Development",
  "vizId": "workflow-progress",
  "data": {
    "steps": [
      {"label": "Goal & Requirements", "status": "current", "file": "GOAL&REQUIREMENTS.md",
       "substeps": [
         {"label": "Goal", "status": "done"},
         {"label": "Requirements", "status": "current"}
       ]},
      {"label": "Architecture", "status": "pending", "file": "DESIGN_DOC.md"},
      {"label": "Module Specs", "status": "pending"},
      {"label": "Task Specs", "status": "pending"},
      {"label": "Implementation", "status": "pending"}
    ]
  }
}
```

## Example Output

```markdown
* Project\Feature name: TaskMan
* Category: new-project
* Priority: high

## Goal

Build a RESTful API for task management that supports CRUD operations with authentication and data persistence.

## Description

A production-ready REST API that enables users to create, read, update, and delete tasks through HTTP endpoints. The API includes JWT-based authentication, input validation, and PostgreSQL database integration. It is designed for integration with web and mobile front-end applications.

## Requirements / Technology stack

  [Requirements, constraints, and Technology stack; No architecture yet]

```

## Step-by-Step Guided Process For Specifying Requirements and Technology stack

On this stage you are creating **Project Requirements** — the bridge between the project goal and technical implementation. Gather business, technical, and non-functional requirements interactively.

Important:
- Offer **3-5 choices** per question
- Use web search if needed to examine solutions
- Use `bonsai_visualize` tool with structured data for visualizations (summary boxes, progress trackers)
- NEVER use Bash, echo, printf, or ANSI escape codes for visual output
- If some requirements or constraints are clear from the context, explicitly notice it to user and offer to add them one-by-one

### Output

Update `GOAL&REQUIREMENTS.md` at the project root with:

```markdown
# Requirements 

## Business Requirements

| Requirement | Priority | Rationale |
| --- | --- | --- |
| [Description] | [critical|high|medium|low] | [Why this is needed] |
... (more requirements)

## Technical Requirements

* technology_stack
  | --- | --- |
  | language | [Language] |
  | framework | [Framework if any] |
  | database | [Database if any] |
  | other | [Other key technologies] | --- one by one
 ... (more)
* constraints
  | Constraint | Type |
  | --- | --- |
  | [Description] | [technical|time|resource|regulatory] |
  ... (more constraints)
* Non-functional
  | Category | Requirement | Priority |
  | --- | --- | --- |
  | [performance|security|scalability|maintainability|usability|reliability|portability] | [Specific requirement] | [critical|high|medium|low] |
  ...(more)

```

### VISUALIZATION

During each step always show current state of requirements summary using `bonsai_visualize` with type `summary-box`. If some information is yet missing show `to be defined`. Use section `status` to highlight progress (`done`, `current`, `pending`, `skipped`):
```json
{
  "type": "summary-box",
  "title": "Requirements Summary",
  "vizId": "requirements-summary",
  "data": {
    "sections": [
      {"heading": "Business Requirements", "status": "done", "items": [
        {"label": "[HIGH]", "value": "Requirement 1"},
        {"label": "[MED]", "value": "Requirement 2"},
        {"label": "[LOW]", "value": "Requirement 3"}
      ]},
      {"heading": "Technology Stack", "status": "current", "items": [
        {"label": "Language", "value": "[Language(s)]"},
        {"label": "Frameworks", "value": "[Frameworks]"},
        {"label": "Database", "value": "[Database]"},
        {"label": "Build system", "value": "to be defined"}
      ]},
      {"heading": "Key Constraints", "status": "pending", "items": [
        {"label": "1", "value": "[Constraint 1]"},
        {"label": "2", "value": "[Constraint 2]"}
      ]},
      {"heading": "Non-Functional", "status": "pending", "items": [
        {"label": "Performance", "value": "[Requirement]"},
        {"label": "Security", "value": "[Requirement]"}
      ]}
    ]
  }
}
```

### Step 1: Business Requirements

Ask: "Who are the stakeholders and what do they need?"

Use AskUserQuestion (multiSelect: true):

**Which types of requirements should we capture?**
- "User/customer needs" — What end users need from the system
- "Feature requirements" — Specific capabilities to implement
- "Business constraints" — Budget, timeline, compliance needs
- "Performance expectations" — Speed, throughput, capacity targets

For each selected type, interactively gather 2-5 requirements.

After gathering requirements, assign priorities via AskUserQuestion (multiSelect: true):

**Which are HIGH priority requirements?**
- "[requirement 1]"
- "[requirement 2]"
- ...

**Which are MEDIUM priority? (remaining)**
- "[requirement A]"
- "[requirement B]"
- ...

(Remaining unselected are LOW priority)

Show drafted requirements and confirm:

Use AskUserQuestion:
- "Yes, these look good"
- "Add more requirements"
- "Revise existing requirements"
- "Change priorities"

### Step 2: Technical Requirements — Technology Stack

Use AskUserQuestion for each:

**Programming Language?**
- "Python"
- "JavaScript/TypeScript"
- "Go"
- "Rust"
- "Kotlin"
- "C/C++"
- "To be determined"
- "Other: _____"

**Framework/Libraries?** (suggest based on language and goal; multiSelect: true)
- "[Suggested framework 1]"
- "[Suggested framework 2]"
- "No framework needed"
- "To be determined"
- "Other: _____"

**Database?** (if applicable)
- "PostgreSQL"
- "SQLite"
- "MongoDB"
- "No database needed"
- "To be determined"
- "Other: _____"

**Test setup**
- "Unit tests" — `cargo test` / `npm test` / `pytest` (auto-detect from files)
- "Unit + Integration tests" — Both unit and end-to-end tests
- "No tests yet" — Testing not set up (note this in spec)
- "Other: _____" — let user specify

### Step 3: Technical Constraints

Use AskUserQuestion (multiSelect: true):

**Are there any constraints to consider?**
- "Must run on specific platform (Windows/Linux/Mac)"
- "Must integrate with existing systems"
- "Limited development time"
- "Security / compliance requirements"

For each selected, drill down with specific questions.

### Step 4: Non-Functional Requirements

Use AskUserQuestion (multiSelect: true):

**Which aspects are important for this project?**
- "Performance (speed, latency, throughput)"
- "Security (authentication, authorization, data protection)"
- "Scalability (handling growth)"
- "Maintainability (code quality, testing)"

For each selected, ask for specific requirement:

Use AskUserQuestion:
- "[Suggested specific requirement 1]"
- "[Suggested specific requirement 2]"
- "[Suggested specific requirement 3]"

### Step 5: Review and Validate

Show complete requirements visualization (the VISUALIZATION pattern above, fully filled in).

Use AskUserQuestion:
- "Save to GOAL&REQUIREMENTS.md"
- "Add more requirements"
- "Revise existing requirements"
- "Remove some requirements"
- "Start over"

### Step 6: Consistency Check

Before saving, verify:
1. Requirements align with goal and description from `GOAL&REQUIREMENTS.md`
2. Technical choices support business requirements
3. No contradictory requirements
4. At least 2-3 high-priority business requirements exist

If issues found, show them in plain markdown:

> **Warning: Consistency Issues**
> - [Issue 1]
> - [Issue 2]
>
> **Suggested resolutions:**

Use AskUserQuestion:
- "[Resolution option 1]"
- "[Resolution option 2]"
- "Proceed anyway"

### Step 7: Update GOAL&REQUIREMENTS.md

Using all gathered information, write (update) of GOAL&REQUIREMENTS.md following this template:

```markdown

[existing text]

## Requirements

[Requirements VISUALIZATION that you showed user as progress]

[Detailed structured requirements list, if needed]
```


## After Completion

**What's next?**
- "/architecture-design — Document the system architecture (Recommended)"
- "/spec-status — Check overall specification coverage"
- "Done for now"

## Key Principles

- **Goal first**: A clear goal guides everything else
- **Brevity**: Keep goal and description concise and focused
- **Clarity**: Ensure goal is unambiguous and measurable
- **Visual**: Use `bonsai_visualize` for all structured displays (progress, summaries, confirmations)
- **Interactive**: Every decision through multi-choice questions
