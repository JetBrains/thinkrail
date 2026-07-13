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
Keep / Revert / Refine / Open-as-chat quick actions.

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
   `⧉ open in tab`, `■ stop`. The preview is a **read-only** anchored popover showing a live
   compact transcript (reuses the presentational chat renderers). No steer box in v0.
5. **Review presentation = suggestion-style in the text** (mockup option A): old text
   struck-through + new text highlighted, word-level diff, action bar beneath the change with
   the agent's one-line "why", plus an "also touched N other files → Changes" notice.
6. **Monaco v0 caveat (accepted):** in the source view, review = changed-lines highlight + the
   same action bar as a compact card (no in-text strikethrough; that needs view zones and is a
   named follow-up). Trigger/chip/popover have full parity on both surfaces.
7. **Internals = fold pi's edit-tool events** (over a `report_edit` tool or git-snapshot diffs):
   the hunk ledger comes from `edit`/`write` `tool_execution_end` events; the "why" is the
   turn's final assistant text; revert reverse-applies hunks via a new guarded `fs.writeFile`;
   `git.status` at turn end is the safety net for anything the ledger missed.
8. **Scope adds:** Refine-with-comment (followUp on the same session), other-files notice,
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

Own `SPEC.md` + barrel, shaped like `chat`: presentational widgets — selection pill, popup,
status chip, suggestion overlay, action bar, preview popover — plus **one** integration
component (`InlineEditLayer`) that alone touches store/transport and is mounted by the file
surfaces. New dependency edges in `apps/web/SPEC.md`: `panels → inline-edit`,
`inline-edit → chat` (presentational renderers for the popover), `inline-edit → store,
transport` (integration layer only), `inline-edit → components/ui`.

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
InlineEditRequest {
  id, workspaceId, path, sessionId,
  selection { text, startLine, endLine },
  instruction,            // latest user instruction
  beforeContent,          // file snapshot at request time
  status, hunks[{ path, oldText, newText }],
  why?, otherPaths[], error?
}
```

1. **Fire:** `startInlineEdit` re-reads the file (fresh `beforeContent`), `session.create`
   (workspace default model), fire-and-forget `session.prompt` with the seed prompt: file path,
   selected lines, quoted selection, instruction, and rules — *change only what the instruction
   requires; modify files only via your edit/write tools (never bash); do not ask questions; end
   with one short sentence explaining the change* (that sentence = the "why"). Seeding a
   user-turn prompt is the sanctioned pattern (Welcome screen does the same).
2. **Fold:** successful `edit`/`write` `tool_execution_end` events for inline sessions append
   to `hunks`; non-target paths accumulate in `otherPaths`.
3. **Turn end (`agent_end`):** status → `review`; `why` = final assistant text; re-read target
   file and refresh any open tab content (also fixes the tab-staleness gap for touched files);
   `git.status` safety net feeds the other-files notice. **Zero hunks** → info card with the
   agent's reply (Dismiss / Refine only).
4. **Review render:** locate each target-file hunk's `newText` in fresh content → source lines
   → stamped blocks → word-level old/new composite in place. Unanchorable hunk → fallback
   review card under the nearest block (the review is never lost).
5. **Resolve:** **Keep** → `done` (file already holds the text). **Revert** → client computes
   restored content (reverse-apply hunks newest-first; any full-file `write` hunk → restore
   `beforeContent`) → `fs.writeFile` with `ifMatchContent` = last-read content → re-read →
   `done`. **Refine** → `followUp(comment)` → `working`, ledger keeps accumulating. **Stop** →
   `session.abort` → `review` if hunks exist, else cancelled.

Sessions are not disposed on resolve (no dispose on the wire today; same lifetime behavior as
chat sessions). "Open in tab" uses the existing `openChatSession`.

### Error handling

- `session.create`/`prompt` rejection → inline error in the popup; no request registered.
- Mid-turn provider failure: pi `auto_retry_*` renders as "retrying…" on the chip; terminal
  failure → `error` with Retry (followUp) / Dismiss / Open-as-chat.
- `fs.writeFile` conflict → nothing written; toast, re-read, back to `review` with re-anchored
  hunks (or fallback card).
- Host restart: on WS reconnect, in-flight requests → `error("host restarted")`.
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
re-reads listed above.

## Verification

- **Unit (bun test):** server `writeFile` containment + guard; hunk-fold reducer; revert
  computation (incl. `write`-hunk and oldText-not-found); word-diff; sourcepos rehype plugin.
- **e2e no-agent (in `bun run e2e`):** selection → pill; ⌘K path; popup lifecycle (esc/enter);
  one-pending-per-file refusal. Suggestion-overlay + Keep/Revert flows via seeded store state if
  a test hook proves practical, else unit-level.
- **Known gap (explicit scope cut):** no `@agent` e2e for the full loop in v0; verified
  manually. Fast-follow task: `@agent` spec select → edit → suggestion → revert.

## Spec-graph impact (updated during implementation — spec leads code)

- new `apps/web/src/inline-edit/SPEC.md` (submodule-design, parent `module-web`)
- `apps/web/SPEC.md` — dependency edges for `inline-edit`
- `packages/contracts/SPEC.md` — `fs.writeFile`
- `packages/server/src/fs/SPEC.md` — guarded user-initiated write
- `apps/web/src/store/SPEC.md` — `inlineEdits` slice
- `apps/web/src/panels/SPEC.md` — mount points (FilePane/MarkdownPreview/Monaco overlay)
