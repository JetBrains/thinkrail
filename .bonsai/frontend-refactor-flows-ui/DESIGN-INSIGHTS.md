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

## v7 Experiment Results

### G1 (Inline Subsessions) — Liked concept, needs rethink
- Too few subsessions — should be EVERYWHERE (product design, each execution, verification)
- Design too heavy — should feel like collapsible MD sections, seamless with chat
- Missing: artifact → subsession path (click artifact + "discuss" button)
- Nested subsessions interesting but maybe overkill

### G2 (Left Sidebar) — Preferred ✓
- "Liked it a bit more" — preferred over trail strip for artifact navigation
- Natural home for subsession tree

### G3 (Advanced Mode) — Partial hit
- Interesting but expected layout CHANGE, not just info density
- Power users want different arrangement, not just more numbers

### G4 (Panel Subsessions) — Limited by single panel
- Can't see artifact + subsession simultaneously
- Need to support multiple subsessions or at least artifact peek during subsession

## Fundamental Insight: Subsessions ARE the Architecture

**The main thread is NOT where work happens.** It's the orchestration layer — routing between subsessions, showing summaries, letting you navigate.

**Subsessions are where ALL focused work happens:**
- 📋 Building the description
- 📋 Building the product design
- 📄 Reviewing each spec diff (each is its own subsession)
- 🔬 Research (nested inside a review subsession)
- 📦 Building the plan
- ⚡ Executing each plan step
- ✓ Running verification

**This is NOT a special mode.** Subsessions are the default unit of work. A simple ticket might only have 1-2 subsessions. A complex ticket might have 15+.

### Key Design Constraint: Context Transparency
> "User should understand what's in context, what's not. No big surprises."

Each subsession has its own context boundary. The UI must make this obvious without being annoying. How exactly — needs experimentation.

### Creation Paths for Subsessions
1. **Workflow**: Agent suggests or auto-creates as part of the ticket flow
2. **Artifact interaction**: User clicks artifact + action button ("discuss", "improve", "research")
3. **Skill selection**: User picks a skill (research, design, bug-fix) from a menu
4. **Typing**: User describes what they want to focus on

### Open Questions — Need More Experiments
- **View model**: Does subsession take over the view? Stay inline? Hybrid?
- **Sidebar structure**: Subsession tree? Artifacts mixed in? Something else?
- **Context indicator**: Visual boundary? Implicit via navigation? On-demand?
- **Multi-view**: Artifact + subsession simultaneously?
- **Seamless feel**: How to make subsessions feel like MD sections, not separate worlds?
- **Advanced mode**: Layout change vs info density — what do power users actually want?

## v8 Experiment Results — OVERCORRECTION

H1/H2/H3 all made the same mistake: replaced the conversation with subsessions.

### What broke:
- **Lost artifacts** — sidebar showed subsession names, not artifact names
- **Lost the main conversation** — became too thin, just summaries
- **Lost workflow** — agent should guide ("review these diffs") → user decides to discuss or just approve
- **Lost ticket context** — no ticket summary/description visible
- **Can't see subsession history** — collapsed subsessions are opaque

### Correction:
- **Subsessions ≠ replacement for conversation.** They're context isolation helpers WITHIN the main chat.
- **Main conversation stays primary.** User input, agent guidance, workflow decisions — all in main chat.
- **Artifacts must be visible.** Sidebar shows ARTIFACTS, not subsession names.
- **Subsessions are optional depth.** Simple: approve in main chat. Complex: open a subsession for discussion.
- **Ticket summary always visible** somewhere (top of sidebar, header).

## v9/v10 Results — Subsession Model Crystallized

### Confirmed subsession lifecycle:
1. **Creation**: User clicks artifact button ("Discuss..."), types intent, or agent suggests
2. **Opening**: Inline in conversation (J1-style subtle dividers), own context
3. **Nesting**: If subsession spawns a nested one → TBD: inline vs forced takeover (needs experiment)
4. **Finishing**: Show OUTPUT CARD (artifact produced, summary, decisions) — NOT conversation history
5. **Retro**: User can expand output card to see full history

