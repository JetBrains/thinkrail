# Plan attribution v2 — touched-paths model (RFC, draft)

Status: draft · Owner: TBD · Decision needed before coding.

## The problem

Observed in one active session (`.thinkrail/context/todos/<sid>.json`, 35 steps):
- **80% hit rate**: 28 steps carry a `commit` artifact.
- **17% fallback**: 6 steps carry `change` path-list artifacts (not committed).
- **3% silent**: 1 step carries no artifacts; 1 commit on the branch is orphan → shows under "Committed outside the plan" in the UI.

The complaint (`"commits/changes не прикрепляются к TODO step и всё проваливается в other"`) refers to
two concrete failure modes of the current mechanism:

1. **Misattribution from "bundled done".** When the agent flips `status: done` on a step **without
   ever flipping it `in_progress`**, no baseline is captured. Current code falls back to
   `deltaPaths = now` (all dirty paths), so the step claims the entire workspace diff — including
   files it never touched.
2. **Cross-step contamination.** A research/test step opens a window while sibling work has already
   left N files dirty. If a sibling step adds more dirty files during the window, `deltaPaths = now −
   base.paths` picks up those additions and attributes them to the research step, which never touched
   them.

Both come from the same root cause: **the current model infers "what the step did" by diffing dirty
sets, which is contaminated by anything else moving in the same worktree.** On a single-threaded chat
with one in-progress item at a time, this is usually right. On rapid stepping, bundled completions, or
when a subagent commits mid-window, it misattributes.

## The target model

Track **what the agent actually touched during the window**, not **what was dirty around the window**.

Attribution = `{ paths the agent modified via tool calls while this step was in_progress }`.

Everything else (baseline for safety-gate 2, HEAD for in-window adoption, exclusive/sole-window gates)
stays — the touched-paths set replaces only the `deltaPaths` derivation.

### Baseline sidecar schema change

`baselines.json` grows one field per entry:

```jsonc
{
  "version": 2,
  "items": {
    "t_abc": {
      "paths": ["a.ts", "b.ts"],         // existing: dirty at window open (foreign-dirt gate)
      "head": "7fb0...",                 // existing: in-window adoption base
      "shared": true,                    // existing (optional): sticky shared-window flag
      "touchedPaths": ["c.ts", "d.ts"]   // NEW: files the agent modified via tool during window
    }
  }
}
```

Migration: on load, a v1 entry gets `touchedPaths: []` (treated as "no observed work"). This
intentionally means legacy windows degrade to no-attribution rather than the current over-attribution;
the next step going through a full `in_progress → done` cycle lands correctly. Store writes bump
version to 2.

### Hook point: `tool_execution_end`

In `host/server.ts:setSessionPublisher`, in addition to the existing `isTodoToolEnd` branch, add:

```ts
if (payload.event.type === "tool_execution_end") {
  const workspaceId = getSessionWorkspaceId(payload.sessionId);
  if (workspaceId) void maybeRecordTouchedPaths(workspaceId, payload.sessionId, payload.event);
}
```

Called for **every** tool end, not just `todo_*`. Cheap: no reconcile, just one `git` snapshot
compared against a cached pre-call snapshot.

### `maybeRecordTouchedPaths` logic

