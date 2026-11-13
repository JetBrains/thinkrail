---
id: module-pi-next-steps
type: module-design
status: draft
title: "@thinkrail/pi-next-steps — one-click next messages for vanilla pi"
parent: module-pi-extensions
tags: [pi-extension, suggestions]
---

## Responsibility

The published, portable half of next-step suggestions. It has one tool, `suggest_next_steps`, which the
agent calls last and alone when a turn's work is done, with the messages the user would plausibly send
next. In pi's interactive terminal the suggestions appear in a row above the editor, and Alt+N sends one.
The package knows nothing about ThinkRail, which composes it through [[module-ext-next-steps]] and
draws its own chips.

## Public surface

- **Default export**: the `ExtensionFactory` that `pi install` loads. `createNextStepsExtension()`
  returns the same factory and takes no options. `createSuggestNextStepsTool()` is the bare tool for an
  embedder that wants it without the terminal row.
- **The tool contract** that renderers key on:
  - the name `"suggest_next_steps"`;
  - the arguments `{ suggestions: string[] }`;
  - `details` = `{ suggestions }`, normalized (whitespace collapsed; empty and case-insensitive duplicate
    items dropped; no count cap);
  - `terminate: true`.

  Changing this contract breaks every renderer, including ThinkRail's.
- **`./core`**, import-free at runtime: the name, types, `normalizeSuggestions`, and
  `suggestionsOnBranch(entries)`.

## Decisions

- **Why the main agent writes the suggestions, and why the tool ends the turn:** see
  [[module-ext-next-steps]]. That rationale is host-independent. pi ends a turn early only when every
  result in the batch terminates, so a call made beside other tools leaves the turn running. The
  guidance says "alone" for this reason.
- **"The session ends with suggestions" is one rule over the current branch.** Walking back from the
  leaf, the rule skips bookkeeping entries (thinking-level and model changes, usage, custom entries,
  labels, session info). The first remaining entry must be a successful `suggest_next_steps` result.
  The skip list exists because pi appends a `thinking_level_change` entry on resume, after the result.
  Matching only the leaf hid the row on every resume, which the manual terminal check caught. The rule
  is evaluated on `agent_settled` (cleared instead when aborted), `session_start` and `session_tree`.
  `agent_start` clears the row. ThinkRail's chips use the same rule over its transcript.
- **The terminal row is drawn only when `ctx.mode === "tui"`.** RPC hosts (ThinkRail binds pi as `"rpc"`)
  draw their own affordance from the result. Gating on mode, rather than adding an embedder option,
  keeps the factory option-free and prevents a duplicate row in a host that renders widgets. The
  `alt+1…9` shortcuts are registered everywhere but do nothing without offered suggestions.
- **Alt+1…9, the same keys as ThinkRail.** pi has no built-in Alt+digit bindings. On macOS, a terminal
  passes Alt+digit only with Option-as-Meta set; the README documents the setting per terminal. The row
  wraps chips to the terminal width and labels the keys `⌥N` on macOS and `Alt+N` elsewhere.

## Verification

Package tests cover:
- normalization and `terminate`;
- the branch rule, including skipped bookkeeping entries;
- the row's lifecycle through a fake pi: settle shows it, Alt+N sends and clears it, abort and the next
  run clear it, resume restores it, and RPC mode never shows it;
- wrapping.

`check:pi-packages` loads the packed tarball under Node and runs the execute/terminate/render cases.

Manual terminal check with real model turns (tmux, pi at the catalog version, the packed tarball loaded
with `-e`, Claude Sonnet 5.5):
- a bug-fix turn ended with final text, then the call, and the turn ended with no extra round trip;
- the row appeared above the editor;
- Alt+2 sent that suggestion and a new turn produced a fresh row;
- resuming the session with `-c` restored the row.

Not checked directly in Ghostty or iTerm2, only through tmux.
