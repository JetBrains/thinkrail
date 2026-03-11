# Task: Effort Support

> Status: **Done** | Created: 2026-03-11

## Summary

Add configurable reasoning effort level (null/low/medium/high/max) to agent sessions. Effort dropdown in SessionStatusLine, backed by AgentConfig.effort field and agent/updateConfig RPC.

## Covers

- `backend/app/agent/models.py` (AgentConfig.effort field)
- `frontend/src/components/ChatStream/SessionStatusLine.tsx` (effort dropdown)
- `backend/app/agent/service.py` (update_config effort parameter)

## Acceptance Criteria

- [x] AgentConfig has `effort: str | None = None` field
- [x] SessionStatusLine renders effort dropdown with EFFORT_OPTIONS
- [x] null effort displays as "auto"
- [x] Effort changes sent via agent/updateConfig RPC
- [x] Effort persisted to session config on disk
- [x] Dropdown disabled when session is running or ended

## Design Reference

- Feature design: [features/EFFORT_SUPPORT_DESIGN.md](../../features/EFFORT_SUPPORT_DESIGN.md)
