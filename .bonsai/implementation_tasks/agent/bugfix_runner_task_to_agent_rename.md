---
id: bugfix-runner-task-to-agent-rename
type: task-spec
status: done
parent: module-agent
implements:
  - module-agent
covers:
  - backend/app/agent/runner.py
  - backend/tests/agent/test_runner.py
tags:
  - critical
  - bug-fix
---

# Fix runner.py: rename "Task" tool check to "Agent" for subagent correlation

The Claude Code SDK (v0.1.68) renamed the subagent-spawning tool from `"Task"` to
`"Agent"`. The backend `runner.py` still checks `block.name == "Task"` (line 283),
so `_pending_task_tool_ids` is never populated, the `_parent_to_agent` mapping is
never built, `_resolve_agent_id()` always returns `None`, and all subagent events
(`textDelta`, `toolCallStart`, `toolCallEnd`) are missing their `agentId` field. The
frontend cannot group events under `SubagentBlock` components.

## Evidence

- Live SDK probe confirmed the model lists `"Agent"` as the subagent tool (not `"Task"`)
- Frontend `toolHeaderExtractors.ts` already uses `Agent: agentExtractor` (line 117)
- The module-agent spec (`README.md`) was updated in the preceding `/bug-fix` session
  to reflect the `"Agent"` name

## Plan

1. **runner.py:283** — Change `block.name == "Task"` to `block.name == "Agent"`
2. **runner.py:88-90** — Rename `_pending_task_tool_ids` → `_pending_agent_tool_ids`
   and update the docstring on line 88 ("Queue of Task ToolUseBlock…" → "Queue of
   Agent ToolUseBlock…") plus all references (lines 97-98, 284)
3. **runner.py:96** — Update comment "Correlate this subagent with its Task tool call"
   → "…Agent tool call"
4. **test_runner.py:837** — Change `task_block.name = "Task"` to `"Agent"`
5. **test_runner.py:838** — Update mock input dict if `"Agent"` uses different fields
   (verify SDK schema; likely same fields)
6. **test_runner.py:950-952** — Update assertion `t["toolName"] == "Task"` to
   `t["toolName"] == "Agent"` and the assertion message

## Files to modify

- `backend/app/agent/runner.py` — tool name check + variable rename + comment updates
- `backend/tests/agent/test_runner.py` — mock name + assertion updates

## Definition of done

- [x] `uv run pytest tests/agent/test_runner.py -v` passes with updated assertions (22/22 passed)
- [ ] Manual verification: start a session that spawns a subagent → confirm
      `agent/textDelta`, `agent/toolCallStart`, `agent/toolCallEnd` events include
      `agentId` field
- [x] No references to `"Task"` remain in runner.py subagent correlation logic

**Priority:** Critical
**Started:** 2026-04-28
**Completed:** 2026-04-28
