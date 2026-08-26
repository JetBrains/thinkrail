---
name: starting-a-new-project
description: "Use when the workspace is empty — no code yet — and the user brings a raw idea: the brand-new branch of setting-up-a-project, normally reached via that dispatcher, directly only when the situation is unmistakable. Not for features in an existing project — use brainstorming instead."
---

# Starting a new project

The workspace is empty: no code, no decisions. Turn the user's idea into one clear, buildable document —
`goal-and-requirements.md` — then hand off to `brainstorming` for the features that follow.

**Hold the writing-specs bar.** Read that concept skill before saving anything — it carries the
short / honest / on-rails rules every section you save must meet.

## Hosted create-from-scratch entry

When the **`finalize_project` tool is available**, ThinkRail has already created a real but *unnamed*
project for the user and dropped you into its setup chat — the user came with only an idea and no repo.
In that mode:

1. **Open by asking what they want to build** (a plain chat message — the user has said nothing yet).
   Let them describe it freely; do not present a form.
2. Run the normal Method/Flow below, but keep clarifying questions to the genuine minimum via
   `ask_user_question` (per the **asking-user-questions** concept). Infer or defer anything the answer
   can wait for; never force a fixed questionnaire.
3. **Ask the project name LAST**, via `ask_user_question` — suggest one concise name inferred from the
   conversation as the first option, but let the user provide their own (never finalize a name they
   haven't seen and approved).
4. Save `goal-and-requirements.md` titled with the confirmed name (the Saving steps below).
5. Call **`finalize_project({ name })`** once with that exact confirmed name.
6. End with a short, contextual ready message, preserving this model: **Project → its Default workspace
   for the main checkout → additional Workspaces for isolated branch/worktree tasks.** e.g. "Your
   project is ready. I created *<name>* and captured the concept in `goal-and-requirements.md`. Start
   working here in the Default workspace, or spin up a separate workspace when you want an isolated
   task/branch." This replaces the normal **Next** hand-off for the hosted entry.

Without the `finalize_project` tool (the `setting-up-a-project` dispatcher in a real repo), ignore this
section entirely and follow the flow below as written.

## Method

1. **Build on what's already said.** Never re-ask what the request already told you.
2. **Infer, then confirm** — propose a concrete draft and let the user correct it; a suggestion beats an
   open question. Compose `ask_user_question` rounds per the **asking-user-questions** concept skill
   (read it before the first round — it carries the option, confirmation, and degradation norms).
3. **MVP first.** The right v1 is smaller than the user expects. Every v1 capability must justify itself.
4. **Save incrementally.** Create the file as soon as the first section is settled, then add each
   confirmed section in template order. Don't batch; don't invent unconfirmed content.
5. A skipped question is not a blocker — proceed on the current model and note real gaps inline.

## Working model (infer from the request; never ask these directly)

```
audience:   personal | public | both        domain: what space this is in
tech:       stack mentioned, or null         scope:  small | large
depth:      light | standard | full          creator_is_user: does the maker use it?
```

`depth` scales the document: `light` = a one-liner idea → a few lines; `full` = named competitors /
multiple user types → a full PRD. It can only grow during the conversation, never shrink.

## Fast path — pre-filled brief

If the request already reads like a spec (several headings or a multi-section brief), parse it, treat those
sections as **confirmed**, save them immediately, and only pursue what's genuinely missing and required by
`depth`. Don't ask the user to confirm what they already wrote. The one always-offered extra is
alternatives research (below).

## Flow

1. **Orient** — one line: "Let's nail the goal and scope, then I'll save it as `goal-and-requirements.md`."
2. **Overview** — infer it (`depth`-sized: a sentence → a paragraph naming what it replaces) and confirm.
3. **Problem** — one tailored question referencing the domain (never generic); turn the answer into a
   statement (who / what they do today / the specific breakdown) and confirm. Skip if the Overview already
   implies it.
4. **Route** from the model — don't ask "who's this for" unless genuinely ambiguous:
   personal / first-person pain / `depth=light` → **Personal spec**; public / named users / `depth=full`
   → **PRD**.
5. **Elicit the branch's sections** (below), inferring and confirming each, saving as you go.
6. **Research alternatives** (always offered, never forced): `web_search` + `fetch_content` for the
   closest open-source projects / products, then offer to add an **Alternatives Considered** section
   (name, one-line gap, URL). On a pre-filled brief, ask permission first.
7. **Review** the full draft in plain markdown and confirm, then finalize.

### Personal spec (sections)

`# Title` + one-line tagline · **Overview** · **Problem** · **V1 Features** (only capabilities the tool is
useless without) · **Tech Notes** (stack, or TBD).

### PRD (sections)

`# Title` + tagline · **Overview** · **Problem Statement** · **Target Users** (roles, not demographics) ·
**Jobs to Be Done** ("When [situation], I want [motivation], so I can [outcome]") · **Key User Story**
(one concrete scenario) · **Goals** (verb-first, measurable) · **Non-Goals** · **Success Metrics** /
**Done Conditions** · **MVP Scope** (`In v1` — each item justified against a Goal/Success condition; `Out
of v1`) · **Non-Functional Requirements** (only if they exist) · **Technology** (Aspect | Choice |
Rationale).

Skip any section the model already answers or that `depth` doesn't warrant (`light` → skip Goals/NFRs,
binary Done Conditions instead of metrics). Reject vague goals inline: "'Better UX' isn't a goal —
'first result in under 30s' is."

## Saving

- `spec_create` once, `path: "goal-and-requirements.md"`, a slug `id`, `type: "goal-and-requirements"`,
  `title`, `status: "draft"`; replace the scaffold with the chosen template + the sections settled so far.
- `edit` to add each confirmed section in template order.
- `spec_update` `status: draft → done` once finalized.

## Next

State plainly that the spec is saved. Suggest the natural next step — sketch `architecture.md`, then use
`brainstorming` per feature. There is no board/ticket hand-off — say it and stop: **this workflow ends
here**; feature work from now on routes through choosing-a-workflow → `brainstorming`.
