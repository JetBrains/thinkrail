# Task: Context Panel Shared Infrastructure

> Implements: [SPEC_CONTEXT.md](../../frontend/ui-specs/context-panel/SPEC_CONTEXT.md), [AGENT_CONTEXT.md](../../frontend/ui-specs/context-panel/AGENT_CONTEXT.md)
> Status: **active** | Priority: **high** | Created: 2026-03-06

## Goal

Create shared hooks and utility functions used by all ContextPanel section implementations.

## Deliverables

### 1. `useSelectedSpec` hook

**File:** `frontend/src/components/ContextPanel/useSelectedSpec.ts`

- Returns `RegistryEntry | null`
- Resolves from `previewFilePath ?? activeFilePath` (via path matching against `specStore.specs`) or `selectedSpecId`
- Uses `isSpecFile()` from `useContextMode.ts` for spec detection

### 2. `useActiveSession` hook

**File:** `frontend/src/components/ContextPanel/useActiveSession.ts`

- Returns `Session | null`
- Reads `sessionStore.activeSessionId` and looks up in `sessionStore.sessions`

### 3. Shared utilities

**File:** `frontend/src/components/ContextPanel/utils.ts`

| Export | Signature | Purpose |
|---|---|---|
| `relativeDate` | `(iso: string) => string` | ISO date string to "2 days ago" / "today" / "3 weeks ago" |
| `StatusBadge` | `({ status: string }) => JSX` | Colored pill: active=green, draft=gray, stale=orange |
| `fileName` | `(path: string) => string` | Extract filename from path |
| `dirName` | `(path: string) => string` | Extract directory from path |
| `fileMatchesCovers` | `(filePath: string, covers: string[]) => boolean` | Check if file matches any covers pattern (prefix match) |

### 4. CSS for StatusBadge

**File:** `frontend/src/components/ContextPanel/utils.css` (or inline in utils.tsx)

- `.status-badge` — inline pill (10px, uppercase, border-radius, padding 1px 6px)
- Color variants via `data-status` attribute: active, draft, stale

## Acceptance Criteria

- [ ] `useSelectedSpec()` correctly resolves in both spec-file and selectedSpecId cases
- [ ] `useActiveSession()` returns the active session or null
- [ ] `relativeDate()` handles edge cases (today, yesterday, weeks, months)
- [ ] `StatusBadge` renders colored pill for active/draft/stale
- [ ] `fileMatchesCovers()` handles directory prefixes and exact file matches
- [ ] All exports are importable from `./utils` and hooks from their files

## Dependencies

- `specStore` (specs, selectedSpecId)
- `sessionStore` (sessions, activeSessionId)
- `fileStore` (activeFilePath, previewFilePath)
