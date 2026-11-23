---
id: module-pi-next-steps
type: module-design
status: active
title: "@thinkrail/pi-next-steps — one-click next messages for vanilla pi"
parent: module-pi-extensions
tags: [pi-extension, suggestions]
---

## Responsibility

The published, portable half of next-step suggestions. It has one tool, `suggest_next_steps`, which the
agent calls last and alone when its work on the request is done and nothing else will continue (no
remaining plan steps, no background work or question it waits on), with the messages the user would
plausibly send next. In pi's interactive terminal the suggestions appear in a row above the editor, and Alt+N sends one.
The package knows nothing about ThinkRail, which composes it through [[module-ext-next-steps]] and
draws its own chips.

## Public surface

- **Default export**: the `ExtensionFactory` that `pi install` loads. `createNextStepsExtension({
  guidance })` returns the same factory; `guidance` (`NextStepsGuidance`: `description`, `promptSnippet`,
  `promptGuidelines`, the ask-user-question shape) replaces only the wording it names, so a host can add
  its own policy. `createSuggestNextStepsTool({ guidance })` is the bare tool for an embedder that wants
  it without the terminal row.
- **The tool contract** that renderers key on:
  - the name `"suggest_next_steps"`;
  - the arguments `{ suggestions: string[] }`;
  - `details` = `{ suggestions }`, normalized (whitespace collapsed; empty and case-insensitive duplicate
    items dropped; at most `MAX_SHORTCUTS` = 9, one per Alt+N, extras dropped rather than rejected so an
    over-long list still ends the turn);
  - `terminate: true`;
  - except for one refusal per turn (see *Decisions*): a non-error result with `terminate: false` and
    `details` = `{ suggestions: [], refused: true }`, so every reader of `details.suggestions` shows
    nothing for it.

  Changing this contract breaks every renderer, including ThinkRail's.
- **`./core`**, import-free at runtime: the name, types, `normalizeSuggestions`, and
  `suggestionsOnBranch(entries)`.

## Decisions

- **Why the main agent writes the suggestions, and why the tool ends the turn:** see
  [[module-ext-next-steps]]. That rationale is host-independent. pi ends a turn early only when every
  result in the batch terminates, so a call made beside other tools leaves the turn running. The
  guidance says "alone" for this reason.
- **A call whose message has no text answer is refused once per turn.** `execute` reads
  `ctx.sessionManager.getBranch()` and finds the assistant message carrying this call by `toolCallId`
  (not the leaf: sibling results may already follow it). pi persists that message on `message_end`,
  which it awaits before executing tools. When the message has no non-empty `text` block and no
  refused call appears since the last user message, the result asks the model to write its answer as
  a normal text reply and call again, and does not end the turn. A second textless call in that turn is
  accepted, so the refusal can never loop. Without a session manager, or when the calling message is
  not on the branch, the call is accepted as before.
  *Post-mortem:* with Claude Opus 5.5 through `claude-bridge`, half of the calls (19 of 38 in local
  sessions) came in a message with no text — 17 of them carried the final answer as a thinking block
  whose signature is tagged `narration`. The terminating call then ended the turn, and the user saw a
  folded Thinking step and chips but no answer. No plain `stop` turn (0 of 634) lacked text, so the
  terminating tool is what lost the answer.
  *Trade-off:* only the calling message counts. A turn whose answer sits in an earlier message (beside
  another tool call) is refused once, costing a round trip and possibly a repeated answer; counting any
  earlier text would let interim narration ("Let me check…") excuse a lost final answer.
- **"The session ends with suggestions" is one rule over the current branch.** Walking back from the
  leaf, the rule skips bookkeeping entries (thinking-level and model changes, usage, custom entries,
  labels, session info). The first remaining entry must be a successful `suggest_next_steps` result.
  The skip list exists because pi appends a `thinking_level_change` entry on resume, after the result.
  Matching only the leaf hid the row on every resume, which the manual terminal check caught. The rule
  is evaluated on `agent_settled` (cleared instead when aborted), `session_start` and `session_tree`.
  `agent_start` clears the row. ThinkRail's chips apply their own rule over its transcript — the last
  turn ends with the call, plus chat-only conditions (idle, nothing queued, no interactive call, the
  extension switched on; [[submodule-web-chat]], *Composer suggestions*).
- **The terminal row is drawn only when `ctx.mode === "tui"`.** RPC hosts (ThinkRail binds pi as `"rpc"`)
  draw their own affordance from the result. Gating on mode, rather than adding an embedder option,
  keeps the row out of the factory's options and prevents a duplicate row in a host that renders
  widgets. The
  `alt+1…9` shortcuts are registered everywhere but do nothing without offered suggestions.
- **Alt+1…9, the same keys as ThinkRail.** pi has no built-in Alt+digit bindings. On macOS, a terminal
  passes Alt+digit only with Option-as-Meta set; the README documents the setting per terminal. The row
  wraps chips to the terminal width and labels the keys `⌥N` on macOS and `Alt+N` elsewhere.

## Verification

Package tests cover:
- normalization (including the nine-item cap) and `terminate`;
- the missing-answer refusal: text present, thinking only, the second call accepted, an earlier turn's
  refusal not counted, the calling message found by id rather than as the leaf;
- an embedder's `guidance` replacing only what it names;
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

Not checked directly in Ghostty or iTerm2, only through tmux. GNOME Terminal's default Alt+1…9 tab
switching takes the keys first (its documented defaults); the README says how to free them.
