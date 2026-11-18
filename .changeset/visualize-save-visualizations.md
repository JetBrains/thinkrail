---
"@thinkrail/pi-visualize": minor
---

Hosts can keep what the tool draws: `createVisualizeExtension({ saveVisualization })` receives each diagram
or comparison's markdown with the session's `cwd` and returns where it saved it, and the tool result then
names that path for the model. Saving is best effort — a saver that throws never fails the tool — and file
previews are never saved, since they already are files.
