---
id: task-suggest-session-ui
type: task-spec
status: done
title: 'Implement SuggestSession frontend: wiring, store, SuggestionCard'
depends-on:
- task-suggest-session-runner
implements:
- chat-ui
- feature-suggest-session
covers:
- frontend/src/store/wireEvents.ts
- frontend/src/store/sessionStore.ts
- frontend/src/components/ChatStream/SuggestionCard.tsx
- frontend/src/components/ChatStream/ChatStream.tsx
- frontend/src/components/ChatStream/ChatStream.css
- frontend/src/types/agent.ts
- frontend/src/types/session.ts
- frontend/src/store/notificationStore.ts
tags:
- high
- new-feature
- frontend
---
# Implement SuggestSession frontend: wiring, store handler, and SuggestionCard

> Parent: [Chat UI](../../frontend/ui-specs/CHAT_UI.md) | Implements: [SuggestSession Feature Spec](../design_docs/SUGGEST_SESSION.md) | Priority: **High** | Created: 2026-03-08

## Context

SuggestSession is an interactive proactive tool that lets the agent suggest follow-up sessions. The backend sends `agent/suggestSession` as a server-initiated JSON-RPC request. The frontend must wire this event, store it as a pending request, render a `SuggestionCard` in the chat stream, and handle approve/dismiss responses.

This follows the exact same pattern as `agent/askUserQuestion` (QuestionCard) and `agent/confirmAction` (ApprovalCard) — the third interactive request type in the chat UI.

## Plan

### 1. Wire event in `wireEvents.ts`

Add `agent/suggestSession` subscription following the `agent/askUserQuestion` pattern:

```typescript
unsubs.push(
  client.on("agent/suggestSession", (p) => {
    const params = p as Record<string, unknown>;
    const bonsaiSid = params.bonsaiSid as string;
    useSessionStore.getState().onSuggestSession(params);
    useNotificationStore.getState().incrementPendingInput();
    useNotificationStore.getState().addToast({
      bonsaiSid,
      eventType: "suggestion",
      message: "Agent suggests a new session",
      persistent: false,
    });
    useNotificationStore.getState().setBadge(bonsaiSid, {
      type: "suggestion",
      pulsing: true,
    });
  }),
);
```

### 2. Add store handler in `sessionStore.ts`

Implement `onSuggestSession` following the `onAskQuestion`/`onConfirmAction` pattern:

```typescript
onSuggestSession: (params) => {
  const bonsaiSid = params.bonsaiSid as string;
  const requestId = params.requestId as string;
  set((s) => {
    const sessions = appendEvent(s.sessions, bonsaiSid, "agent/suggestSession", params, s.closedIds);
    const session = sessions.get(bonsaiSid);
    if (session) {
      sessions.set(bonsaiSid, {
        ...session,
        status: "waiting",
        pendingRequest: {
          requestId,
          type: "suggestion",
          skill: params.skill as string,
          specIds: params.specIds as string[],
          name: params.name as string,
          reason: params.reason as string,
        },
      });
    }
    return { sessions };
  });
},
```

### 3. Create `SuggestionCard.tsx`

New standalone component in `frontend/src/components/ChatStream/`. Follow ApprovalCard's structural pattern (simpler than QuestionCard):

```typescript
interface SuggestionCardProps {
  skill: string;
  specIds: string[];
  name: string;
  reason: string;
  answered: boolean;
  decision?: "approved" | "dismissed";
  onApprove: () => void;
  onDismiss: () => void;
}
```

Visual spec (from [CHAT_UI.md](../../frontend/ui-specs/CHAT_UI.md#suggestioncard)):
- Root: `.chat-suggestion` — blue border (`var(--blue)`), `max-width: 90%`, `var(--elevated)` bg
- Header: `"Session Suggestion"` — 9px uppercase blue label
- Name: session name — 13px bold
- Reason: why — 12px muted
- Skill pill: `.chat-suggestion-skill` — cyan text, light cyan bg, rounded pill
- Spec IDs: comma-separated, 11px hint (only when non-empty)
- Actions: "Start Session" (green) + "Dismiss" (red outline)
- Answered: `✓ Session started` (green) or `✕ Dismissed` (hint), opacity 0.7

### 4. Add CSS styles

Add `.chat-suggestion-*` classes to the ChatStream stylesheet. All classes documented in CHAT_UI.md CSS Class Reference.

### 5. Update `ChatStream.tsx` dispatch

Add `suggestSession` case to the event rendering switch:

```typescript
case "suggestSession":
  return (
    <SuggestionCard
      skill={payload.skill}
      specIds={payload.specIds ?? []}
      name={payload.name}
      reason={payload.reason}
      answered={isAnswered}
      decision={answeredResponse?.behavior === "allow" ? "approved" : "dismissed"}
      onApprove={() => onResolveRequest(requestId, { behavior: "allow" })}
      onDismiss={() => onResolveRequest(requestId, { behavior: "deny", message: "Dismissed" })}
    />
  );
```

### 6. Handle "Start Session" flow in `resolveRequest`

When approving a suggestion, the resolve flow needs to additionally:
1. Call `startSession({ skillId: suggestion.skill, specIds: suggestion.specIds, name: suggestion.name })`
2. Auto-switch to the new session tab

This can be done in the component's `onApprove` handler or in `resolveRequest` when `pendingRequest.type === "suggestion"`. Prefer the component handler for simplicity — the component calls `resolveRequest` then `startSession` then `switchSession`.

### 7. Update toast dismissal in `resolveRequest`

The existing `resolveRequest` dismisses toasts matching `eventType === "question" || eventType === "approval"`. Add `|| eventType === "suggestion"` to also dismiss suggestion toasts.

## Files to modify

- `frontend/src/store/wireEvents.ts` — add `agent/suggestSession` subscription (~15 lines)
- `frontend/src/store/sessionStore.ts` — add `onSuggestSession` handler (~20 lines), update toast dismissal in `resolveRequest` (~1 line)
- `frontend/src/components/ChatStream/SuggestionCard.tsx` — **new file** (~80 lines)
- `frontend/src/components/ChatStream/ChatStream.tsx` — add `suggestSession` case (~12 lines)
- `frontend/src/styles/chat.css` (or colocated CSS) — add `.chat-suggestion-*` styles (~30 lines)

## Design notes

- **SuggestionCard is standalone** — not a QuestionCard variant. The visual and interaction model is different enough (approve/dismiss vs. multi-question survey) to warrant a separate component.
- **"Start Session" creates a real session** — calls `startSession()` with the suggested params. The original session continues in the background.
- **Toast dismissal** must include `"suggestion"` alongside `"question"` and `"approval"`.
- **Tab badge** shows `"S"` for suggestion (vs `"Q"` for question, `"A"` for approval).

## Definition of done

- [ ] `agent/suggestSession` event wired in `wireEvents.ts`
- [ ] `onSuggestSession` handler in `sessionStore.ts` stores pending request
- [ ] `SuggestionCard.tsx` renders suggestion with Start/Dismiss buttons
- [ ] `ChatStream.tsx` dispatches `suggestSession` → `<SuggestionCard>`
- [ ] Approve flow: resolves request + creates session + switches to it
- [ ] Dismiss flow: resolves request, agent continues
- [ ] Answered state renders correctly (opacity, result text)
- [ ] Toast and badge cleared on resolve
- [ ] Unit tests pass for store handler and component rendering
