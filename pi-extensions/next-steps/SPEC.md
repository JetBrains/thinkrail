---
id: module-pi-next-steps
type: module-design
status: active
title: "@thinkrail/pi-next-steps — one-click next messages for vanilla pi"
parent: module-pi-extensions
tags: [pi-extension, suggestions]
---

## Responsibility

The published, portable half of next-step suggestions. It has one tool, `suggest_next_steps`. The agent
calls it alone when its work on the request is done and nothing else will continue (no remaining plan
steps, no background work or question it waits on), with the messages the user would plausibly send
next. It then writes its final message as the last thing in the turn. In pi's interactive terminal the suggestions appear in a row above the editor, and Alt+N sends one.
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
    items dropped; at most `MAX_SHORTCUTS` = 9, one per Alt+N, extras dropped rather than rejected);
  - `terminate: false`, with a result text that asks for the final message as plain text and no tool
    call after it (`WRITE_ANSWER_TEXT`). The exception is a calling message that already holds a
    non-empty `text` block: then it is `terminate: true` (see *Decisions*);
  - a legacy shape, read but never written: 0.1.0 could return `details` = `{ suggestions: [], refused:
    true }`. Renderers keep it so recorded sessions still read as they did.

  Changing this contract breaks every renderer, including ThinkRail's.
- **`./core`**, import-free at runtime: the name, types, `normalizeSuggestions`, and
  `suggestionsOnBranch(entries)`.

## Decisions

- **Why the main agent writes the suggestions:** see [[module-ext-next-steps]]. That rationale is
  host-independent.
- **Call first, then the final message; the tool never ends the turn.** The final message must be the
  last thing in its response, with no tool call after it. Claude Opus 5.5, Sonnet 5.5 and Fable 5.x return
  prose written immediately before a tool call as a *progress-update* `thinking` block (its signature's
  block kind is `narration`). That block holds only a server-written summary of a sentence or two, which
  can drop code and change facts. No `thinking.display` value returns the full text. On replay the model
  gets its full note back, so it believes the user read it. Text that ends a response is never
  summarized. So the guidance asks for the call first and the answer after it, and `execute` returns
  `terminate: false` with a request for that message. Claude Desktop orders its end-of-turn tool the
  same way. "Alone" stays in the guidance: the call marks that the work is done.
  *Cost:* one more model request per turn that offers suggestions (a cache read; the answer's tokens
  were being generated anyway).
  *Post-mortem:* the first release wrote the answer first and then called a terminating tool. With
  Claude Opus 5.5 (through `claude-bridge` and pi's own `anthropic` provider alike), 34 of 72 local calls
  came without text, 32 of them with the answer narrated, and the user saw a folded Thinking step and
  chips but no answer. A first fix (0.1.0) refused a textless call once and asked the model to write the
  answer "as a normal reply". The retry put the answer before the call again, so it was narrated again:
  2 of 2 retries in the first hours after release. Rejected: refusing more times (each try is narrated
  about half the time, and each costs a request), and rendering narration blocks as the answer (only the
  summary reaches the client). See [Anthropic: progress updates between tool calls](https://platform.claude.com/docs/en/build-with-claude/thinking#progress-updates)
  and anthropics/claude-code#95764.
- **An answer already written as text ends the turn.** Out of habit the model sometimes still writes
  its full answer before the call. When that arrives as a `text` block, it reached the user intact, and
  asking for the final message made the model repeat it word for word: a live run on
  `claude-bridge/claude-opus-5-5` showed 2059 chars before the call and 2193 after. So `execute` reads
  `ctx.sessionManager.getBranch()` and finds the assistant message carrying this call by `toolCallId`.
  It looks it up by id, not as the leaf, because sibling results may already follow it; pi persists the
  message on `message_end`, before tools run. If that message has a non-empty `text` block, the call ends
  the turn as before. Only a message with no text continues the turn: its answer is missing or narrated.
  Text in earlier messages doesn't count, since interim narration ("Let me check…") would excuse a lost
  answer. Without a session manager, or when the message isn't on the branch, the call asks for the
  final message.
- **"The session ends with suggestions" is one rule over the current branch.** Walking back from the
  leaf, the rule skips bookkeeping entries (thinking-level and model changes, usage, custom entries,
  labels, session info) and finished text-only assistant messages (`stopReason: "stop"`, no tool call):
  the final message written after the call. The first remaining entry must be a successful
  `suggest_next_steps` result. Sessions recorded when the call came last match the same rule.
  The bookkeeping skips exist because pi appends a `thinking_level_change` entry on resume, after the result.
  Matching only the leaf hid the row on every resume, which the manual terminal check caught. The rule
  is evaluated on `agent_settled` (cleared instead when aborted), `session_start` and `session_tree`.
  `agent_start` clears the row. ThinkRail's chips apply the same shape over its transcript — the
  round's suggestions call, followed only by its finished final message, plus chat-only conditions (idle, nothing queued, no interactive call, the
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
- normalization (including the nine-item cap), `terminate: false` and the request for the final
  message, blank suggestions included;
- text in the calling message ending the turn, thinking-only or blank text asking for the final
  message, the calling message found by id rather than as the leaf, and an earlier message's text not
  counting;
- the legacy refused result's render;
- an embedder's `guidance` replacing only what it names;
- the branch rule, including skipped bookkeeping entries, the final message after the call, and a
  later tool call or an errored final message hiding the row;
- the row's lifecycle through a fake pi: settle shows it, Alt+N sends and clears it, abort and the next
  run clear it, resume restores it, and RPC mode never shows it;
- wrapping.

`check:pi-packages` loads the packed tarball under Node and runs the execute/terminate/render cases.

Live check for the answer order (vanilla pi at the catalog version, the package plus ThinkRail's
guideline loaded with `-e`, `claude-bridge/claude-opus-5-5` at `high`, a scratch repo with four failing
invoice tests). In a multi-step fix turn, the model wrote a short narrated preview, then the call, then
its full 1811-char answer as the final `stop` text, and `suggestionsOnBranch` read the chips through it.
A follow-up question turn in the same session showed the text-before-the-call duplication described in
*Decisions*.

Manual terminal check with real model turns, run for the first release when the call still ended the
turn (tmux, pi at the catalog version, the packed tarball loaded with `-e`, Claude Sonnet 5.5):
- the row appeared above the editor;
- Alt+2 sent that suggestion and a new turn produced a fresh row;
- resuming the session with `-c` restored the row.

Not checked directly in Ghostty or iTerm2, only through tmux. GNOME Terminal's default Alt+1…9 tab
switching takes the keys first (its documented defaults); the README says how to free them.
