# Skill Session Start Button — Frontend Spec

> Parent: [SKILL_SESSION_START_DESIGN.md](../../features/SKILL_SESSION_START_DESIGN.md) | Status: **Active** | Created: 2026-03-11

## Overview

A one-click "Start" button for skill-loaded sessions. When a session has a skill attached (`skillId != null`) but no events yet (`events.length === 0`), the InputArea renders a "Start: {skill name}" button instead of the "Continue" button. Clicking it sends `"start"` via the existing `sendMessage` pipeline.

---

## Component Changes

### SessionPanel (`SessionPanel.tsx`)

#### New Derived Flag

```ts
const showStartSession = !inputDisabled && !isRunning
  && (activeSession?.events.length ?? 0) === 0
  && activeSession?.skillId != null;
```

**Mutual exclusivity with `showContinue`:**
- `showContinue` requires `events.length > 0`
- `showStartSession` requires `events.length === 0`
- Both require `!inputDisabled && !isRunning`
- Therefore they can never both be true simultaneously.

#### New Callback

```ts
const handleStartSession = useCallback(() => {
  if (!activeSessionId || !activeSession) return;
  if (activeSession.status === "idle") {
    sendMessage(activeSessionId, "start");
  }
}, [activeSessionId, activeSession, sendMessage]);
```

Only fires when status is `"idle"` — guards against edge cases where the button might be visible during a status transition.

#### Props Passed to InputArea

| Prop | Type | Value |
|------|------|-------|
| `showStartSession` | `boolean` | Derived flag |
| `onStartSession` | `() => void` | `handleStartSession` |
| `skillId` | `string \| null` | `activeSession.skillId` |

### InputArea (`InputArea.tsx`)

#### Extended Props

```ts
interface InputAreaProps {
  // ... existing props ...
  showStartSession?: boolean;
  onStartSession?: () => void;
  skillId?: string | null;
}
```

All three are optional to maintain backward compatibility (InputArea may be used in other contexts).

#### Button Rendering

Rendered in the `.input-actions` div, after the Continue button block:

```tsx
{showStartSession && onStartSession && (
  <button className="input-continue" onClick={onStartSession} title="Start the skill session">
    {skillId ? `Start: ${SKILLS.find(s => s.id === skillId)?.name ?? "Session"}` : "Start"}
  </button>
)}
```

**Label resolution:**
1. If `skillId` matches a known skill in `SKILLS` → `"Start: {skill.name}"` (e.g., "Start: Module Design")
2. If `skillId` is set but not found in `SKILLS` → `"Start: Session"`
3. If `skillId` is null/undefined → `"Start"` (fallback, shouldn't happen given `showStartSession` guard)

**Styling:** Reuses `.input-continue` CSS class — same visual treatment as the Continue button.

**Import:** `SKILLS` is already imported in `InputArea.tsx` (used for autocomplete suggestions).

---

## State Machine

```
Session created with skill
  │
  ├─ events=[], status=idle, skillId=X
  │    → showStartSession=true, showContinue=false
  │    → Button: "Start: {skill name}"
  │
  ├─ User clicks "Start"
  │    → sendMessage(sid, "start")
  │    → status transitions to "running"
  │    → showStartSession=false (isRunning=true)
  │    → Button: interrupt (■)
  │
  ├─ Agent completes first turn
  │    → events.length > 0, status=idle
  │    → showStartSession=false (events > 0)
  │    → showContinue=true
  │    → Button: "Continue"
  │
  └─ Session without skill (skillId=null)
       → showStartSession=false regardless of events
       → Normal send-only behavior
```

---

## Interactions

| User Action | Result |
|-------------|--------|
| Click "Start: {name}" | Sends `"start"` message, agent begins executing skill |
| Type message + Send | Normal message send (works alongside start button) |
| Create session without skill | No start button shown, only Send |

---

## What Does NOT Change

- **No backend changes** — `"start"` is a regular message; skill already in system prompt
- **No store changes** — existing `sendMessage` handles everything
- **No CSS changes** — reuses `.input-continue` styling
- **No type changes** — `Session.skillId` already exists (`string | null`)
- **No new imports** — `SKILLS` already imported in `InputArea.tsx`
