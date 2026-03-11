# Task: Resizable Session Boxes

> Status: **Done** | Created: 2026-03-11

## Summary

Add CSS `resize: vertical` to key ChatStream containers, allowing users to manually resize tool output, subagent blocks, approval details, and visualization cards.

## Covers

- `frontend/src/components/ChatStream/ChatStream.css`

## Acceptance Criteria

- [x] `.chat-tool-body` has `resize: vertical; min-height: 40px`
- [x] `.chat-subagent-body` has `resize: vertical; min-height: 60px`
- [x] `.chat-approval-expanded` has `resize: vertical; min-height: 40px`
- [x] `.viz-card-body` has `resize: vertical; min-height: 60px`
- [x] DiffCard uses ResizeObserver to sync Monaco editor height with container

## Design Reference

- Chat UI spec: [frontend/ui-specs/CHAT_UI.md](../../frontend/ui-specs/CHAT_UI.md)
