---
id: task-inline-edit-v0
type: task-spec
status: active
title: Inline AI-editing v0 — select, instruct, review-in-place
parent: module-web
depends-on: [module-contracts, submodule-server-fs]
references: [submodule-web-panels, submodule-web-store, submodule-web-chat]
tags: [v1, inline-edit, ux]
---

## Request

MVP of **inline AI-editing**: select text in an open file, tell the agent what to change in a
small popup at the selection, the agent edits the file in a hidden background session, and the
change comes back as an **in-place suggestion** (strikethrough old / highlighted new) with
Keep / Undo-last-change / Revert-all / Refine / Open-as-chat quick actions.

This is the first step of a larger direction: moving from "chat as the center of everything"
toward a continuous, background-but-transparent AI assistant (later: document comments,
semantic autocompletion, run-agent-on-comments). Only item "inlined AI-editing" is in scope here.

## Decisions (all confirmed with user, incl. browser mockups)

1. **Both surfaces from day one.** The trigger (selection → pill → popup) works in the rendered
   markdown view *and* the Monaco source view. Review presentation differs (decision 6).
2. **Apply → review → revert.** The agent edits the file directly through its own pi tools; the
   user reviews after the fact and may revert. No propose/stage step, no blocking tool.
3. **Hidden per-edit session.** Each request runs its own pi session. It **never appears in the
   tab strip unless explicitly promoted** — via "open in tab" (working chip / popover / review
   bar). Parallel requests on different files are allowed; **one pending request per file**.
4. **Working state = accent bar + status chip** on the target region with `👁 preview`,
   `⧉ open in tab`, `■ stop`. The accent bar is a **violet (`--primary`) left bar** on the region the
   agent is running on ("running here" — a Monaco gutter bar on the selected lines; a `border-l` on the
   working block in the rendered view). The preview is a **read-only** anchored popover showing a live
   compact transcript (reuses the presentational chat renderers). No steer box in v0.
