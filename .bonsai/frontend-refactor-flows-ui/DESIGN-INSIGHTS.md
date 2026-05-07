# Ticket View — Design Insights

> Distilled from 8+ iterations, ~30 mockups, and extensive user feedback.

## Core Principle

**It's Claude Code, but for tickets.** The conversation is the backbone. But this conversation produces *persistent artifacts* that accumulate alongside it. And the layout adapts to what each phase needs.

## The Two Zoom Levels

- **Zoomed in (default)**: You're in the conversation. Artifacts appear naturally within or near it.
- **Zoomed out (on demand)**: Phase-adaptive views — each phase gets its ideal layout for the work being done.

The user explicitly prefers **Option C (Phase-Adaptive)** over a dashboard overview, but with conversation remaining the backbone.

## Phase-Specific Intensity

| Phase | Nature | What's Needed |
|-------|--------|---------------|
| **Describe/Brainstorm** | MOST conversational — lots of agent questions, back and forth | Chat is king. Artifacts (description, product design) appear as outputs. Product design built iteratively section by section. |
| **Specify** | Review process — finding inconsistencies in spec diffs | Need to SEE artifacts (diffs) clearly while discussing. Side-by-side layout. Ability to flag issues and fix in-place or backtrack. |
| **Plan** | Also conversational — "how to organize?", "what milestones?" | Need to see the plan being built. Questions about structure. Same step-card view as Execute. |
| **Execute** | More automated — watch progress, review output | Same view as Plan but steps animate to life. Code preview appears below. |
| **Verify** | Quick check — optional | Run spec-review, see results. |

## What the User Consistently LIKED

- **Tree/list navigation** (not tabs, not pills)
- **Columns concept** (spatial phase overview) — "interesting"
- **Inline wizard** — phases structuring the conversation
- **Adaptive layout** — layout shifting based on focus
- **Agent notes** (not chat bubbles) — subtle inline cards
- **Decision cards** — question + option buttons, collapse after answering
- **One chat, one focus** — even if multiple agent sessions exist behind the scenes
- **Side-by-side horizontal layout** for artifact review (conversation left, artifact right)
- **Iterative document building** — section by section with approval after each
- **Unified plan/execute view** — same step cards, execution animates them
- **Artifact categories** — visual distinction between ticket artifacts, spec diffs, and plan
- **Trail strip for navigation** — horizontal strip with categorized chips replaces bottom tabs

## What the User Consistently REJECTED

- Chat messages inside diffs — diffs must be clean documents
- Permanent chat panels on the right
- Popups/overlays — break navigation flow
- Tab-style artifact navigation — "too flat, misleading"
- Bottom nav tabs for switching between diffs — redundant with trail strip
- Tiny icons as only navigation
- Duplication — same info in multiple places
- Prescribed flow ("Next Action" banner) — too rigid
- Chat-like messages (avatars, names, timestamps) in documents
- Vertical header-over-conversation layout (F1) — "horizontal will be better"
- Static mockup snapshots — "I need to feel the flow"
- Product design appearing all at once — needs to be iterative

## Key User Quotes

> "What about making experience for user like I have one chat (maybe inside it will be a lot of agent sessions, but anyway). Like one focus and one chat, but something around helpers to track artifacts, states, be able to revise something, be able to navigate to different aspects of ticket."

> "Artifacts can be (but not must be) in chat, but maybe in different way, like on top of chat or near text field or as heading of chat."

> "If the intention is simple and quick so user can make it one-way, it's important to feel it very smoothly, like you're in one chat in Claude Code."

> "The most intense part for user is describing and brainstorming, because there are a lot of questions from agent."

> "When you leave it and back in an hour, your first question is like 'what is this about'."

> "During reviewing, have an opportunity to back to conversation/description to make retro."

> "It's important to have possibility to back to make retro or adjustment."

> "I didn't see how user works with plan, I didn't see any conversation. I need to feel flow."

> "Header maybe interesting, but I don't like such layout, maybe horizontal will be better."

> "Artifacts should be visually different and user can understand what disposable, what's not, or what related to ticket only and what to specs."

## Critical Requirements

### 1. Retro/Backtracking is First-Class
- From Specify → back to description to rethink
- From Plan → back to specs to adjust
- From anywhere → fix now or return to previous stage
- Forward flow, but free navigation
- Clickable inline cards + trail strip for backtracking

### 2. Simple Tickets = Smooth One-Way
- Don't force structure on simple things
- Should feel like one chat in Claude Code
- Phase-specific views only when needed

### 3. Shareable Artifacts ≠ Shareable Session
- Artifacts (description, diffs, plan) persist and are shareable
- Session (conversation) is private, per-user
- Another user sees artifacts + status, not your conversation

