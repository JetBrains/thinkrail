---
"@thinkrail/pi-visualize": minor
---

Add `type: "file"` to `visualize`: show an existing workspace file rendered by its type, or a
before/after diff of two files via `before` — the way to put a UI mockup in front of the user. Hosts can
inject a `checkFile` validator and a `scratchDir` that the tool's prompt guideline points mockups to; the
terminal prints the paths.
