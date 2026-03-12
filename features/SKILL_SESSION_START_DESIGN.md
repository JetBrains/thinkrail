# Skill Session Start — Architecture Design

> Parent: [DESIGN_DOC.md](../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-11

## Table of Contents
1. [Overview](#overview)
2. [Current State](#current-state)
3. [High-Level Design](#high-level-design)
4. [Changes by Layer](#changes-by-layer)
5. [Key Design Decisions](#key-design-decisions)
6. [Frontend Spec](#frontend-spec)

## Overview

When a session is created with a skill selected, the skill's `SKILL.md` is loaded into the system prompt at creation time, but the session sits idle with 0 events. The existing "Continue" button only appears when `events.length > 0`, leaving the user with no one-click way to launch the skill.

This feature adds a **"Start: {skill name}"** button that appears in the InputArea when a session has a skill but no events yet. Clicking it sends a simple `"start"` message to trigger the agent, which already has the skill instructions in its system prompt.

## Current State

```
Session created with skill selected
  │
  ├── Backend: skill's SKILL.md loaded into system prompt ✓
  ├── Frontend: session.skillId set ✓
  ├── Frontend: session.events = [] (empty)
  │
  └── Problem: "Continue" button requires events.length > 0
      → User must manually type a message to start the skill
```

## High-Level Design

```
Session (skillId != null, events.length === 0, status === "idle")
  │
  ├── SessionPanel derives: showStartSession = true
  │     (mutually exclusive with showContinue by construction)
  │
  ├── InputArea renders: "Start: {skill name}" button
  │     (reuses .input-continue CSS class)
  │
  └── On click: sendMessage(sessionId, "start")
        → Standard message pipeline
        → Agent receives "start" with skill in system prompt
        → Skill execution begins
```

**Key principle:** No new backend infrastructure or state management. The skill is already in the system prompt; we just need a UI affordance to send the trigger message.

## Changes by Layer

### Backend

**No changes.** The skill's `SKILL.md` is already loaded into the system prompt at session creation time. The `"start"` message is processed as a regular user message through the existing `sendMessage` RPC method.

### Frontend

| File | Change |
|------|--------|
| `SessionPanel.tsx` | Add `showStartSession` derived flag and `handleStartSession` callback |
| `InputArea.tsx` | Add `showStartSession`, `onStartSession`, `skillId` props; render start button |

No changes to: `sessionStore.ts`, `wireEvents.ts`, `types/session.ts`, CSS files.

### State Derivation

Two mutually exclusive flags control button visibility:

| Flag | Condition | Button |
|------|-----------|--------|
| `showContinue` | `!inputDisabled && !isRunning && events.length > 0` | "Continue" |
| `showStartSession` | `!inputDisabled && !isRunning && events.length === 0 && skillId != null` | "Start: {name}" |

These are mutually exclusive by construction: `events.length > 0` vs `events.length === 0`.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger message content | `"start"` (plain text) | Simple, unambiguous. Agent already has skill context in system prompt. |
| Button placement | Same spot as "Continue" button | Consistent UX — same action area for session-advancing actions. |
| Button label | `Start: {skill name}` | Shows which skill will run. Falls back to "Start" if skill not found. |
| CSS reuse | `.input-continue` class | Same visual treatment as Continue — no new styles needed. |
| No new state | Derived from existing `events.length` + `skillId` | Avoids state synchronization bugs. Single source of truth. |
| No backend changes | Skill already in system prompt | The whole point of loading SKILL.md at session creation is deferred execution. |

## Frontend Spec

Detailed frontend implementation spec: [frontend/ui-specs/SKILL_SESSION_START.md](../frontend/ui-specs/SKILL_SESSION_START.md)
