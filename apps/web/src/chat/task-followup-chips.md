---
id: task-followup-chips
type: task-spec
status: done
title: Always-present follow-up action chips above the chat input (mocked source)
parent: submodule-web-chat
---

# Always-present follow-up action chips above the chat input (mocked source)

## Request

A Conductor-style row of outlined pill chips, always present directly above the composer's input
container. Clicking a chip sends its text as the user's reply (same as typing + send). States:

- **Agent asking (priority):** the agent's options render as chips — the row is clearly present.
- **Idle:** a default starter set keeps the row present.
- The row hides only when there are genuinely no chips.

Data comes from a clearly-labelled **mock** for this task (both cases). Do **not** parse the agent's prose
and do **not** invent a streamed field / server contract — real follow-up chips need the agent to emit
its question + options as structured wire data (a contracts change, out of scope). Leave a clear seam.

## Change

- `followUpChips.ts` (new, mock): `FollowUpChip` (`label` shown, `text` submitted), `mockFollowUpChips`
  (`asking` + `idle` sets), and `selectFollowUpChips(isBusy)` — the single seam where the real structured
  source will plug in (documented `TODO(real-followups)`). Returns `[]` ⇒ row hidden.
- `Composer`: new `followUpChips: FollowUpChip[]` prop; renders the row (`data-testid="followup-chips"`,
  chips `followup-chip`) above the bordered input container, styled with the existing outlined-pill
  utilities (`rounded-[var(--radius-lg)] border border-border2 bg-elevated px-sm py-xs text-muted text-xs
  hover:bg-hover hover:text-text` — the same treatment as other pills; no new tokens). `submitChip` calls
  the existing `onSubmit` (steer while streaming, else send); it never touches the draft.
- `ChatView` (integration seam): passes `followUpChips={selectFollowUpChips(isStreaming)}` — MOCK toggle
  so both states are reviewable (busy ⇒ "asking" set, idle ⇒ starters); the real code keys off structured
  follow-up data, not `isStreaming`.

Presentational renderer stays props-driven; `ChatView` remains the only store/transport touch.

## Verification

- lint + typecheck + check:deps green.
- `e2e/chat-followup-chips.spec.ts` (no-agent): the row is present with the idle chips, and clicking one
  lands its text as a `user` chat message with the draft left empty.
- Screenshot confirmed the outlined-pill row directly above the input.
