---
"@thinkrail/pi-visualize": minor
---

Hosts can pass `mockupGuideline` to `createVisualizeExtension` to replace how the prompt guideline tells
the model to write a mockup, for example to allow scripts or name a theme file. The rest of the
guideline stays: show the mockup with `type: "file"`, and copy a proposal to keep it as `before`.