### Reviews are NOT subsessions by default:
- Agent: "Created auth/README.md" → notification with [Approve] [Discuss...]
- User clicks Approve → done in main chat, no subsession
- User clicks Discuss → subsession opens for that artifact

### Subsession metadata:
- Name/title, skill type, parent, context info
- Output: artifact, summary, report, decisions made

### Key v10 feedback:
- J1 (seamless) is the right direction for visual style
- Output cards > inline history for finished subsessions
- User creation paths still missing — need artifact buttons + chat buttons
- Nesting: J1-style might work if subtle enough, or may need takeover — experiment
- J3 tiling: concept interesting but needs real tiling management (pin, move, resize)

## v9 Experiment Results

- I1 (sidebar + inline): Right direction, but only 2 subsessions shown, no user creation path
- I2 (sidebar + sessions toggle): Same issues, sessions section confirmed useful but needs more content
- I3 (optional focus): Focus mode needed but was broken visually. Separate input for subsession vs main = wrong (one focus at a time)
- I4 (dual-pane): Interesting tiling direction but had artifact duplication between sidebar and workspace

## v10 Experiment Results

### J1 (Seamless) — RIGHT DIRECTION
- Subtle dividers work well for subsessions
- But: subsessions not collapsed after finishing (should show only output card)
- Missing user-initiated creation (from artifact or from intent)
- Don't auto-create subsessions for every review — only when user has questions
- Need focused view as an OPTION (button), not forced

### J2 (Structured) — Too heavy
- Bordered blocks too visually heavy for inline subsessions
- No input inside subsessions, no focused view
- Nested subsessions overloaded the visual structure

