# Feature: Compact Event View Mode

> Status: **Planned** | Created: 2026-04-08 | Design: [compact-event-view-design.md](../../docs/superpowers/specs/2026-04-08-compact-event-view-design.md)

## What

Add a configurable "compact" view mode for session event streams that renders resolved events as dense log-lines, inlines approval badges into tool cards, and shows user messages as right-aligned single-line entries. Controlled via `event_view` in `.bonsai/settings.json`.

## Why

Session transcripts are vertically spread — folded events waste space, and approval cards break flow by appearing as separate entries. Users need a denser view to scan history without excessive scrolling. The architecture must support future view modes.

## How

### Architecture: Renderer Registry Pattern

1. **ViewModeContext** (`frontend/src/context/ViewModeContext.tsx`) — React context providing current mode
2. **Renderer registry** (`frontend/src/components/ChatStream/renderers/`) — maps `(viewMode, eventType) → component`, with classic fallback
3. **Pre-scan extension** — new `approvalByToolIndex` map linking confirmAction → toolCallStart by sequence+toolName

### New Files
1. **`context/ViewModeContext.tsx`** — `ViewMode` type, context, `useViewMode()` hook
2. **`ChatStream/renderers/types.ts`** — `EventRenderContext`, `EventRenderer`, `ViewRenderers`
3. **`ChatStream/renderers/classicRenderer.tsx`** — extracted current switch logic
4. **`ChatStream/renderers/compactRenderer.tsx`** — compact renderer map
5. **`ChatStream/renderers/registry.ts`** — `viewRendererMap`, `renderEvent()` with fallback
6. **`ChatStream/CompactToolLine.tsx`** — log-line tool with approval badge slot
7. **`ChatStream/CompactUserMessage.tsx`** — right-aligned single-line expandable
8. **`ChatStream/compact.css`** — compact-specific styles

### Modified Files
9. **`ChatStream/ChatStream.tsx`** — pre-scan adds `approvalByToolIndex`; render loop uses registry
10. **`ChatStream/ChatStream.css`** — `.chat-stream--compact` container (gap: 1px)
11. **`ChatStream/SubagentBlock.tsx`** — use `useViewMode()` for density
12. **`ChatStream/QuestionCard.tsx`** — compact answered state (log-line + badge)
13. **`store/settingsStore.ts`** — type `event_view` from settings
14. **`backend/app/core/settings.py`** — add `event_view` field to `ProjectSettings`
15. **`frontend/ui-specs/CHAT_UI.md`** — document view mode system

### Compact Visual Rules
| Event | Compact Rendering |
|-------|-------------------|
| Tool call (done) | Log line: icon + name + detail + status (✓/✗) |
| Tool call (running) | Same log line with blue border, "running..." |
| Approval (answered) | Badge on parent tool's log line, no standalone card |
| Approval (pending) | Full card (same as classic) |
| Question (answered) | Log line with answer badge |
| Question (pending) | Full card (same as classic) |
| User message | Right-aligned, "You" label inline, single-line, expandable |
| Assistant text | Same as classic, slightly less padding |
| Subagent (collapsed) | Log line with toggle + type + tool count + status |
| Subagent (expanded) | Nested log lines at 10px font, indented |
| System/notification | Same as classic, tighter padding |
| Banners/vis/plan | Shared (same in both modes) |

### Session Context Menu
Right-click anywhere in the session view opens a context menu:
- **Switch to [mode] view** — toggles classic/compact, persists via settings API
- **Expand all / Collapse all** — broadcasts custom events to all expandable components
- **Copy transcript** — plain-text clipboard copy of session events
- **Revise answer** — context-sensitive on answered questions; sends a user message to re-ask

**New files:**
16. **`ChatStream/SessionContextMenu.tsx`** — context menu component
17. **`ChatStream/useExpandCollapse.ts`** — shared hook for expand/collapse events

**Additional modifications:**
18. **`ChatStream/ToolCallCard.tsx`** — add `useExpandCollapse()` hook
19. **`ChatStream/SubagentBlock.tsx`** — add `useExpandCollapse()` hook
20. **`store/settingsStore.ts`** — add `updateSettings()` method

## Success Criteria
- [x] `.bonsai/settings.json` `event_view: "compact"` switches to compact mode
- [x] Classic mode is unchanged (no regressions)
- [x] All resolved events render as log-style lines in compact
- [x] Approvals are inlined as badges on parent tool cards
- [x] Pending interactive cards (approval, question) pop out as cards
- [x] User messages are right-aligned, single-line, expandable
- [x] Subagent blocks are collapsible with nested compact tools
- [x] Adding a new view mode requires only a renderer map + components
- [x] Right-click context menu with view mode switch, expand/collapse, copy, revise
- [x] `tsc --noEmit` and `npm test` pass
