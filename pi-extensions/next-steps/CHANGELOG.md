# @thinkrail/pi-next-steps

## 0.1.0

### Minor Changes

- [#1359](https://github.com/JetBrains/thinkrail/pull/1359) [`33372a4`](https://github.com/JetBrains/thinkrail/commit/33372a417021455327d0d4966b47bdd07bf846c6) Thanks [@rsolmano](https://github.com/rsolmano)! - First release: a `suggest_next_steps` tool the agent calls as the last action of a request once nothing
  else will continue, to offer up to nine one-click next messages — follow-ups or short answers to a simple
  question it asked. The tool ends the run; in the terminal the suggestions appear above the editor and
  **Alt+1…9** sends one (on macOS the terminal must send Option as Meta; GNOME Terminal's tab switching
  must free the keys). The row clears when the next run starts and returns when a resumed session ends
  with suggestions. Outside the interactive terminal the suggestions stay in the tool result's
  `details.suggestions` for hosts to render, and `createNextStepsExtension({ guidance })` lets a host add
  its own wording.

### Patch Changes

- [#1466](https://github.com/JetBrains/thinkrail/pull/1466) [`4f1d254`](https://github.com/JetBrains/thinkrail/commit/4f1d25462a70768a5f90dfd686939a5a0a154cff) Thanks [@rsolmano](https://github.com/rsolmano)! - `suggest_next_steps` no longer ends a turn whose message has no text answer. When a model writes its
  final answer only as thinking and then calls the tool, the call is refused once with a request to write
  the answer as a normal reply; the refused result (`details.refused: true`, no suggestions) shows no
  chips, and a second call in the same turn is accepted.
