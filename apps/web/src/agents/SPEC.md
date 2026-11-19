---
id: submodule-web-agents
type: submodule-design
status: active
title: Agents — workspace-wide subagent roster trigger and popover
parent: module-web
depends-on: [module-contracts]
tags: [agents, subagents, roster]
---

## Responsibility

A header **Agents** trigger and popover that lists every subagent in the current workspace across all
chats, projected from the host's `subagent.roster`. The per-chat Resources surfaces (`chat/resources`)
stay props-only and per-chat; this leaf module owns the workspace scope so that boundary stays clean.

## Rules

- The host is the authority. The hook keeps component-local state only: it reads `subagent.roster`,
  refetches on the throttled `subagent.rosterChanged` invalidation and after each reconnect, and drops a
  response whose `revision` is older than the one it holds.
- A host older than `SUBAGENT_ROSTER_PROTOCOL_VERSION` hides the surface. A missing snapshot is never
  rendered as zero.
- Groups are state-first: Failed, Working, Queued, Recently done. State is glyph + color + word, never
  color alone. Every row names its parent chat.
- **Never auto-hide failures.** The host keeps failed rows; the trigger shows a failure marker while any
  exist.
- **No "Needs you" group.** Child sessions are headless and the host cannot represent "blocked on
  approval"; a fake group would train users to ignore the real one once child approval forwarding exists.
- Actions in v1: stop (queued or running rows, via the existing `subagent.stop`, which works from any
  chat). Steer, stop-all, retry and open-parent-chat are later phases.
