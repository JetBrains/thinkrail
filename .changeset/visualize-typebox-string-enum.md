---
"@thinkrail/pi-visualize": patch
---

Builds the `type` parameter's string enum with TypeBox instead of pi-ai's `StringEnum`, which is a
pi-schema schema since pi 1.5.0, and drops the `@earendil-works/pi-ai` peer dependency the package no
longer imports.
