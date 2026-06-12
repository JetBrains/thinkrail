---
id: proactive-agent-experience
type: goal-and-requirements
status: active
title: Proactive Agent Experience
parent: goal-and-requirements
depends-on:
- module-agent
- module-rpc
- frontend-module
covers:
- backend/app/agent/
- frontend/src/components/ContextPanel/
- frontend/src/components/ChatStream/
- claude-plugin/
tags:
- high
- improvement
- new-feature
- agent-ux
---
* Project\Feature name: Proactive Agent Experience
* Category: improvement + new-feature
* Priority: high

> Parent: [GOAL&REQUIREMENTS.md](../../GOAL&REQUIREMENTS.md) | Status: **Active** | Created: 2026-03-07

## Goal

Make the agent a proactive workflow driver that uses all available UI surfaces — not just the chat stream. The agent should suggest follow-up sessions with the right skills and context, push structured information to the context panel, propose inline actions the developer can execute with a click, and show its progress and plan in real-time. The developer's role shifts from manual orchestration to approving and choosing from agent-driven suggestions.

## Description

Today, ThinkRail's agent communicates only through the chat stream — text, tool calls, and questions. The developer must manually decide what to do after a session ends: which skill to run next, which specs to attach, what follow-up action to take. The UI has rich surfaces (context panel, notifications, session creation) but the agent has no way to use them.

This improvement introduces custom tools via the ThinkRail plugin that let the agent drive the UI. When the agent calls these tools, `runner.py` intercepts them via `canUseTool` and translates them into notifications or requests for the frontend. The frontend renders these as interactive UI elements the developer can approve, modify, or dismiss. This transforms the developer's role from manual orchestrator to active supervisor of an agent-driven workflow.

## Requirements

### Technology Stack

| Component | Choice |
| --- | --- |
| Backend language | Python 3.11+ (existing) |
| Frontend language | TypeScript (existing) |
| Backend framework | FastAPI (existing) |
| Frontend framework | React (existing) |
| Communication protocol | JSON-RPC 2.0 over WebSocket (existing) |
| Agent SDK | claude-agent-sdk with canUseTool hook (existing) |
| Plugin system | ThinkRail claude-plugin — defines custom tool schemas (existing) |

### Approach

**Pattern:** Custom tools via ThinkRail plugin, intercepted by `canUseTool` in `runner.py`, translated to notifications/requests for the frontend. Same pattern already used for `AskUserQuestion`.

### Custom Tools

#### SuggestSession (interactive — needs developer approval)

- **Agent calls:** `SuggestSession` tool with `{ skill, specIds, name, reason }`
- **Runner intercepts** via `canUseTool` → sends server-initiated request to frontend
- **Frontend renders** a suggestion card in the chat stream (skill, specs, name, reason)
- **Developer approves** → session auto-created and switched to; current session continues in background
- **Developer dismisses** → tool returns "dismissed" to the agent

#### UpdateProgress (passive — auto-approved)

- **Agent calls:** `UpdateProgress` tool with `{ phase, plan, status }`
- **Runner auto-approves** → emits notification to frontend
- **Frontend renders** progress info in the context panel (Agent Context mode)

### Technical Constraints

No additional constraints beyond the existing ThinkRail architecture. New tools are additive and do not break existing sessions or protocol.
