---
"@thinkrail/extension-sdk": major
"@thinkrail/example-extension-palette": minor
---

First release of the ThinkRail extension SDK, carrying extension API 1.0. Its major.minor is the API
version, so an extension keeps it in `devDependencies` as `~1.0.0`. It provides the `ServerExtension`
contract that a server half's default export `satisfies` through a type-only import (and the
`defineServerExtension` helper), `defineWebExtension({ name, toolRenderers })`; type declarations for the
modules ThinkRail shares with a web half (`react`, `react/jsx-runtime`, `react-dom`,
`@thinkrail/extension-sdk/web`, `/resources`, `/ui/button`, `/ui/theme`, `/ui/utils`) and the manifest of
the exact names each one exports; and `thinkrail-extension build`, which bundles a web half onto the
app's React and builds its prefixed stylesheet. Ships with the Palette sample extension,
`@thinkrail/example-extension-palette`.
