---
id: module-chat-ui
type: module-design
status: active
parent: architecture
depends-on: [module-contracts, module-locales, module-ui, module-extension-api]
references: [submodule-web-chat, submodule-web-prompt]
title: chat-ui — the shared, store-free conversation UI
---

## Responsibility

The presentational half of ThinkRail's chat, shared by every UI host (`apps/web`, `apps/mobile`): the
transcript model and its derivations (`hydrate` → `rows`), the turn and tool renderers (`turns`,
`ActivityGroup`, `ToolCard`, the built-in `tools/**` cards behind the `toolRegistry`), `Markdown`, the
`Composer` with its model/effort picker, `QueueStrip`, `StreamIndicator`, `ExtUiPrompt`, the Resources
dock/inspector (`resources/`), and the command-aware input behaviour (`prompt/`). Everything here takes
props or reads a context a host provides; nothing reaches a store, a transport, storage, or routing.

The design of these renderers — the turn grammar, progressive disclosure, tool cards, interaction seams,
streaming model — is recorded once in [[submodule-web-chat]] (`apps/web/src/chat/SPEC.md`) with its children
`tools/SPEC.md` and `resources/SPEC.md` (here, beside the code), and [[submodule-web-prompt]]
(`src/prompt/SPEC.md`). Those records govern both halves: a change to a renderer's behaviour updates them.

## Public surface

Per-file subpaths, `@thinkrail/chat-ui/<path>` (e.g. `/turns`, `/rows`, `/hydrate`, `/Composer`,
`/toolRegistry`, `/tools/register`), plus three barrels: `/lib`, `/prompt`, `/resources`. No root barrel —
`Markdown` pulls `react-markdown`, and a lazy chat chunk must not drag it into the shell (the code-splitting
exception of [[architecture]]). Importing `/tools/register` registers the built-in tool cards (a side
effect each host runs once).

Host seams, each a context or a prop the host fills:

- `highlight` — `CodeHighlighterProvider` + `CodeHighlighter` (`cached(code, lang)` /
  `highlight(code, lang, key)`); the package owns `useHighlightedCode` (cache read, streaming tail shown plain
  until the newer highlight lands). Without a provider code renders unhighlighted. The web app provides its
  shiki worker client (`apps/web/src/lib/highlightCode`); the worker and the theme mapping stay in the app.
- `ChatActions` / `InteractionStatesContext` / `PendingExtUiContext` — the calls a host makes on the user's
  behalf (respond to a tool, open a file, reply to an extension dialog) and the derived states they need.
- `modelPreferences` — the `ModelPreferences` shape the composer's picker reads; the host builds it.
- `chatMessageOrder` — the `ChatMessageOrder` vocabulary rows are derived under; persistence is the host's.
- `lib` — the pure helpers the renderers share with the host: workspace paths (`projectRelativePath`,
  `isAbsolutePath`, `normalizePath`, `fileName`), `userText`, `firstNonBlankLine`, `copyText`,
  `parseSkillInvocation`, and the MCP status vocabulary. `apps/web`'s `lib` barrel re-exports it, so app
  code keeps one `@/lib` import.

## Boundary

- **Allowed deps:** `contracts`, `locales`, `ui`, `extension-api/web` (the renderer contract),
  `@thinkrail/ext-visualize/web` (`Markdown` renders mermaid through `MermaidView`; mermaid stays lazy inside
  the extension), React, `react-markdown`, `remark-gfm`, `marked` (block splitting only), Remix Icon.
- **Forbidden:** any app (`apps/*`), a store or transport, `localStorage`/routing/window globals beyond the
  clipboard write in `copyText`, shiki or any highlighter engine, and value-importing `pi`.
- **Stays in the host:** the transcript subscription and reconciliation (`apps/web/src/chat/ChatView.tsx`,
  `ChatTranscript.tsx` and their hooks), the live pi-event reducer (`apps/web` `store`), virtualization and
  scroll control, preferences persistence, and extension registration of non-built-in tool renderers.

## Hosts

A host stylesheet imports `@thinkrail/design-tokens/styles.css` and `@thinkrail/ui/custom-icon.css`, lists
`packages/chat-ui/src` as a Tailwind `@source`, and defines the one layout role the renderers name,
`--spacing-chat-gutter` (the transcript's side gutter: 8px in the IDE, 16px on a phone).


- **`apps/web`** renders the full chat: `ChatView` / `ChatTranscript` integrate the store and transport and
  render these components unchanged; `main.tsx` provides the highlighter.
- **`apps/mobile`** renders one session from the same pieces: `session.getMessages` → `messagesToRuntime` →
  `deriveRows` → `ChatTurnView`, with the shared `Composer` and its own wire calls (see its spec).
