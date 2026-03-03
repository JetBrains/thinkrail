# Set Up Frontend Project

> Vite + React + TypeScript project scaffold, theming, and shared types

**Status:** Done
**Priority:** Critical
**Spec reference:** `frontend/README.md`, `frontend/ui-specs/APP_SHELL.md` (Tech Stack), `frontend/ui-specs/THEMING.md`

## Summary

Create the frontend project skeleton: Vite configuration, package.json with all dependencies, TypeScript config, entry HTML, base styles with CSS custom property theming (dark/light mode), and shared type definitions that all components will use.

## Files to Create

### Build & Config
- `frontend/package.json` — dependencies: react 19, react-dom, react-router-dom 7, zustand, @xterm/xterm; devDeps: vite 6, typescript, vitest, @testing-library/react, eslint
- `frontend/tsconfig.json` — strict mode, path aliases (`@/` → `src/`)
- `frontend/vite.config.ts` — dev server port 3000, proxy `/ws` to backend (localhost:8000)
- `frontend/index.html` — Vite entry HTML

### Theming (CSS Custom Properties)
- `frontend/src/styles/tokens.css` — semantic CSS variable definitions (bg, panel, elevated, text, border, accent colors)
- `frontend/src/styles/theme-dark.css` — dark theme values (Tokyo Night-inspired: bg `#0a0e1a`, text `#c0caf5`)
- `frontend/src/styles/theme-light.css` — light theme values (bg `#f5f5f5`, text `#1a1b26`)
- `frontend/src/styles/global.css` — imports tokens + themes, base reset, font stack, scrollbar styles
- `frontend/src/utils/theme.ts` — theme detection (`prefers-color-scheme`), user preference (`localStorage`), apply function

### Shared Types
- `frontend/src/types/spec.ts` — RegistryEntry, Link, SpecSummary, SpecDetail, SpecGraph
- `frontend/src/types/agent.ts` — AgentTask, AgentConfig, AgentEvent, AgentResult, Question, QuestionOption
- `frontend/src/types/session.ts` — Session, ArchivedSession, SessionStatus
- `frontend/src/types/rpc.ts` — JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, RpcError
- `frontend/src/types/index.ts` — re-exports

### Entry Points
- `frontend/src/main.tsx` — React 19 createRoot, mount `<App />`
- `frontend/src/App.tsx` — placeholder root component (will be expanded in App Shell task)

## Definition of Done

- [ ] `npm install` succeeds
- [ ] `npm run dev` starts Vite dev server on port 3000
- [ ] `npm run build` produces `dist/` output
- [ ] Dark theme renders by default; light theme activates via `prefers-color-scheme: light`
- [ ] All TypeScript types compile without errors
- [ ] Theme toggle works via `localStorage` override
