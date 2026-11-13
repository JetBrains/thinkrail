---
"@thinkrail/pi-next-steps": minor
---

First release: a `suggest_next_steps` tool the agent calls as the last action of a finished turn to
offer one-click next messages — follow-ups or short answers to a question it asked. The tool ends the
turn; in the terminal the suggestions appear above the editor and **Alt+1…9** sends one (on macOS the
terminal must send Option as Meta). The row clears when the next run starts and returns when a resumed
session ends with suggestions. Outside the interactive terminal the suggestions stay in the tool
result's `details.suggestions` for hosts to render.
