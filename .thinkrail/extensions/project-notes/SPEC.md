---
id: ext-project-notes
type: submodule-design
status: active
title: project-notes — pinned notes in every agent run
parent: module-ext-sdk
depends-on: [module-ext-sdk]
references: [submodule-server-ext, submodule-web-ext, ext-tool-guard, ext-test-runner]
tags: [extensions, example]
---

## Responsibility

Lets the user pin notes (rules, facts, conventions) per project and adds the enabled ones to the system
prompt of every agent run in that project. A ThinkRail UI extension written only against `@thinkrail/ext`
and `@thinkrail/ext/view`; the SDK README's reference for **system-prompt injection** through a
`before_agent_start` hook in `tr.pi`.

## Notes

`Note { id, title, body, enabled, source: user | agent, createdAt, updatedAt }`. `body` is markdown, 1–4,000
characters after trimming; `title` is optional, at most 80 (an empty title shows the body's first line). A
project keeps at most 50 notes, in creation order. The list lives in `tr.store` under `notes:<projectId>`;
an empty list deletes the key. Every write (save, toggle, remove, agent add) runs through one queue per
project, so overlapping writes, such as parallel `add_project_note` calls in one turn, never drop a note.

## Injection

`tr.pi` adds a `before_agent_start` handler to every top-level chat session. It finds the session's project
(`tr.sessions` → workspace → `projectId`; else the workspace whose path contains the session `cwd`) and sets
`event.systemPromptOptions.sections.project_notes`. pi renders it as a `<project_notes>` block after the
built-in sections; with no project or no enabled note the key is removed, so pi's section diff drops the
block from the model's view.

`planInjection` (shared, pure) builds the text: a one-line preamble, then `## <title>\n<body>` per enabled
note, top to bottom, while the total stays within 6,000 characters. The first note that does not fit and
every enabled note after it are **skipped**, never cut. The panel and the status item compute the same
plan, so the UI always says what is sent. Size shows as characters and `~chars/4` tokens: an estimate, not
the model's tokenizer.

A change applies to the next run. A session picks up a reloaded extension version after its current run
settles.

## Agent tool

`add_project_note({ body, title? })` saves an enabled note with `source: agent` in the session's project.
The description tells the model to use it only when the user asks it to remember something. The result
text says whether the note fits under the cap; `details` is `{ note, sent }` for the `toolCard`. It
throws (tool error) outside a project or on a validation error.

## Host half

- Channel `notes:<projectId>`: `Note[]`, published only while a view watches that key (`tr.onWatch`), and
  on every change to a watched project; unpublished when the last view leaves.
- Actions, scoped to the calling view's `ctx.projectId`: `save { id?, title, body, enabled? }` →
  `{ ok: true, note } | { ok: false, error }` (no `id` creates); `toggle { id }`; `remove { id }`.

## Views

- `notes` (panel): header with the active count and **New note**; a budget bar (chars used of 6,000,
  estimated tokens, a warning naming how many notes are past the cap); the note list (enabled switch,
  title, two-line body, token estimate, "added by agent", "over cap, not sent"). Clicking a note opens the
  editor: title, markdown textarea, **Send to agent** switch, live size, Save, two-step Delete.
- `badge` (status): pin icon and the count of enabled notes for the active project; warning colour when
  some are past the cap; hidden at zero. Click opens the panel.
- `add-project-note` (toolCard for `add_project_note`): the pinned note's title and body, sent / over cap,
  and a button to open the panel.

## Boundary

- Public surface: the three surfaces, the actions and channel above, the `add_project_note` tool, and the
  `project_notes` prompt section.
- Host half: `index.ts`, `pi.ts`. Views: the `.tsx` files plus `hooks.ts`. `model.ts` is shared (types,
  validation, `planInjection`; no Node imports).
- Allowed dependencies: `@thinkrail/ext`, `@thinkrail/ext/view`, `react`, `typebox`, Node `crypto` / `path`
  in the host half; pi types only.
- Forbidden: ThinkRail package internals, views importing host-half files, replacing the whole system
  prompt (`systemPrompt` result) instead of owning one section.

## Known limitations

- Notes are per project, not per workspace or branch.
- The token count is `chars/4`.
- No reordering: the oldest notes win when the cap is reached.
- A subagent session does not get the notes (`tr.pi` covers top-level chat sessions only).
- Agent notes are saved enabled, with no confirmation. Text the agent reads (a repo file, tool output, a
  web page) can lead it to pin an instruction that then reaches every later run's system prompt. Chosen
  trade-off: the user asked the agent to remember it, so a disabled note would silently not work. The
  signals are the tool card and the "added by agent" tag; the user turns it off or deletes it in the panel.