Per in-progress item (there's exactly one by invariant):

1. Read baselines sidecar; find the in-progress baseline. No in-progress → noop.
2. Snapshot `gitUncommittedPaths` **before and after the tool call** and diff.
   - Keep a per-session cached "last known dirty set" to avoid two git calls per tool.
   - A path that moved into or out of the dirty set because of this tool call is a "touched" path.
3. Add touched paths to the baseline's `touchedPaths` set (minus app-state paths).
4. For explicit file-modifying tools (`edit`, `write`, `multi_edit`, `apply_patch`, `str_replace`),
   also parse the path from args and add to `touchedPaths` directly — this covers the "edit replaced
   content but file remained in dirty set" case where the diff shows nothing.
5. Serialize behind `enqueueTodoMutation` so sidecar reads/writes don't race with the full reconcile.

### `reconcileChangeArtifacts` change

One substantive line change in `packages/server/src/todos/artifacts.ts`:

```ts
// BEFORE
const deltaPaths = base ? now.filter((p) => !base.paths.includes(p)) : now;

// AFTER
const deltaPaths = base
  ? (base.touchedPaths ?? []).filter((p) => now.includes(p))
  : [];  // no baseline = no claim (ends bundled-done misattribution)
```

Everything else — the four gates, in-window adoption, subject derivation, change-vs-commit fallback —
stays. The touched-paths set is a tighter upper bound than "dirty − baseline" and is naturally correct
for research steps (empty touched → empty delta → no artifacts → work shows honestly in
`unattributed` if it belongs elsewhere).

## What this fixes and what it doesn't

| Failure mode | Current behaviour | After v2 |
|---|---|---|
| Bundled done (no `in_progress`) | Grabs ALL dirty paths as `change` | No artifacts (honest "work not attributed") |
| Research step with sibling dirt | `change` artifacts of sibling files | Empty touched → no artifacts |
| Normal `in_progress → done` with real work | Commit on gates pass; `change` on gate 2 fail | Same gates; delta is tighter |
| Subagent commits in exclusive sole window | Adopted into step | Unchanged |
| Subagent commits in shared / multi-window | → `adoptedCommits` ("Other") | Unchanged |
| User hand-edits in a terminal mid-window | Dirt presumed as agent's | Not touched → excluded (fix!) |
| Bash `cat > file` or `sed -i` | Dirt attributed | Pre/post diff catches it → attributed correctly |

**Does not fix:** subagent commits that leak to `adoptedCommits` on shared windows — that's a
different problem (window-sharing gate), orthogonal to the delta source.

## Open questions

**Q1. Pre/post snapshot cost.** Every tool call → two `git status` reads. On a hot session doing
hundreds of tool calls, this adds up. Options: (a) one call + cache the previous result (one git call
per tool end, not two); (b) only snapshot around tools in a known file-modifying set + bash + unknown
tools (skip for `read`, `grep`, `find`, pure-chat).
→ **Recommendation**: b, with the allowlist being the inverse — a short deny-list of safe
read-only tool names (`read`, `grep`, `find`, `ls`, `glob`, `web_search`, `fetch_content`,
`spec_grep`, `spec_get`, `spec_graph`, `todo_*`). Everything else gets pre/post. On tool addition
without a touch effect, the default is "measure once" which is ~1 ms per call — acceptable.

**Q2. Parse args for explicit file tools?** Parsing `edit`/`write` args is reliable; parsing bash is
not. Mixed approach: parse args when the tool name is in a known set, fall back to pre/post diff
otherwise. The two don't conflict (union of both sources).
→ **Recommendation**: yes, parse known args + always run pre/post diff for safety. Union.

**Q3. Subagent tool calls — do they bubble up as `tool_execution_end` events?** Need to verify
`pi-ai`'s event stream. If subagent tool ends don't surface, their touches won't register and the
in-window adoption + change-fallback still carries them (correct but less precise).
→ **Recommendation**: verify first, document the gap, don't block landing on it.

**Q4. Legacy baselines.** v1 entries without `touchedPaths` on load. Options: (a) treat as `[]`
(no attribution); (b) treat as "unknown — fall back to v1 behaviour" (deltaPaths = now − base.paths).
(b) preserves hit-rate during migration but keeps the bug.
→ **Recommendation**: a. The next cycle through `in_progress → done` gets correct attribution; one
transition of lossy behaviour on an in-flight window is acceptable.

**Q5. Expose touchedPaths in the UI?** Could render it as a sidebar during the window ("3 files
touched so far"). Interesting but out of scope.
→ **Recommendation**: not now; separate ask.

## Phased plan

| Phase | Scope | Days |
|---|---|---|
| 1 | Baseline schema bump + migration + storage | 0.5 |
| 2 | `maybeRecordTouchedPaths` + hook in `host/server.ts` | 1 |
| 3 | Pre/post snapshot cache + file-tool arg parsing | 0.5 |
| 4 | `reconcileChangeArtifacts` delta switch to touchedPaths | 0.5 |
| 5 | Tests: bundled-done, research-step, cross-step-dirt, bash-sed, subagent-commits (unit + mocked integration) | 1 |
| 6 | SPEC.md update + full gates | 0.5 |

Total: ~4 days for one engineer. Risk mostly in Q3 (subagent events) and Q1 (cost). Both have safe
fallbacks (over-attribute if events don't fire; eager diffing if cost is OK).

## Decision needed

- Approve Q1–Q4 recommendations?
- Any other hook points to consider besides `tool_execution_end` (session start/end, agent_settled)?
- Should legacy v1 behavior be re-selectable via a feature flag for one release while v2 bakes in?

## See also

- `packages/server/src/todos/SPEC.md` — current attribution contract (sections "Change artifacts" +
  "listTodos decoration — unattributed remainder" + "adopted commits").
- `packages/server/src/todos/artifacts.ts` — `reconcileChangeArtifacts`, `captureNewWorkWindow`,
  `enqueueTodoMutation`, `unattributedChanges`.
- `packages/server/src/todos/baselines.ts` — sidecar read/write.
- `packages/server/src/host/server.ts:setSessionPublisher` — the publish hook that fires on every
  session event; the new `maybeRecordTouchedPaths` lands next to the existing `isTodoToolEnd` branch.
