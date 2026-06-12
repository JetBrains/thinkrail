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
  → RPC: agent/updateConfig { thinkrailSid, effort }
  → service.update_config() → task.config.effort = value → persist to disk
  → Response: { model, permissionMode, betas, effort }
```

The effort value is stored in `AgentConfig` and persisted with the session. When a session is resumed, the effort level is restored from the saved config.

## Effort Values

The effort levels are not hardcoded — pickers read them from the runtime's capabilities (`runtimes/capabilities` → `effortLevels`, a `LabeledOption[]`) via `runtimeCapsStore`. The Claude runtime derives them from the SDK's `EffortLevel` literal, so the offered set follows whatever the installed SDK accepts; this doc deliberately doesn't enumerate them.

ThinkRail prepends one value the SDK has no token for: `"auto"` (position 0, the default). It represents "no explicit effort" — the runtime translates it to SDK `effort=None` at the call boundary, and every other value passes through verbatim.

## Session Restart Behavior

Effort changes do **not** require a session restart. The value is updated in the live config and takes effect on the next turn. The SDK does not have a dedicated `setEffort()` method — effort is passed through the config and applied when the runner builds the next query context.

## Changes by Layer

### Backend

| File | Change |
|------|--------|
| `agent/models.py` | `AgentConfig.effort: str = "auto"` — defaults to `"auto"`; a `field_validator(mode="before")` coerces a legacy persisted `null` to `"auto"`. `SessionDefaults.effort` follows the same shape (`COLD_START_EFFORT = "auto"`). |
| `agent/service.py` | `update_config()` — accepts `effort` param, validates it against the runtime's `capabilities()`, updates `task.config.effort`, persists to disk |
| `runtime/claude/runtime.py` | Reads `task.config.effort` and passes it to SDK query options, translating `"auto"` → SDK `effort=None` at the boundary |
| `rpc/methods/agents.py` | `agent/updateConfig` — passes `effort` param through to service |

### Frontend

| File | Change |
|------|--------|
| `components/ChatStream/SessionStatusLine.tsx` | Effort dropdown: reads `effortLevels` from `runtimeCapsStore` (the `"claude"` caps), `useDropdown()` for open/close, `onChangeEffort` callback. An out-of-caps active value renders as a raw option. |

### Wire Format

`agent/updateConfig` request:
```json
{ "thinkrailSid": "...", "effort": "high" }
```

Response:
```json
{ "model": "claude-sonnet-4-6", "permissionMode": "default", "betas": [], "effort": "high" }
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `"auto"` = SDK default | Default effort is the string `"auto"`; the runtime translates it to SDK `effort=None` | Lets the model decide; no forced default that might degrade quality. Always a string on the wire — no `null` to special-case. A before-validator coerces legacy persisted `null` to `"auto"`. |
| No session restart | Effort updated in-place, takes effect next turn | Unlike model changes, effort doesn't require a new SDK session |
| String enum, not integer | Values are "low"/"medium"/"high"/"max" | Matches SDK API; human-readable; no ambiguous numeric mapping |
| Dropdown in StatusLine | Same pattern as model and permission mode selectors | Consistent UX; reuses `useDropdown()` hook |
| Disabled when running | Effort dropdown disabled during active turns | Prevents confusion about when the change takes effect |
