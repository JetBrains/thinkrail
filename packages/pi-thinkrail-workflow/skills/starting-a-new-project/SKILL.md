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
project and dropped you into its setup chat — the user arrived with only an idea and no repo. This
section **overrides** the Method/Flow below: keep the brief lightweight and let the conversation, not a
preset questionnaire, decide what you ask.

1. **Open with exactly this message — nothing more** (plain chat; the user has said nothing yet). Do
   **not** mention specs, git, repositories, workspaces, `goal-and-requirements.md`, or any technical
   setup here:

   > Tell me what you want to build. A few things that help:
   >
   > 1. What do you want to build?
   > 2. Who is it for?
   > 3. What should users be able to do?
   >
   > You don't need to answer everything — just tell me what you know.

   Those three lines are *guidance* for one freeform reply in the composer — **not** a questionnaire
   widget and **not** required fields. Wait for the user's single freeform message.

2. **Then generate contextual follow-ups — never walk a preset list.** Read what the user actually
   wrote, work out which important **product decision** is still genuinely open, and ask about *that*.
   Never re-ask the three opening questions, anything already answered, or anything you can reasonably
   infer/decide yourself. Each follow-up is an **`ask_user_question`** round (the existing widget,
   composed per the **asking-user-questions** concept): one contextual question, a few sensible
   suggested answers when you can, and the widget's own freeform/custom answer. **Group** related
   decisions into a single round rather than many tiny interruptions. Favor questions that shape the
   product (how something works, whether accounts/persistence exist, how data combines) over trivia.

3. **Accumulate context; stop early.** Every round must account for **all** previous answers — the loop
   is: understand → find the single most important missing decision → one contextual round → fold the
   answer in → repeat only if something important is still open. Ask the **minimum** rounds for a
   useful initial concept; there is no fixed number, and often one round is enough.

4. **Name the project last**, once you have enough context — a final `ask_user_question` round:
   suggest one concise name inferred from the conversation as the first option and let the user confirm
   or replace it (the widget's freeform answer). If the user **already named it** earlier, reuse that
   name and only ask to confirm when there is real doubt — never finalize a name the user hasn't seen.

5. Then run the unchanged tail: save `goal-and-requirements.md` titled with the confirmed name (the
   Saving steps below), call **`finalize_project({ name })`** once with that exact name, and end with a
   short contextual ready message preserving the model **Project → its Default workspace for the main
   checkout → additional Workspaces for isolated branch/worktree tasks** (e.g. "Your project is ready.
   I created *<name>* and captured the concept in `goal-and-requirements.md`. Start working here in the
   Default workspace, or spin up a separate workspace for an isolated task/branch."). This replaces the
   **Next** hand-off for the hosted entry.

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
