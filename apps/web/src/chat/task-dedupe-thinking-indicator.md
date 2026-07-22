---
id: task-dedupe-thinking-indicator
type: task-spec
status: done
title: Dedupe the doubled thinking indicator (suppress the stream footer while thinking)
parent: submodule-web-chat
---

# Dedupe the doubled "thinking" indicator

## Problem

While the agent reasons, "thinking" shows twice, stacked: (a) the reasoning **activity step row**
("thinking · N chars" + its own spinner, `ActivityGroup`/`ActivityStepRow`) and (b) the **stream footer**
("● ● ● Thinking…", `StreamIndicator`). Same state, same moment.

## Investigation (findings)

- **Footer label is derived, not fixed.** `streamStatus(turns, currentAssistantId)` (`StreamIndicator.tsx`)
  reads the **last content block** of the active assistant turn → phase: non-empty `thinking` →
  `"thinking"` ("Thinking…"), `text` → `"writing"` ("Writing…"), `toolCall` → `"running-tool"`
  ("Running {tool}…"), else `"working"` ("Working…"). `phaseLabel` maps those. So the footer **does**
  reflect the active step (it is not hard-coded to "Thinking…").
- **The reasoning row already owns the "thinking now" signal:** when the current live step is a
  (non-empty) thinking block, `deriveRows` emits it as an activity step and `ActivityStepRow` renders it
  as the current row with a `Loader2` spinner + "thinking · N chars". Empty thinking is skipped by
  `deriveRows` **and** maps to `"working"` in `streamStatus`, so it never triggers the footer's
  "Thinking…".
- Net: the double only occurs for the `"thinking"` phase, which by construction coincides with a visible
  reasoning row (the trailing live run's current step).

## Fix (structural, one point)

In `ChatView`'s footer-status memo, **suppress the footer when the phase is `"thinking"`** (set
`status = null`), because the reasoning row is the single indicator for that state. All other phases keep
the footer as-is — `"running-tool"` still shows "Running bash…", `"writing"` "Writing…", `"working"`
"Working…" — so the footer's unique information and the "actively working" signal are never lost (the
reasoning row's spinner carries it during thinking). No new streamed fields; pure render dedupe.

## Constraints honored

Running-state only (finished state, message bodies, input/header/tabs/panels untouched); existing
styles/tokens; frontend-only, no wire/contract change.