### 4. Ticket-Level Voice
- Need to comment on the ticket overall: "implementation is buggy", "let's adjust the approach"
- Not just file-level interaction
- Notes travel with the ticket when shared

### 5. Agent Communication
- Inline notes (ℹ cards) — contextual, not chatty
- Decision cards — question + buttons, collapse after answering
- NOT chat bubbles with avatars/timestamps
- Questions can appear in diffs as annotations but hide after answering

### 6. No Duplication
- Each piece of information appears ONCE
- Navigation shows list, content shows detail
- Trail strip = navigation, artifact panel = content

### 7. Artifact Types are Visually Distinct
- **Ticket artifacts** (description, product design) — purple accent, 📋 icon
- **Spec diffs** (module READMEs, DESIGN_DOC) — yellow accent, 📄 icon
- **Plan** — blue accent, 📦 icon
- Categories visible in trail strip, artifact panel badges, inline cards

### 8. Code Diffs Viewable
- Spec diffs during Specify phase
- Changed code files during Execute phase
- Both need proper diff viewers in the side panel

### 9. Verification Step
- Optional verification at the end (spec-review skill)
- Run checks to verify specs match implementation

## v6 Validated Patterns (from flow-v2 mockup)

These patterns were tested and approved in the interactive walkthrough:

| Pattern | Status | Notes |
|---------|--------|-------|
| Full-width conversation as default | ✅ Validated | Claude Code feel |
| Side-by-side split for artifact review | ✅ Validated | Conversation 45% left, artifact 55% right |
| Smooth CSS transition for split | ✅ Validated | 0.4s cubic-bezier |
| Phase chips with full words | ✅ Validated | Describe › Specify › Plan › Execute |
| Iterative product design (section by section) | ✅ Validated | Goal → Stories → Roles → Full doc |
| Trail strip with category markers | ✅ Validated | Ticket │ Specs │ Plan grouping |
| Clickable inline cards for backtracking | ✅ Validated | Peek mode without affecting flow |
| Unified plan/execute step cards | ✅ Validated | Same view, execution animates steps |
| Code preview during execution | ✅ Validated | Below step list, lines animate in |
| Auto-play + interactive modes | ✅ Validated | Space/→/Esc controls |

## Mockup Archive

All mockup experiments are in `mockups/` and `mockups/archive/`.

### v6 (Phase-Adaptive — current)
- **Flow v2** (`model-flow-v2.html`): Full interactive walkthrough. THE REFERENCE. Iterative doc, side-by-side, trail strip, unified plan/exec, artifact categories.
- **Flow v1** (`model-flow.html`): Earlier walkthrough without backtracking or iterative doc.
- **F1 (Living Header)**: Artifacts above conversation. Vertical layout REJECTED — "horizontal better".
- **F2 (Inline Journal)**: One scrolling stream. Too much like option A.
- **F3 (Focus Shift)**: Temporary split. Concept validated → became flow-v2's side-by-side.

### v5 (Earlier explorations)
- **Model A (Adaptive Split)**: Tree + chat mode / review mode. Permanent right panel rejected.
- **Model B (Inline Wizard)**: Chat IS the wizard with phase sections. Good for fast track.
- **Model D (Smart Columns)**: Phase columns that expand/collapse. Interesting spatial concept.
- **Model C (Top-Down)**: Full-width per phase with tabs. Too flat.
- **Model Best (Flow-Guided)**: Next Action banner + full-width content. Too rigid/prescribed.
- **Model E (Artifact-as-Page)**: Breadcrumb + minimap. Avatars in diffs rejected.

## Direction for Next Session (v7)

Build on flow-v2 as the base. Three new concepts to explore:

### 1. Subsessions
Focused sub-conversations for specific tasks that consume their own context:
- Building a product document
- Improving decisions within a specific spec area
- Research before answering a question
- Discussing and building a plan

**How subsessions are created:**
- Agent suggests via question ("This needs deeper discussion. Open a subsession?")
- User clicks artifact + types input
- User selects a skill (bug-fix, research, feature design, etc.)

**Key question:** How does the subsession relate to the main conversation? Options: inline expansion, separate panel, same panel with breadcrumb, overlay.

### 2. Advanced Mode
For experienced users who want more visibility:
- More info about subsessions (context usage, duration)
- Artifact-centric or ticket-centric layout options
- Deeper tracking of what changed, when, by whom
- Maybe a timeline/log view

### 3. Artifact Position
Move artifacts from trail strip (top) to a left list/sidebar:
- More space for artifact names
- Hierarchical grouping (ticket → specs → plan)
- Better for many artifacts
- Could combine with subsession indicators
