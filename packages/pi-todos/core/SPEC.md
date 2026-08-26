---
id: submodule-pi-todos-core
type: submodule-design
status: draft
title: pi-todos core (pi-free model)
parent: module-pi-todos
tags: [pi-extension, todos, v2]
---

## Responsibility

The pi-free TODO model: the `Todo` types (the status vocabulary) and `TodoStore` — a **per-session**
list stored as one file, `.thinkrail/context/todos/<sessionId>.json` (under the ephemeral context scratch
dir), read and written by read-modify-write. The
file is the source of truth; the store holds no mutable state, so every method re-reads and stale reads
are impossible (the agent's in-session writes and the UI's edits converge on the same file). Robust by
construction: a missing or corrupt file reads as an empty list, and unknown/invalid fields are dropped on
read (`sanitize`), so a hand-edited file never crashes a session.

**Artifacts.** An item may carry `artifacts` — links to what the work produced: `kind: "file" | "change" |
"spec" | "commit"`, an optional `label`, and per kind either a worktree-relative `path`
(`file`/`change`/`spec`, plus a durable graph `specId` for `spec`) or a `sha` (`commit`). The model just
stores them; it does not resolve paths, compute diffs, or touch git. `file`/`spec` are attached by the
agent (a `spec` naturally from `spec_create`'s `{path,id}`); `change` **and** `commit` are attached by the
host when an item reaches `done` — the host commits the item's work and records just the sha, or falls
back to a `change` path-list when it couldn't commit (see `server/src/todos` — the store stays git-free). `sanitize` drops an entry lacking its key (a `commit` with
no `sha`, any other kind with no `path`). The on-disk `version` is `5` (`3` added `artifacts`, `4` added
the `commit` kind, `5` added the `summary` fields); an older file reads cleanly and is upgraded on the
next write.

**Summaries (the review trail).** An item may carry `summary` — the agent's completion note (what/why,
the decisions the diff can't show) — and **`verification`**, a separate field for the exact check run +
result (or the honest "not verified"), kept apart from the prose so the UI renders it as a status badge
and a missing line is visible at a glance; both set via `TodoPatch` when the item flips `done`; the plan itself may carry a
plan-level `summary` (`TodoFile.summary`, written by `TodoStore.setSummary`) — the overall handoff note
the agent writes when the whole plan completes. Both are stored verbatim across later edits, with one
invalidation rule: `update` clears an item's `summary`/`verification`, and drops the plan-level `summary`
with it, the moment that item's `status` leaves `done` — unless the same patch also supplies fresh values
for them, which win. A UI reader can gate display on "everything done", but a non-UI consumer (a generated
PR body, a work report) has no such gate, so a reopened item's stale completion story must not survive on
disk, not merely be hidden. `replaceAll` deliberately does **not** carry the plan summary over — a
fresh plan is new work. Review *state* is never stored here: it is user-owned and lives in a host sidecar
(see `server/src/todos`), so an agent re-plan can't flip a review decision.

**Group = task.** A group models one user ask; its items are the steps. A group's lifecycle is
**derived, never stored**: `groupStatus(group)` — all done → `done`, any in_progress → `active`, else
`pending` — so it can't drift from the steps. It has **one home**: the host reads it through this helper and
ships the result on the wire DTO (`TodoGroupItem.status`, see [[submodule-server-todos]]), so `apps/web` —
which may import `contracts` only — renders it rather than keeping a second copy of the truth table.

**Linearity invariants** (held structurally): `update` setting `in_progress` auto-demotes every other
`in_progress` item back to `pending` in the same write and returns them (`TodoUpdateResult.paused`) so
the change stays visible; `replaceAll` re-establishes it over its **merged** result (fresh plan + the kept
user/done items), in display order — normalizing only the fresh half would leave a kept user item that is
`in_progress` beside a fresh `in_progress` step, i.e. two at once. `add`
takes `after` (an existing item id) to insert right after that item, **inheriting its lane** — the
surgical mid-plan insert (`after` wins over `group`; an unknown id throws).

## Public surface

The `index.ts` barrel:
- `TodoStore` (constructed per `(root, sessionId)`, incl. `setSummary` — the plan-level completion
  summary), `STORE_DIR` / `storeRel`, and the `countItems(plan)`
  + `flatItems(plan)` (every item in display order: groups first, the user's loose lane last — the one
  flatten reused by reads/updates/rendering) + `groupStatus(group)` helpers.
- The model types: `Todo`, `TodoGroup`, `TodoPlan`, `TodoFile`, `TodoInput`, `TodoPatch`,
  `TodoUpdateResult`, `WriteItem`, `WritePlan`, `TodoArtifact`, and the `TodoStatus` / `TodoOrigin` /
  `TodoGroupStatus` / `TodoArtifactKind` aliases.
- The `TODO_STATUSES` (`pending | in_progress | done`), `TODO_ORIGINS` (`agent | user`), and
  `TODO_GROUP_STATUSES` (`pending | active | done`, derived-only) tuples — the single source for the
  tools' param enums. (There is **no** priority concept; priorities were dropped.)

Writes are atomic (temp file + `rename`); a session id is validated as a safe path segment before it
becomes a filename, and `\uXXXX` escape-decoding is applied to **agent-authored** text only, never the
user's own input.

## Boundary

- **Allowed deps:** Node built-ins only (`node:fs`, `node:path`, `node:crypto`).
- **Forbidden:** any `@earendil-works/*` **and any `@thinkrail/*`** import — this is the pi-free,
  thinkrail-free layer the host can value-import without pulling pi into its bundle, and that stays
  installable under vanilla `pi`. Consequence: `STORE_DIR` (`.thinkrail/context/todos`) carries a **local
  mirror** of `@thinkrail/shared`'s `WORKSPACE_CONTEXT_DIR` rather than importing it — the shared constant
  is the host-side source of truth; keep the two in step. `tools/` imports this through the barrel;
  nothing here imports `tools/`.
