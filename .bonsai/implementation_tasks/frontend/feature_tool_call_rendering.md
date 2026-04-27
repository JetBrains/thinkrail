---
id: task-tool-call-rendering
type: task-spec
status: done
title: Enhanced Tool Call Rendering
parent: frontend-module
implements:
- chat-ui
tags:
- frontend
- ui
- tool-rendering
---
# Feature: Enhanced Tool Call Rendering

> Status: **Planned** | Created: 2026-04-07 | Design: [tool-call-rendering-design.md](../../docs/superpowers/specs/2026-04-07-tool-call-rendering-design.md)

## What

Enhance the generic `ToolCallCard` component so all tool calls (Read, Bash, Grep, Glob, Agent, WebSearch, WebFetch, MCP tools) display with smart headers when collapsed and structured input/output when expanded — instead of raw JSON/text.

## Why

Session transcripts with many tool calls are hard to scan. The current generic renderer dumps raw text, making it difficult to quickly understand what each tool did. Users need at-a-glance summaries (collapsed) and well-formatted detail (expanded).

## How

### New Files
1. **`toolHeaderExtractors.ts`** — Per-tool header extraction registry producing `{ summary, badge? }` from raw input + output
2. **`ToolInputDetail.tsx`** — Key-value rendering for structured tool input (colored keys, typed values)
3. **`ToolOutputBody.tsx`** — Content-aware output (JSON detection + colored syntax, error styling, truncation at 30 lines)

### Modified Files
4. **`ToolCallCard.tsx`** — Accept `rawInput` object, use extractor registry for header, render sub-components in body
5. **`ChatStream.tsx`** — Pass raw `toolInput` object instead of `extractToolInput()` result
6. **`SubagentBlock.tsx`** — Same: pass raw `toolInput` object
7. **`ChatStream.css`** — New CSS classes for structured input/output styling
8. **`frontend/ui-specs/CHAT_UI.md`** — Update ToolCallCard spec section

### Tool Header Extractors
| Tool | Summary | Badge |
|------|---------|-------|
| Bash | `command` | output line count |
| Read | `file_path` + line range | output line count |
| Grep | `/pattern/` in `path` | match count |
| Glob | `pattern` in `path` | file count |
| Agent | `subagent_type — description` | — |
| WebSearch | `query` | — |
| WebFetch | `url` | — |
| Fallback | first string field | — |

## Success Criteria
- [ ] Collapsed tool calls show meaningful one-line summaries per tool type
- [ ] Badge metadata (line counts, match counts) shows when output is available
- [ ] Expanded view shows structured key-value input with colored types
- [ ] JSON output is pretty-printed with colored syntax (no external library)
- [ ] Error output has distinct red-tinted styling
- [ ] Long output (>30 lines) truncated with expandable "Show all N lines"
- [ ] SubagentBlock tool calls also use enhanced rendering
- [ ] Existing specialized renderers (DiffCard, TaskCard, VisualizationCard) unaffected
- [ ] MCP tool outputs unwrapped from content blocks (backend `_serialize_tool_content`)
- [ ] MCP tool names displayed without `mcp__servername__` prefix
- [ ] `tsc --noEmit` passes
- [ ] `vitest run` passes
- [ ] `uv run pytest` passes

## Dependencies
- Backend change in `runner.py` for MCP output unwrapping
