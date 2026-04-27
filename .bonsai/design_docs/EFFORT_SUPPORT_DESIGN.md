---
id: effort-support-design
type: submodule-design
status: active
title: Effort Support — Feature Design
parent: design-doc
depends-on:
- module-agent
covers:
- backend/app/agent/models.py
- backend/app/agent/service.py
- frontend/src/components/ChatStream/SessionStatusLine.tsx
tags:
- feature
- effort
- config
---
# Effort Support — Feature Design

> Parent: [DESIGN_DOC.md](../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-11

## Table of Contents
1. [Overview](#overview)
2. [Data Flow](#data-flow)
3. [Effort Values](#effort-values)
4. [Session Restart Behavior](#session-restart-behavior)
5. [Changes by Layer](#changes-by-layer)
6. [Key Design Decisions](#key-design-decisions)

## Overview

Effort support adds a configurable reasoning effort level to agent sessions. The effort parameter controls how much "thinking" the Claude model applies to each response — from quick, low-effort answers to deep, thorough analysis.

The effort dropdown lives in `SessionStatusLine` alongside the model and permission mode selectors, following the same dropdown pattern.

## Data Flow

```
User selects effort in dropdown
  → SessionStatusLine.onChangeEffort(value)
  → sessionStore.updateConfig({ effort: value })
  → RPC: agent/updateConfig { bonsaiSid, effort }
  → service.update_config() → task.config.effort = value → persist to disk
  → Response: { model, permissionMode, betas, effort }
```

The effort value is stored in `AgentConfig` and persisted with the session. When a session is resumed, the effort level is restored from the saved config.

## Effort Values

| Value | Display Label | Behavior |
|-------|---------------|----------|
| `null` | "auto" | SDK default — model decides appropriate effort |
| `"low"` | "low" | Quick responses, minimal reasoning |
| `"medium"` | "medium" | Balanced reasoning |
| `"high"` | "high" | Thorough reasoning |
| `"max"` | "max" | Maximum reasoning depth |

Defined as `EFFORT_OPTIONS` array in `SessionStatusLine.tsx`:

```typescript
const EFFORT_OPTIONS = [
  { value: null, label: "auto" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "max", label: "max" },
];
```

## Session Restart Behavior

Effort changes do **not** require a session restart. The value is updated in the live config and takes effect on the next turn. The SDK does not have a dedicated `setEffort()` method — effort is passed through the config and applied when the runner builds the next query context.

## Changes by Layer

### Backend

| File | Change |
|------|--------|
| `agent/models.py` | `AgentConfig.effort: str \| None = None` — new optional field with `null` default |
| `agent/service.py` | `update_config()` — accepts `effort` param, updates `task.config.effort`, persists to disk |
| `agent/runner.py` | Reads `task.config.effort` and passes it to SDK query options |
| `rpc/methods/agents.py` | `agent/updateConfig` — passes `effort` param through to service |

### Frontend

| File | Change |
|------|--------|
| `components/ChatStream/SessionStatusLine.tsx` | Effort dropdown: `EFFORT_OPTIONS`, `displayEffort()` helper, `useDropdown()` for open/close, `onChangeEffort` callback |

### Wire Format

`agent/updateConfig` request:
```json
{ "bonsaiSid": "...", "effort": "high" }
```

Response:
```json
{ "model": "claude-sonnet-4-6", "permissionMode": "default", "betas": [], "effort": "high" }
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `null` = auto | Default effort is `null`, displayed as "auto" | Lets the model decide; no forced default that might degrade quality |
| No session restart | Effort updated in-place, takes effect next turn | Unlike model changes, effort doesn't require a new SDK session |
| String enum, not integer | Values are "low"/"medium"/"high"/"max" | Matches SDK API; human-readable; no ambiguous numeric mapping |
| Dropdown in StatusLine | Same pattern as model and permission mode selectors | Consistent UX; reuses `useDropdown()` hook |
| Disabled when running | Effort dropdown disabled during active turns | Prevents confusion about when the change takes effect |
