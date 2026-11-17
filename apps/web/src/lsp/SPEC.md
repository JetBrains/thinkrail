---
id: submodule-web-lsp
type: submodule-design
status: active
title: lsp — language-server visibility
parent: module-web
depends-on: [module-contracts, module-locales, module-ui]
references: [module-ext-lsp-search, module-desktop, submodule-web-panels, submodule-web-chat-resources]
tags: [ui, lsp]
---

## Responsibility

Shows which language servers the desktop shell detected for the active workspace and how ready they are:
the **Languages & LSP** group in Settings → Extensions and the **Language servers** section of the workspace
status drawer (the resources inspector), beside MCP servers and subagents. Detection and the servers
themselves live in the shell (`apps/desktop/src-tauri/src/lsp`); this module only reads them through the
optional `__THINKRAIL_NATIVE_LSP__` bridge (`NativeLspBridge`, [[module-contracts]]).

## Boundary

- **Public surface (`index.ts`):** `LspSettings`, `LspResourcesSection`, `useWorkspaceLsps`,
  `getNativeLspBridge`, `WorkspaceLsps`.
- **Allowed deps:** `contracts`, `locales`, `ui`, React. Never `server` or `shared`, and never the store:
  callers pass the worktree path in.
- **No bridge, no UI beyond a note.** `getNativeLspBridge()` shape-guards the global like the other native
  bridges; in a browser or a shell without it the hook reports `unsupported`, Settings says so in one line
  and the drawer renders nothing.
- **Detection never spawns.** The hook calls `detect` on mount and every 10 s, so a server an agent query
  started turns from `detected` to `starting` to `ready`. `restart` stops a server; the next query starts it.
- **Presentation.** Each server is a row: language, status badge, resolved binary path, and — only while the
  binary is missing — an install hint naming the marker file that selected the language (`Cargo.toml`,
  `pyproject.toml`, …). `ready` is the theme accent dot (Helios Cobalt's `#00D4FF`); it gains the neon halo
  only under `data-helios-neon` (`[data-lsp-ready]` in `styles/neon.css`), and only `starting` animates, never
  under `prefers-reduced-motion`. **Edit lsp.json** asks the shell to create and open `~/.thinkrail/lsp.json`;
  a project's `.thinkrail/lsp.json` is edited as an ordinary file.
- All text is `settings.lsp.*` / `resources.lsp.*` locale keys.