### J3 (Tiling) — Incomplete
- No actual tiling management (can't pin, move, resize)
- Concept needs more work to be testable

## K-Merged: Superseded (model-k.html)

Original K1+K2 merge. Had curly-quote syntax errors, monkey-patched shared engine, output-card collapse style. Superseded by K-Final.

## v12 K-Final: Current Reference (model-k-final.html)

Complete rebuild from scratch — fully self-contained (2584 lines, zero external deps).

### Architecture
- **Self-contained**: All CSS, data, engine, script inline. No shared/engine.js dependency.
- **Native step handling**: Single `exec()` dispatcher handles all 18 step types. No monkey-patching.
- **Clean state**: Single `S` object. Subsession stack (`S.ssStack`), focus stack (`S.focusStack`).
- **Message routing**: `getTarget()` helper routes messages to active subsession body or convInner.

### Chat-Style Messages
- **No citation borders** — agent messages and user messages are rounded bubbles with different backgrounds
- Agent: `background: var(--surface)`, no marker
- User: `background: var(--elevated)`, small purple dot
- Validated through CD collapse experiment — citation-style left borders felt misleading

### Subsession Lifecycle: Scope Sections (CD Pattern)
Evolved through 4 collapse experiments (A: Folded Section, B: Thread Summary, C: Animated Card, D: Section with Footer) → CD hybrid chosen.

**Active subsession:**
- `.ss-section` wrapper with thin 1px scope line on left (`#2d333b` — like code editor indent guides)
- `.ss-header` with icon + name + optional "Focus →" button
- `.ss-body` contains all messages (routed by engine via `getTarget()`)
- Scope line is always subtle — no glow, no color change between active/finished

**Finished subsession:**
- Header gains `✓ result` badge
- Rich `.ss-output` summary appears: artifact name, sections, key decisions
- `.ss-body` collapses via `max-height` transition (0.5s cubic-bezier)
- `.ss-toggle` shows "Show full history · N messages" — click to expand
- **Expanding shows messages in ORIGINAL style** — no style change from active state

**Key insight**: The subsession ALWAYS looks like a section — never transforms into a card. Visual continuity between active, collapsed, and expanded states.

### Focus Mode: Stack-Based Takeover
- Click "Focus →" on any subsession header
- Conversation replaced with ONLY that subsession's content (CSS: hide non-focus-target siblings)
- Focus bar at top shows clickable breadcrumb trail: `AUTH-42 › 🔬 JWT Research › 📝 Token Rotation`
- **Stack navigation**: Each Focus click pushes to `S.focusStack`. Back/Esc pops one level. Breadcrumb items clickable to jump to any level.
- **Live updates**: Messages route into subsession body via `getTarget()`, naturally visible in focus view
- **Focused section loses chrome**: scope line, header, Focus button all hidden — content becomes the conversation
- **Parent sections filter**: When focused on a nested subsession, parent section content is hidden, only the focused child chain is visible

### Known Issues
- Nested focus filtering CSS needs refinement — parent messages can leak through in some cases
- Focus auto-exit on subsession finish not fully tested
- User creation paths for subsessions still missing (artifact buttons + typing)

### Reviews (unchanged from K-merged)
- Review notification cards with [Approve] [Discuss] [Research] buttons
- Approve resolves inline — no subsession needed
- Discuss/Research would open a subsession

### What's Working Well
- Auto-play through all 116 steps with varied timing
- Interactive mode with pause at user/decision/approve steps
- Sidebar with ticket summary + artifact groups
- Artifact panel with diffs, iterative doc building, plan/exec panels
- Keyboard shortcuts: Space (play), → (step), B (sidebar), Esc (back/reset)

## Collapse Experiment Results

Four mini mockups tested different subsession collapse styles:

| Experiment | File | Verdict |
|-----------|------|---------|
| A: Folded Section | `exp-collapse-a.html` | Good concept but divider line gets cluttered with summary info |
| B: Thread Summary | `exp-collapse-b.html` | Cleanest but too subtle — easy to miss in long conversations |
| C: Animated Card | `exp-collapse-c.html` | Good animation but card style too different from active subsession |
| D: Section with Footer | `exp-collapse-d.html` | Right direction — always a section — but yellow border too heavy |
| **CD: Hybrid** | `exp-collapse-cd.html` | **Winner** — D's section concept + C's animation + code-editor scope line |

**Key feedback that shaped CD:**
- "Messages should look like chat, not citations" → removed left-border message style
- "Scope line should be tiny, like code editors" → 1px `#2d333b`, no glow
- "Missing output info like artifact/summary" → rich output section with artifact, decisions, sections
- "Card and subsession styles are too different" → section stays a section, never becomes a card
- "History shouldn't change style" → expanded messages identical to active state

## Direction for Next Session

### Focus mode fixes
- Nested focus CSS filtering (parent message leak through to child focus)
- Focus auto-exit when focused subsession finishes
- Smooth transitions entering/exiting focus
- Breadcrumb click navigation between levels

### User-initiated subsessions
- **From artifacts**: Click artifact in sidebar or inline card → action menu (Discuss, Research, Improve, Plan changes, Report bug) → opens a targeted subsession with that artifact in context
- **From request**: User types intent in main chat ("let me research JWT expiry") → agent recognizes and wraps in a subsession
- **From agent suggestion**: Agent suggests "Want me to dig deeper into X?" → user approves → subsession opens
- How should the creation flow feel? Modal? Inline expansion? Just starts?

### Subsession configuration
- **Skill selection**: Which skill drives the subsession (research, design, bug-fix, planning, custom)
- **Model selection**: Which model to use (cheaper for research, stronger for design)
- **Context control**: What context goes into the subsession — user should understand what's in scope
- Where does config UI live? On the ss-header? A settings popover? Before the subsession starts?
- Should config be visible after creation or hidden?

### Subsession output visualization
- **Output types**: What can a subsession produce?
  - Artifact (file created/modified — product-design.md, spec diff, plan)
  - Report (research findings, analysis, comparison)
  - Decision log (choices made, options rejected, rationale)
  - Summary (condensed version of the conversation)
  - Nothing (pure discussion, context-gathering)
- **Display**: How to show each type in the collapsed output section?
  - Artifact outputs: file name + status (created/modified/approved) + link to view
  - Reports: key findings as bullet points
  - Decisions: decision name + chosen option
  - Mixed outputs: prioritized list
- Should output cards be interactive? (click artifact to open in panel, click decision to see reasoning)

### Advanced mode
- G3 explored info density toggle but user wanted **layout change**, not just more numbers
- What power users actually want: different arrangement of the same components
- Ideas to explore:
  - Side-by-side conversation + artifact (permanent, not just during review)
  - Subsession tree visible alongside main conversation
  - Token/cost counters, timing info, model indicators
  - Diff between subsession context and main context
  - Keyboard-driven navigation between subsessions
- Should advanced mode be a toggle or a separate layout?

### Sessions/subsessions tree
- Currently sidebar shows artifacts grouped by phase (Ticket/Specs/Plan)
- Missing: a tree view of all sessions and subsessions
  - Shows nesting: Main → Build Product Design → JWT Research → Token Rotation
  - Shows status: active, finished, collapsed
  - Click to navigate (scroll to or focus on)
  - Shows output summary on hover
- Where does this live? Sidebar tab? Separate panel? Inside artifact sidebar?
- Relationship to breadcrumb: tree is the full map, breadcrumb is your current path

### Ticket layout: header/sidebar duplication
- Status bar shows: AUTH-42 badge, ticket title, phase dots
- Sidebar summary shows: AUTH-42 badge, ticket title, phase badge
- This is **duplicated information** — violates the "No Duplication" principle
- Options to resolve:
  - Remove sidebar summary, rely on status bar only
  - Remove status bar, put everything in sidebar header
  - Merge: status bar is minimal (just phase dots), sidebar has the full context
  - Responsive: sidebar summary visible when sidebar is collapsed (tooltip), status bar always visible
- Phase dots vs phase badge: do we need both?

### Execution phase
- Currently: plan panel opens, steps animate to done, code preview shows lines appearing
- Needs more thought:
  - How does the user interact during execution? Just watch? Can they pause/intervene?
  - Step-level subsessions: each execution step could be its own subsession (with its own conversation)
  - Error handling: what happens when a step fails? Inline retry? Subsession for debugging?
  - Progress: real-time file changes, test results, build output
  - Code review: should changed files be reviewable inline during execution?

### Verification phase
- Currently: quick typing animation + "all checks passed" message
- Needs more thought:
  - What checks run? (spec-review, tests, lint, type-check)
  - How to show results: pass/fail list? Inline annotations? Diff against specs?
  - What if verification fails? Back to execute? Open a fix subsession?
  - Should verification be automatic or user-triggered?
  - Integration with CI/CD status

### Future experiments
- I4 tiling direction with real tiling management (pin, move, resize)
- Advanced mode with actual layout changes (not just info density)
- More subsession types (research, design, bug-fix, planning)
- Multi-user: what does another user see? Artifacts + status, not your conversation
- Ticket-level comments: "implementation is buggy", "let's adjust the approach"

## Shared Mockup Base (for older experiments)

Files in `mockups/ticket-view/shared/`:
- `base.css` (454 lines) — design tokens, animations, all shared component styles
- `engine.js` (886 lines) — play/pause, step execution, message rendering, artifact panel
- `data.js` (164 lines) — AUTH-42 demo data
- `sidebar.css` (137 lines) — optional sidebar styles
- `sidebar.js` (143 lines) — optional sidebar module
- `template.html` (113 lines) — starter template for new experiments

Note: K-Final does NOT use shared files. New experiments should follow the self-contained pattern.
