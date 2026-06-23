---
id: module-web
type: module-design
status: active
title: Web UI client
parent: architecture
depends-on: [module-contracts]
tags: [v1, ui]
---

## Responsibility

The mobile-first React UI. Ships as static assets and dials an engine host over the wire. Renders `pi`'s
event stream as a chat-centric, multi-session IDE shell.

## Boundary

- **Owns:** the browser UI — transport client, store, panels, the responsive shell, branding tokens.
- **Public surface:** the built static bundle (`dist/`) — a deployable artifact that dials a host.
- **Allowed deps:** `@thinkrail-pi/contracts` (types + WS constants) ONLY; React / Zustand / Vite / etc.
- **Forbidden:** importing `server` / `shared` / any `pi` package (value or type) — enforced by the M1
  bundle gate (`bun build` shows no provider SDK / `node:fs`).

## Internal structure

- **transport/** — single WebSocket client; id-correlated `request`, channel `subscribe` with replay,
  reconnect/backoff. The host endpoint is a parameter (default same-origin via `inferUrl`).
- **store/** — Zustand; connection + welcome, projects/workspaces, and **center tabs keyed by workspace**
  (switching workspaces swaps the visible tab set). Per-session pi runtime (messages, streaming, stats)
  joins at M10–M11.
- **panels/** — layout-agnostic, store-driven: `ProjectTree` (project→workspace nav), `FileTree` (All
  files), `Editor` (Monaco, center tabs), `ChangesPanel` + `DiffViewer`, `TerminalView`, `ChatView`,
  `Composer`. A panel fills its container and never knows its arrangement.
- **shell/** — the 3-column frame: left project→workspace nav, center tabbed area (file tabs +
  chat tabs), right All-files/Changes panel with terminals below. Desktop multi-pane / mobile
  single-view-with-switcher, breakpoint-driven.

Built so far: `transport` / `store` / `wireTransport` / branded `shell` (M3); `ProjectTree` (M4–M5);
`FileTree` + `RightPanel` (All files, M6); `CenterTabs` + lazy `MonacoEditor` (file tabs, M7);
`ChangesPanel` + lazy `DiffViewer` (Changes tab, shiki diff vs base, M8). TerminalView / ChatView /
Composer land M9–M13. UI primitives live in `components/ui/` (shadcn), `cn()` in `lib/utils.ts`.

## Styling & theming

- **Tailwind v4 utilities, mapped to the design tokens** (`src/index.css` `@theme inline`). Components
  use utilities (`bg-bg-dark`, `text-primary`, `border-border`, `px-lg`, `text-lg`) — **never inline
  `style` objects, never raw hex.** Responsive (`md:` …) and states (`hover:` / `focus-visible:`) come
  from Tailwind (inline styles can't express them, and the responsive shell needs them).
- **`src/styles/tokens.css` is the theme contract.** A *theme* is one set of CSS custom properties; a
  theme swap = changing the token block via `[data-theme="…"]` on `<html>` (`applyTheme(id)`) — nothing
  in components changes. `@theme inline` keeps utilities pointing at the live `var(--token)`, so the swap
  re-themes everything. V1 ships one dark theme, structured for N (pibun's theme engine, lifted at V2).
- Token names that collide with Tailwind namespaces (`--font-mono`, `--font-accent`, `--radius-*`) are
  used as token arbitrary values (`font-[var(--font-accent)]`), not `@theme` mappings.
- **Icons: `lucide-react`. Components: shadcn/ui** (Radix primitives), copy-in under `src/components/ui/`
  and themed with our token utilities (`cn()` in `src/lib/utils.ts`) — never shadcn's default oklch
  palette. Use these for accessible menus / dialogs / tooltips.

## Get right

- **`apps/web` depends on `packages/contracts` only.** Never value-import `pi`; never import `server`/`shared`.
- Streaming invariant: `text_delta` / `thinking_delta` **APPEND**; `tool_execution_update.partialResult`
  **REPLACE**.
- Panels stay arrangement-agnostic so the mobile shell is an additive layer, not a rewrite.

## Later

The mobile single-view shell and PWA packaging (installable, offline shell) ride on this split without
touching panels or store.
