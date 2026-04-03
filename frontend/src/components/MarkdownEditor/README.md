# MarkdownEditor — Component Specification

> Parent: [Frontend Module](../../README.md) | Status: **Active** | Created: 2026-04-03

## Purpose

Reusable editor component wrapping Monaco Editor with an optional rendered markdown preview. Provides consistent editing UX for markdown content across the app. Syncs Monaco theme with the active Bonsai UI theme.

## Public Interface

```typescript
interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;         // default: "markdown"
  height?: string | number;  // default: "100%"
  preview?: boolean;         // show Edit/Preview tabs (default: true)
  initialMode?: "edit" | "preview";  // default: "edit"
  minimap?: boolean;         // default: false
  lineNumbers?: "on" | "off";       // default: "on"
}
```

## Modes

- **Edit**: Monaco editor with syntax highlighting, bracket matching, word wrap, smooth scrolling
- **Preview**: Rendered markdown via `react-markdown` + `remark-gfm` (GFM tables, task lists, strikethrough)

Toggle controlled by Edit/Preview tab buttons (hidden when `preview={false}`).

## Theme Sync

**Hook:** `useMonacoTheme()` — observes `data-theme` attribute on `<html>` via `MutationObserver`. Maps 8 Bonsai themes to Monaco theme definitions. Registers and applies themes globally — all Monaco instances sync simultaneously (FileViewer, DiffCard, MarkdownEditor).

**Theme definitions:** `monacoThemes.ts` — dark token rules (IntelliJ-style) + light token rules. Editor colors (background, foreground, selection, gutter, scrollbar, etc.) derived from CSS variables in `styles/themes.css` and `styles/theme-dark.css` / `styles/theme-light.css`.

## File Organization

| File | Responsibility |
|------|---------------|
| `MarkdownEditor.tsx` | Main component: mode toggle, Monaco + ReactMarkdown rendering |
| `MarkdownEditor.css` | Tab styles, preview pane styles (headings, code, lists, tables, blockquotes) |
| `useMonacoTheme.ts` | Theme sync hook: MutationObserver + media query listener |
| `monacoThemes.ts` | 8 Monaco theme definitions (dark, light, high-contrast, dracula, nord, solarized-dark, solarized-light, claude-code) |

## Consumers

| Component | Usage | Key Props |
|-----------|-------|-----------|
| `MetaTicketDetail/TicketDescriptionView` | Ticket body editing | `preview, initialMode="preview"` |
| `MetaTicketDetail/TicketPlanView` (Raw tab) | Plan markdown editing | `preview` |
| `MetaTicketDetail/TicketPlanView` (Steps tab) | Agent instructions | `height=80, preview=false, minimap=false, lineNumbers="off"` |

The `useMonacoTheme()` hook is also used directly by:
- `FileViewer/FileViewer.tsx` — code file viewing/editing
- `ChatStream/DiffCard.tsx` — diff visualization
- `MetaTicketDetail/TicketDraftsView.tsx` — spec draft diff viewer

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Global theme sync via MutationObserver | Single source of truth (`data-theme` attribute). No prop-drilling. All instances sync automatically. |
| `react-markdown` for preview | Already installed. GFM support via `remark-gfm`. Consistent with rest of app. |
| `height="100%"` requires flex parent chain | Monaco needs computed pixel heights. Parent containers must have `flex: 1; min-height: 0`. Documented in MarkdownEditor.css. |
| `initialMode` prop (not controlled mode) | Component manages its own mode state. Avoids coupling parent to edit/preview toggle. |