5. **Review presentation = inline, in the document flow (not a floating overlay).** The change is
   **woven into the text itself** — old struck-through + new highlighted, word-level — carrying a
   **GitHub-style colored left bar** on the reviewed region (**green** when the change adds/rewrites
   content, **red** for a pure deletion). The action box (Keep / Undo-last / Revert-all / Refine /
   Open-as-chat + the agent's one-line "why" + the "also touched N other files → Changes" notice) is
   inserted as a **block directly below the change**, pushing following content down (like a review
   comment attached under the hunk). No `position:fixed` card.
6. **Monaco source view = the same, natively.** The changed lines get a highlight decoration in place —
   a subtle green line wash **plus a green left-gutter bar** — and a **view zone** is inserted between
   the lines directly below holding the woven diff (the same green/red-barred `InlineSuggestion`) + the
   same action box; Monaco pushes lines apart to make room. This covers markdown-source AND code files.
   (The edit already landed in the buffer under apply→review→revert, so "removed" text lives in the
   zone.) Trigger/chip/preview and the left-bar markers have full parity on both surfaces.
7. **Internals = fold pi's edit-tool events into a per-turn history** (over a `report_edit` tool
   or git-snapshot diffs): each Refine appends a **turn** capturing the target-file content at its
   start (`baseContent`) + the hunks it produced (from `edit`/`write` `tool_execution_end` events)
   + its "why" (the turn's final assistant text). **Undo-last-change** and **Revert-all** restore
   saved content **snapshots** (a turn's `baseContent`, or turn 0's = the fire-time original) via a
   guarded `fs.writeFile` — no hunk replay, so revert is exact regardless of edit/write or refine
   depth. `git.status` at turn end is the safety net for anything the ledger missed.
8. **Scope adds:** Refine-with-comment (a fresh `prompt` turn on the same session — the session is idle in
   review, so `followUp` would only queue, not start a turn), other-files notice,
   parallel-across-files. **Deferred by choice:** the `@agent` e2e happy-path spec (see
   Verification), document comments, autocompletion, multi-suggestion alternatives.

## Design

### Wire (`packages/contracts`)

One new method: `fs.writeFile { workspaceId, path, content, ifMatchContent? } → { ok: true }`.
Generic guarded write (optimistic-concurrency: server compares current content to
`ifMatchContent` when provided and rejects on mismatch). In v0 only Revert calls it; future
manual editing reuses it. Protocol version bumps. Everything else rides existing methods
(`session.create/prompt/followUp/abort`, `fs.readFile`, `git.status`) and the `pi.event` stream.

### Server (`packages/server`)

- `fs` module: `writeFile` with the same path-containment as `readFile` + the `ifMatchContent`
  guard. `fs/SPEC.md` updated first: reads → reads + **user-initiated** guarded writes. The
  engine rule holds: agent-driven edits go only through pi; a host write happens only as a
  direct user action (revert — same class as typing in a terminal).
- `host/handlers.ts`: register `fs.writeFile`.
- **No changes to the `agent` module** — no new pi tool, no prompt assembly.

### Web (`apps/web`) — new sub-module `src/inline-edit/`

Own `SPEC.md` + barrel, shaped like `chat`: the presentational widgets (selection pill, popup, status
chip, suggestion overlay, action bar, preview popover) stay **internal**, and the barrel exposes only the
**per-surface controller hooks** (`useMarkdownInlineEdit`, `useMonacoInlineEdit`) that the file surfaces
call, the headless `InlineEditOrchestrator` (post-turn readback, mounted once), and types. The store/
transport reach is concentrated in `actions.ts` (fire/refine/keep/revert/stop/open-in-tab) plus those
integration pieces — not spread through the widgets. New dependency edges in `apps/web/SPEC.md`:
`panels → inline-edit`, `inline-edit → chat` (presentational renderers for the popover),
`inline-edit → store, transport`, `inline-edit → components/ui`.

Selection anchoring:
- **Rendered markdown:** a tiny rehype plugin (preview-only) stamps block elements with source
  line ranges from remark positions; DOM selection → enclosing stamped blocks →
  `{ startLine, endLine }` + exact selected text; pill positions at the selection rect.
- **Monaco:** native selection API; pill as an editor overlay widget.
Both produce one `SelectionTarget` feeding the shared popup.

### Store slice & lifecycle

`inlineEdits: Record<requestId, InlineEditRequest>` + `sessionId → requestId` index.
States: `starting → working → review → done` (+ `error`; `reverting` transient).

```
EditTurn {
  instruction,            // the instruction/comment that drove this turn
  baseContent,            // target-file content at the START of this turn (the step-back target)
  hunks[{ path, kind, oldText, newText }],
  pendingTools,           // edit/write tool calls seen start-but-not-end this turn
  otherPaths[],           // non-target paths this turn touched
  why?
}
InlineEditRequest {
  id, workspaceId, path, sessionId,
  selection { text, startLine, endLine },
  afterContent?,          // current on-disk content (readback) — revert guard + anchor base
  turns[EditTurn],        // ≥1; the last is under review; turns[0].baseContent = fire-time original
  status, error?
}
```

1. **Fire:** `startInlineEdit` re-reads the file, `session.create` (workspace default model),
   registers the request with `turns: [turn0]` (`turn0.baseContent` = the fresh read = fire-time
   original), then fire-and-forget `session.prompt` with the seed prompt: file path, selected
   lines, quoted selection, instruction, and rules — *change only what the instruction requires;
   modify files only via your edit/write tools (never bash); do not ask questions; end with one
   short sentence explaining the change* (that sentence = the "why"). Seeding a user-turn prompt is
   the sanctioned pattern (Welcome screen does the same).
2. **Fold:** successful `edit`/`write` `tool_execution_end` events for inline sessions append to
   the **current turn's** `hunks`; non-target paths accumulate in that turn's `otherPaths`.
3. **Turn end (`agent_end`):** status → `review`; current turn's `why` = final assistant text;
   re-read target file and store as `afterContent` + refresh any open tab (also fixes the
   tab-staleness gap for touched files); `git.status` safety net feeds the other-files notice.
   **Zero hunks in the turn** → info card with the agent's reply (Dismiss / Refine only).
4. **Review render (in the document flow, not a floating overlay):** a line-diff of the current turn's
   `baseContent` vs `afterContent` (both frontmatter-stripped for the rendered view) gives the changed
   line range. **Rendered markdown:** a per-render rehype pass marks the changed block(s) and inserts a
   slot after them; component overrides render the woven word-diff (old struck / new highlighted, from
   the hunk) in place + the action box in the slot (in flow). **Monaco:** a line decoration highlights
   the changed lines + a view zone below them holds the removed text + action box. A "turn N of M"
   indicator shows the refine depth. Unanchorable (no changed range found) → the box renders under the
   nearest block / at the selection line (the review is never lost).
5. **Resolve (all snapshot-based, no hunk replay):**
   - **Keep** → `done` (file already holds the text).
   - **Refine(comment)** → push a new turn (`baseContent` = current `afterContent`) →
     `prompt(comment)` on the same (idle) session → `working`. (Not `followUp`: at review the prior turn's
     `agent_end` has fired, so the session is idle and `followUp` would only queue, never starting a turn.)
   - **Undo-last-change** → `fs.writeFile(currentTurn.baseContent, ifMatchContent = afterContent)`
     → re-read → **pop the last turn**: if turns remain, back to `review` of the now-last turn;
     if it was the only turn, `done`. Repeatable, one refinement at a time.
   - **Revert-all** → `fs.writeFile(turns[0].baseContent, ifMatchContent = afterContent)` →
     re-read → `done`.
   - **Stop** → `session.abort` → `review` if the current turn has hunks, else cancelled.

Sessions are not disposed on resolve (no dispose on the wire today; same lifetime behavior as
chat sessions). "Open in tab" uses the existing `openChatSession`.

### Error handling

- `session.create`/`prompt` rejection → inline error in the popup; no request registered.
- Mid-turn provider failure: pi `auto_retry_*` keeps the working chip while it retries (the countdown
  isn't a separately-labelled chip state in v0); terminal failure → `error` with Retry (followUp) /
  Dismiss / Open-as-chat.
- `fs.writeFile` conflict (undo/revert) → nothing written; toast, re-read, stay in `review`.
- **Known gap (v0):** host restart does *not* reset in-flight requests. A request that was `working`
  when the host went down stays on the "editing…" chip (its dead session emits no `agent_end`); **Stop**
  is the manual escape. Resetting in-flight requests to `error("host restarted")` on WS reconnect is a
  fast-follow.
- Closing a tab does **not** cancel its request (state lives in the store; reopening the file
  shows current status). Removing a workspace aborts its inline sessions best-effort.

### UX reference

Validated via browser mockups (ephemeral, `.superpowers/brainstorm/`, gitignored): five-frame
story — 1 select (pill `✦ Edit ⌘K`), 2 instruct (one-line popup, Enter fires & closes),
3 working (accent bar + chip + read-only preview popover), 4 review (suggestion-style in text),
5 resolved. The decisions above are the durable record.

## Out of scope (v0)

Document comments & comment panel; semantic autocompletion; run-agent-on-comments; multiple
alternative suggestions; per-hunk accept; Monaco in-text strikethrough parity; manual typing /
save (and any general `fs.writeFile` UI); session disposal; file watching beyond the explicit
re-reads listed above. **Rendered-markdown woven-diff fidelity:** the rendered view splits the
document into two independently-parsed halves around the changed range and renders the changed
region as flat prose, so a selection spanning a multi-line construct (fenced code, table, list)
may mis-render *during review* (it self-heals to a correct whole-document render on Keep/Revert).
True block-level/DOM-tree strikethrough is out of scope for v0.

## Verification

- **Unit (bun test):** server `writeFile` containment + guard; per-turn fold reducer (hunks land
  on the current turn after a successful end; refine pushes a turn; agent_end sets review + why);
  the `actions` snapshot targets on a mocked transport (undo restores the current turn's base then
  pops; revert-all restores `turns[0]`; the write-guard is re-synced so repeatable undo isn't
  spuriously rejected; a write conflict stays in `review`; one-pending-per-file is refused at the
  fire path); word-diff incl. the round-trip invariant; selection anchoring (`anchor.test.ts`).
- **e2e no-agent (in `bun run e2e`):** selection → pill; ⌘K opens the popup; popup Esc-close. (The
  full fire → review → Keep/Revert loop needs a live agent — covered by `actions` unit tests above +
  manual verification, not e2e.)
- **Known gap (explicit scope cut):** no `@agent` e2e for the full loop in v0; verified
  manually. Fast-follow task: `@agent` spec select → edit → suggestion → revert.

## Spec-graph impact (updated during implementation — spec leads code)

- new `apps/web/src/inline-edit/SPEC.md` (submodule-design, parent `module-web`)
- `apps/web/SPEC.md` — dependency edges for `inline-edit`
- `packages/contracts/SPEC.md` — `fs.writeFile`
- `packages/server/src/fs/SPEC.md` — guarded user-initiated write
- `apps/web/src/store/SPEC.md` — `inlineEdits` slice
- `apps/web/src/panels/SPEC.md` — mount points (FilePane/MarkdownPreview/Monaco overlay)
