---
id: task-single-chat-doc-history
type: task-spec
status: done
title: "Center area: single chat tab + a last-10 opened-documents History"
parent: submodule-web-panels
---

# Center area: single chat tab + a last-10 opened-documents History

## Request (user, two related changes)

1. **Single chat only.** The center area currently allows multiple parallel chat tabs. There must
   only ever be **one** chat tab; remove the "new chat" affordance. **UI-only** — do NOT dispose or
   terminate agent sessions on the server; closing/limiting a chat tab is a view action, the session
   keeps living on the host. Everything else about tabs is unchanged — spec files and diffs still open
   as center tabs alongside the single chat tab.
2. **History of opened documents.** The History icon next to the center tabs holds the **last 10
   opened documents** — spec files, diffs, and regular files (**NOT** chat). Most recent on top;
   >10 drops the oldest. Clicking an item re-opens it as a center tab. **View state only** —
   client-side / localStorage; no wire / server / domain changes.

Frontend-only, minimal, mocked data where needed, keep the existing tokens (violet #8C81FF, dark
theme, three-font system). **Own commit** (independently revertable).

## Current state (audit)

- `CenterTabs.tsx`: new-chat affordances = the `+` **`new-chat`** button in the tab strip, the
  **`start-chat`** "New chat" button in the empty-workspace placeholder, and `startChat()`
  (`session.create` → `store.openChatSession`). Multiple chat tabs are possible.
- The **History icon** today (`ChatHistoryMenu`, testid `chat-history`) lists **closed chats**
  (`closedChatsByWorkspace`, `closed-chat-item`) and reopens them.
- Chat close routes to `store.closeChatToHistory` (tab removed, runtime/session kept alive);
  workspace-activate **hydrates**: live sessions → tabs, disk-only → chat-history
  (`noteClosedChats`). The initial session is seeded at **workspace creation**
  (`NewWorkspaceDialog` → `session.create` → `openChatSession`), not via the in-center button.
- Store chat-history machinery: `ClosedChat`, `closedChatsByWorkspace`, `closeChatToHistory`,
  `reopenChat`, `noteClosedChats`. No persist middleware; localStorage precedent in `utils/theme`.
- Affected e2e (all `@agent`): `multi-chat`, `reopen-chat` (both assert the removed behavior).

## Decisions (user-confirmed)

1. **Non-closable chat tab** — the chat tab has no `X`; exactly-one is guaranteed, no reopen gap.
2. **Per-workspace history**, persisted to localStorage (matches the per-workspace tab model;
   worktree-relative paths only reopen cleanly in their own workspace).
3. **Remove the closed-chat machinery**; on workspace-activate restore a single chat tab.

## Key constraint found during audit

`NewWorkspaceDialog` only seeds a session when the **prompt is non-empty** (`if (!text) return`), and
the fixture + 6 `@agent` specs bootstrap a chat via the placeholder **`start-chat`** button. So the
true "parallel chats" creator is the **`+ new-chat`** button in the tab strip (always visible). The
placeholder `start-chat` only appears when the center has **zero** tabs.

## Design

### 1. Single chat (UI-only)
- **Remove the `+ new-chat` strip button** (the only creator of a *second* parallel chat) and
  `startChat`'s strip call. **Keep the placeholder `start-chat`** button as the single-chat
  bootstrap: it's structurally single — the placeholder shows only at zero open tabs, and once the
  chat exists (non-closable) the placeholder never returns, so a second chat can't be made.
- **Chat tab non-closable**: no `X` for `kind === "chat"`; file/diff tabs keep theirs. `onCloseTab`
  drops its chat branch (only file/diff close). No session/runtime is ever disposed by the view.
- **Hydration caps to one**: on workspace-activate, if a chat tab already exists → skip; else
  `session.list` → pick the **most-recently-updated** summary → `getMessages` → `hydrateSession`.
  Extra host sessions stay live (UI-only), just untabbed. The old multi-session loop + disk-only→
  history path is removed.

### 2. Opened-documents History (view state, localStorage, per workspace)
- Store: `DocHistoryEntry { kind: "file" | "diff"; path; name }`,
  `docHistoryByWorkspace: Record<string, DocHistoryEntry[]>`, action **`noteDocOpened(ws, entry)`**
  (dedupe by `kind+path`, prepend, cap **10**, persist). Init reads localStorage; `clearWorkspaceTabs`
  drops the removed workspace's list + persists. Persistence is a store-internal
  `store/docHistoryStorage.ts` (read/write `thinkrail:docHistory`, try/catch, cap-on-read) — mirrors the
  `utils/theme` localStorage precedent, kept inside the store module (no new cross-module edge).
- Recording choke points: **`openFileInTab`** (specs, file tree, markdown links) records after a
  successful read (and on focus-existing), never on a failed read; **`openDiffInTab`** records on open
  + focus-existing. NOT chat (chat never routes through these).
- UI: `ChatHistoryMenu` → **`DocHistoryMenu`** on the same **History** icon (testid `chat-history` →
  `doc-history`; items `closed-chat-item` → `doc-history-item`), most-recent-first, per-kind icon +
  path; click reopens (`file`→`openFileInTab`, `diff`→`openDiffInTab`). Shown when the active
  workspace's list is non-empty.

### Store cleanup (feature replaced, not paused)
Remove `ClosedChat`, `closedChatsByWorkspace` (+ init), `closeChatToHistory`, `reopenChat`,
`noteClosedChats`, and their handling in `clearWorkspaceTabs` + `hydrateSession`. (`closeChatRuntime`
is a pre-existing app-unused primitive — left as-is, out of scope.)

### Tests
- Unit (`appStore.test.ts`): drop the closed-chat tests; add `noteDocOpened` (dedupe / cap-10 /
  recent-first) + `clearWorkspaceTabs` drops doc history.
- e2e: **delete** `multi-chat.live` (multi-chat gone) + `reopen-chat.live` (closed-chat reopen gone);
  **update** `ask-restart.live` + `ask-user-question.live` to expect the single chat to auto-restore
  on reload instead of a chat-history click (`@agent` — edited, not run; flagged in handoff). Add a
  **no-agent** `e2e/doc-history.spec.ts`: open files/diffs → History lists them recent-first / cap-10
  → click reopens → survives reload; assert `+ new-chat` strip button is absent.

## Out of scope
Auto-creating a session on activate (would fire `session.create` in the no-auth no-agent suite on
every workspace activation — breaks it), cross-workspace history, chat in History.
