---
id: task-1179-conflation
type: task-spec
title: "#1179 E′: skip intermediate stream snapshots for a backpressured socket, resend the last one on drain"
status: draft
parent: submodule-server-host
---

# #1179 E′: conflate stream snapshots for a backpressured socket

## Request
Follow-up to A1 (PR #1345, branch `ws-slow-consumer-close`, worktree `/tmp/trpi-1179`). A1 closes a socket once `ws.send` returns `0` past `WS_OUTBOUND_BUFFER_LIMIT_BYTES`, and the page re-hydrates after reconnecting. On a slow-but-alive link, streaming traffic can still be O(n²):
- Each `message_update` carries the whole response so far.
- Each `tool_execution_update.partialResult` carries the whole output so far.

So a slow tab reaches the limit and reconnects about every `256 MiB / (push rate - link rate)`.

## Product (decided by the user)
- A socket that is already backpressured skips intermediate snapshots. Its rendering becomes coarser, and it stops piling up backlog.
- **The last skipped snapshot is resent once the socket drains.** Nothing stays stale through a pause. Example: a bash tool prints lines and then runs silently for 2 minutes; the card must not show output missing its last lines for those 2 minutes.
- A fast local socket is unchanged (its buffer is empty, so nothing is skipped).
- There is no new UI.

## Draft design (to review)
1. **Replaceable snapshot.** `pi.event` with:
   - `tool_execution_update` → key `session + "tool" + toolCallId`;
   - `message_update` whose `assistantMessageEvent` has `partial` (start, text_*, thinking_*, toolcall_* including `*_end`) → key `session + "message"`.

   Everything else is non-replaceable, including:
   - `message_update` done/error;
   - `bash_execution_update` (its `delta` appends);
   - message_start/end, tool_execution_start/end, agent_*, queue_update, compaction_*.

   Web reducer evidence: `apps/web/src/store/appStore.ts` ~L764-785 replaces the assistant turn with `ame.partial`; ~L885-892 replaces `toolResults[toolCallId].raw` with `partialResult`; message_end and tool_execution_end replace them again.
2. **Per-socket decision**, in `setSessionPublisher`'s fan-out (`server.ts`, after A1's `fanOut`/`publishScoped`). For each admitted socket:
   - replaceable and `socket.getBufferedAmount() > 0`: hold the frame as `held[clientKey][key]`, replacing any older one, and do not send;
   - replaceable and buffered === 0: send it with `sendOrClose` and delete `held[key]`;
   - non-replaceable event for session S:
     - first delete the held keys it **supersedes**: assistant `message_end` and `message_update` done/error supersede `S+message`; `tool_execution_end(T)` supersedes `S+tool+T`;
     - then **flush every other held frame of S** before the event, in insertion order, so a held snapshot is never reordered after a later event of its session;
     - then send the event.
3. **Flush on drain.**
   - Bun's `drain(ws)` handler, and the existing 1 s `backpressureReconciler` tick when `getBufferedAmount() === 0`, send that client's held frames in insertion order.
   - Stop when a send returns `-1`; the rest wait for the next drain.
   - A held frame is always the newest snapshot for its key, and everything newer for its session has either superseded it or not been sent yet, so a late flush is equivalent to a delayed send.
4. **Cleanup.**
   - Socket close / replacement → drop that client's held frames. Reconnect re-hydrates anyway.
   - `session.deleted` → drop held frames for that session.
5. **Bound.** At most one frame per (socket, session, message | tool call). Memory is the size of those snapshots.
6. **Placement.** A pure module `host/heldSnapshots.ts`, next to `socketSend.ts`, holds the classification and the held map, and is unit-tested. `server.ts` wires it into the pi.event fan-out, `drain`, the reconciler, close and session deletion.
7. **Specs.**
   - `packages/contracts/SPEC.md` (PiEvent): intermediate `message_update` (with `partial`) and `tool_execution_update` frames are replaceable snapshots. The host may withhold them from a backpressured socket and deliver only the latest. A delta-only wire must revisit this.
   - `packages/server/src/host/SPEC.md`: the rule, the drain resend, and the rejected stateless variant.

## Open questions for the review
- Threshold: `getBufferedAmount() > 0`, or a small floor?
- Should the `*_end` content events (text_end / thinking_end / toolcall_end) stay skippable?
- Is flush-before-non-replaceable-event correct, or should held frames simply be dropped then?
- Any reducer, consumer or ordering hazard: other channels (`session.state`), subagent sessions, compaction, retries, the extension UI.
- Interaction with A1's `sendOrClose` close and with terminals sharing the same socket buffer and `drain`.

## Verification plan
- Unit tests for classification, hold / supersede / flush-before / drain order, and cleanup.
- A wire test with a stalled raw TCP client (as in `slowConsumer.test.ts`): held snapshots are not sent while backpressured, the latest one arrives after `resume()`, and order holds against a following non-replaceable event.
- Full server suite, no-agent e2e.
