---
"@thinkrail/pi-next-steps": minor
---

First release: a `suggest_next_steps` tool the agent calls as the last action of a request once nothing
else will continue, to offer up to nine one-click next messages — follow-ups or short answers to a simple
question it asked. The tool ends the run; in the terminal the suggestions appear above the editor and
**Alt+1…9** sends one (on macOS the terminal must send Option as Meta; GNOME Terminal's tab switching
must free the keys). The row clears when the next run starts and returns when a resumed session ends
with suggestions. Outside the interactive terminal the suggestions stay in the tool result's
`details.suggestions` for hosts to render, and `createNextStepsExtension({ guidance })` lets a host add
its own wording.
