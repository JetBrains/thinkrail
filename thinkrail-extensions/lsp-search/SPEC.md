---
id: module-ext-lsp-search
type: module-design
status: active
title: LSP code-navigation extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api, module-contracts]
references: [submodule-server-extensions, module-desktop, submodule-web-lsp]
---

## Responsibility

Gives the agent four read-only semantic navigation tools — `code_symbol_search`, `code_find_references`,
`code_goto_definition`, `code_file_outline` — answered by the language servers the desktop shell's LSP
manager detects and runs per git worktree (`apps/desktop/src-tauri/src/lsp`, [[module-desktop]]). Each tool
description tells the model to prefer it over broad text search or reading whole files. Being a registry
extension is what lets Settings → Extensions switch it off as a unit, for parents and subagent children.

## Boundary

One entrypoint, `@thinkrail/ext-lsp-search/server`, default-exporting
`defineServerExtension({ name: "lsp-search", title, description, extensions, childExtensions })`. There is no
`./web`: results are plain text (`path:line`) in the default tool card. It may import `extension-api/server`,
pi types and nothing else (the boundary check allows no `contracts` edge from an extension's server half), so
`server/wire.ts` mirrors the `lsp` wire shapes of [[module-contracts]] — change both together.

- **Transport.** The shell binds a loopback HTTP bridge and passes `THINKRAIL_LSP_BRIDGE_URL` and
  `THINKRAIL_LSP_BRIDGE_TOKEN` to the host sidecar. A tool `POST`s `/lsp/<operation>` with
  `Authorization: Bearer <token>` and the session's `cwd` as `worktreePath`; the reply is
  `{ ok, result | error }` ([[module-contracts]] `LspBridgeReply`). The token is the only credential; the
  listener accepts nothing else. Tool parameters are snake_case and are mapped to the bridge's camelCase.
- **Without a bridge** (CLI, browser host, Electrobun) the tools stay registered — the catalog and Settings
  still list them — and fail with a message telling the model to use grep/read. Detection never spawns a
  server; the first query for a language does.
- **No approval prompt.** Native pi tools run without confirmation; only MCP tools are gated, by
  `readOnlyHint`. These tools never write, so no gate is added or needed.
- **Results** are 1-indexed, workspace-relative, with 2–3 line previews; the manager does that conversion
  once, so the model never meets a 0-indexed position. A result names whether a server or the text
  fallback produced it.

## Tests

`server/index.test.ts` serves a fake bridge over HTTP and checks registration, the bearer token, cwd and
parameter mapping, error propagation, the no-bridge message and every formatter. The Rust side
(`cargo test` in `apps/desktop/src-tauri`) covers detection, framing, normalization and the fallback.
