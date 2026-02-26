# Bonsai — Architecture Design

> Status: **Active** | Created: 2026-02-25

## Table of Contents
1. [Overview](#overview)
2. [Goals & Constraints](#goals--constraints)
3. [System Architecture](#system-architecture)
4. [Backend (Python)](#backend-python)
5. [Frontend (TypeScript/JavaScript)](#frontend-typescriptjavascript)
6. [Data Model](#data-model)
7. [API Design](#api-design)
8. [Deployment](#deployment)
9. [Open Questions](#open-questions)

## Overview

Bonsai is a developer tool and web workspace for specification-driven development. It provides a Python backend API and a TypeScript/JavaScript frontend that runs on developers' machines, offering a comprehensive environment for creating, editing, and visualizing hierarchical specifications that live in the project repository alongside code.

Bonsai serves as both a spec management layer and an AI agent orchestrator — enabling developers to align AI coding agents with clear intent, scope, and constraints through structured project context.

## Goals & Constraints

**Goals:**
- Provide a web-based workspace for managing hierarchical, interconnected specs
- Orchestrate AI coding agents using specs as structured context
- Visualize the spec hierarchy with integrated project health/coverage
- Keep specs in the repo as files, versioned alongside code

**Design Principles:**
- Separation of concerns — each module has one clear responsibility
- Simplicity first — start simple, add complexity only when proven necessary

**Non-Goals (for now):**
- Multi-user collaboration or team features
- Cloud hosting or remote deployment
- Real-time collaborative editing

## System Architecture

**Pattern:** Hybrid — layered at the top level (frontend/backend split) with modular domains inside the backend.

```mermaid
---
title: Bonsai — System Architecture
---
graph TD
    subgraph FEG ["React Frontend"]
        FE["Spec editor, graph visualization, health"]
    end

    FE <-- "JSON-RPC over WebSocket" --> RPC

    subgraph Backend ["FastAPI Backend"]
        RPC["JSON-RPC Handler<br/>spec/*  agent/*"]
        RPC --> Domain

        subgraph Domain ["Domain Modules"]
            Spec["Spec<br/>+models"]
            Agent["Agent<br/>+models"]
        end

        Spec --> Core
        Agent --> Core
        Core["Shared Core<br/>Config FileIO Watcher"]
    end

    Core --> FS
    Core --> AI
    FS[("Repo FS<br/>(specs as files)")]
    AI["AI Agent APIs<br/>(Claude, etc.)"]
```

**Communication Protocol:** JSON-RPC 2.0 over WebSocket (LSP-style, true bidirectional)

The frontend and backend communicate over a single WebSocket connection. Both sides can send
**requests** (with `id`, require a response) and **notifications** (no `id`, fire-and-forget).
This mirrors the Language Server Protocol pattern exactly.

```
  React Frontend ◀═══ JSON-RPC 2.0 / WebSocket ═══▶ FastAPI Backend
    │                                                       │
    │  Client → Server (requests):                          │
    │   spec/*  agent/run  agent/status  agent/list         │
    │   agent/interrupt  agent/respond                      │
    │                                                       │
    │  Server → Client (notifications, no response):        │
    │   spec/did*  registry/didUpdate                       │
    │   agent/sessionStart  agent/textDelta                 │
    │   agent/toolCallStart  agent/toolCallEnd              │
    │   agent/subagentStart  agent/subagentEnd              │
    │   agent/notification  agent/compact                   │
    │   agent/done  agent/error                             │
    │                                                       │
    │  Server → Client (requests, client must respond):     │
    │   agent/askUserQuestion  agent/confirmAction          │
    ▼                                                       ▼
  Browser                              ┌──── File Watcher ────┐
                                       │  .specs/registry.json │
                                       │  spec files (*.md,    │
                                       │  *.json per registry) │
                                       └───────────────────────┘
```

**Data Flow:**

```mermaid
---
title: "Data Flow — Request/Response path (user-initiated)"
---
graph TD
    User["User (Browser)"]
    FE["React Frontend"]
    RPC["FastAPI JSON-RPC Handler"]
    
    subgraph Modules ["Modules"]
      direction LR
      Spec["**Spec Module**<br/>read/write spec files<br/>build hierarchy graph<br/>validate & parse"]
      Agent["**Agent Module**<br/>load specs as context<br/>call AI agent APIs<br/>map SDK events → notifications"]
    end

    Core["Core (Config, FileIO, Watcher)"]

    AI["External AI APIs (Claude, etc.)"]

    FS["Repo FS"]

    DIMMY["-"]

    User --> FE
    FE <-- "JSON-RPC 2.0 / WebSocket" --> RPC
    RPC --> Spec
    RPC --> Agent
    RPC --> Core
    Spec --> Core
    Core <--> FS
    Agent --> AI
    Spec --"spec/did*"--> DIMMY
    Agent -- "agent/textDelta, agent/toolCall*<br/>agent/subagent*, agent/done" --> DIMMY
    Agent -- "agent/confirmAction (request)<br/>agent/askUserQuestion (request)" --> DIMMY
    DIMMY --> RPC
```

```mermaid
---
title: "Data Flow — Async watcher path (any file change, any source)"
---
graph TD
    Change["Repo FS change<br/>(user edit / agent tool call / external tool)"]
    Watcher["Core (Watcher)<br/>watches working directory"]
    Router["rpc/server.py<br/>routes by file type"]
    SpecMod["Spec Module<br/>validate, re-parse,<br/>update registry + graph"]
    Notify["rpc/notifications"]
    FE["Frontend"]
    Future["source files (*.py, *.ts, …)<br/>[future: coverage, health]"]

    Change --> Watcher
    Watcher -- "fires callback registered<br/>by rpc/server.py at startup" --> Router
    Router -- "spec files (*.md or *.json per registry)" --> SpecMod
    SpecMod -- "spec/did*" --> Notify
    Router -- ".specs/registry.json" --> Notify
    Notify -- "spec/did* or registry/didUpdate" --> FE
    Router -. "source files" .-> Future
```

## Backend (Python)

**Framework:** FastAPI

**Module Structure:**

```
backend/
├── app/
│   ├── main.py              # FastAPI app entry point
│   ├── rpc/                 # JSON-RPC Layer
│   │   ├── server.py        # WebSocket + JSON-RPC dispatcher (routes all 3 directions)
│   │   ├── methods/
│   │   │   ├── specs.py     # spec/* methods
│   │   │   └── agents.py    # agent/* methods (incl. agent/respond)
│   │   └── notifications.py # Server→client push (notifications + requests)
│   ├── spec/                # Spec Domain Module
│   │   ├── models.py        # Spec, RegistryEntry, Link models
│   │   ├── service.py       # CRUD operations
│   │   ├── parser.py        # Spec file parsing (Markdown or JSON)
│   │   ├── validator.py     # Spec validation
│   │   ├── graph.py         # Hierarchy & graph building
│   │   └── registry.py      # Registry read/write/validate (atomic writes)
│   ├── agent/               # Agent Domain Module
│   │   ├── models.py        # AgentTask, AgentEvent, AgentResult models
│   │   ├── service.py       # Orchestration facade
│   │   ├── runner.py        # Claude Agent SDK integration; maps SDK events → notifications
│   │   └── tracker.py       # Task lifecycle + asyncio.Future map for pending requests
│   └── core/                # Shared Core
│       ├── config.py        # App configuration
│       ├── fileio.py        # File system operations (read, write, delete files/dirs)
│       └── watcher.py       # Async file change watching
├── tests/
│   ├── test_spec/
│   ├── test_agent/
│   ├── test_rpc/
│   └── test_core/
├── pyproject.toml
└── requirements.txt
```

**Key Dependencies:**
- FastAPI + Uvicorn (web server + WebSocket)
- Pydantic (data validation & models)
- watchfiles or watchdog (file system watching)
- pytest (testing)

## Frontend (TypeScript/JavaScript)

**Framework:** React

**Component Structure:**

```
frontend/
├── src/
│   ├── App.tsx              # Root component
│   ├── components/
│   │   ├── SpecEditor/      # Spec CRUD & editing
│   │   ├── SpecGraph/       # Hierarchy visualization + health
│   │   └── AgentPanel/      # Agent orchestration UI
│   ├── api/                 # Backend API client
│   ├── hooks/               # Custom React hooks
│   ├── types/               # TypeScript type definitions
│   └── utils/               # Shared utilities
├── package.json
└── tsconfig.json
```

**Key Dependencies:**
- React (UI framework)
- Graph visualization library (TBD — e.g., D3, React Flow, Cytoscape)
- JSON-RPC client over WebSocket

## Data Model

Specs are stored as files in the repository. The registry tracks metadata:

**Spec (file on disk):**
- Markdown or JSON files in the repo
- Markdown specs have informal free-form structure (headers, lists, tables, prose)
- JSON specs store structured content as a JSON object
- Content varies by type (goal, architecture, module, task)

**Registry Entry (`.specs/registry.json`):**
- `id` — unique identifier
- `type` — goal-and-requirements | architecture-design | module-design | submodule-design | task-spec
- `path` — relative file path
- `title` — human-readable name
- `status` — draft | active | stale | deprecated
- `covers` — source paths this spec covers
- `tags` — metadata labels
- `created` — creation date (ISO 8601)
- `updated` — last update date (ISO 8601)

**Links (in registry):**
- `from` / `to` — spec IDs
- `type` — parent | child | depends-on | references | implements

## API Design

**Style:** JSON-RPC 2.0 over WebSocket — true bidirectional (LSP-style)

All communication happens over a single WebSocket at `/ws`. Messages follow JSON-RPC 2.0:
- **Requests** have `id` + `method` + `params`; the other side must send back a response with the same `id`
- **Notifications** omit `id`; fire-and-forget, no response expected

Both sides can send either. The server can initiate requests to the client (e.g. asking a question mid-agent-run), and the client responds via `agent/respond`.

---

### Client → Server (requests, client initiates)

| Method | Params | Description |
| --- | --- | --- |
| `spec/list` | `{}` | List all specs with metadata |
| `spec/get` | `{ id }` | Get spec content and metadata |
| `spec/create` | `{ type, path, content? }` | Create a new spec |
| `spec/update` | `{ id, content }` | Update spec content |
| `spec/delete` | `{ id }` | Delete a spec |
| `spec/graph` | `{}` | Get spec hierarchy graph |
| `agent/run` | `{ specIds, config }` | Start an agent task with spec context |
| `agent/status` | `{ taskId }` | Get task status and results |
| `agent/list` | `{}` | List all agent tasks |
| `agent/interrupt` | `{ taskId }` | Interrupt a running agent task |
| `agent/respond` | `{ taskId, requestId, response }` | Respond to a pending server→client request |

---

### Server → Client (notifications, no response needed)

**Spec file changes** (from file watcher):

| Method | Params | Description |
| --- | --- | --- |
| `spec/didChange` | `{ id, changes }` | Spec file changed on disk |
| `spec/didCreate` | `{ id, path }` | New spec file detected |
| `spec/didDelete` | `{ id }` | Spec file removed |
| `registry/didUpdate` | `{ registry }` | registry.json changed |

**Agent viewer events** (mapped from Claude Agent SDK stream):

| Method | Params | SDK source |
| --- | --- | --- |
| `agent/sessionStart` | `{ taskId, sessionId, model, tools[], cwd, permissionMode }` | `SDKSystemMessage` subtype `init` |
| `agent/textDelta` | `{ taskId, sessionId, text, streaming }` | `SDKAssistantMessage` text block / `SDKPartialAssistantMessage` text_delta |
| `agent/toolCallStart` | `{ taskId, sessionId, toolUseId, toolName, toolInput, parentToolUseId? }` | `SDKAssistantMessage` tool_use block |
| `agent/toolCallEnd` | `{ taskId, sessionId, toolUseId, toolName, output, isError }` | `SDKUserMessage` tool_result block |
| `agent/subagentStart` | `{ taskId, sessionId, agentId, agentType, parentToolUseId }` | `SubagentStart` hook |
| `agent/subagentEnd` | `{ taskId, sessionId, agentId }` | `SubagentStop` hook |
| `agent/notification` | `{ taskId, sessionId, message, title? }` | `Notification` hook |
| `agent/compact` | `{ taskId, sessionId, trigger, preTokens }` | `SDKCompactBoundaryMessage` |
| `agent/progress` | `{ taskId, sessionId, status, message }` | General task progress |
| `agent/done` | `{ taskId, sessionId, result, costUsd, turns, durationMs, usage }` | `SDKResultMessage` subtype `success` |
| `agent/error` | `{ taskId, sessionId, subtype, errors[] }` | `SDKResultMessage` error subtypes |
| `agent/permissionDenied` | `{ taskId, sessionId, toolName, toolInput }` | `SDKResultMessage.permission_denials` |

> **Note:** Streaming text requires `includePartialMessages: true` in the SDK options to receive `agent/textDelta` with `streaming: true`. Without it, full text blocks are emitted per turn.

---

### Server → Client (requests, client must respond via `agent/respond`)

The server suspends an `asyncio.Future` keyed by `requestId` until the client responds. If no response arrives within a timeout, the server auto-denies and continues.

| Method | Params | Expected client response |
| --- | --- | --- |
| `agent/askUserQuestion` | `{ taskId, requestId, questions[] }` | `{ answers: { [questionText]: string } }` |
| `agent/confirmAction` | `{ taskId, requestId, toolName, toolInput, description }` | `{ decision: "approve" \| "deny", reason? }` |

**`agent/askUserQuestion` question shape** (maps directly from Claude `AskUserQuestion` tool input):
```json
{
  "question": "Which approach should we use?",
  "header": "Approach",
  "options": [
    { "label": "Option A", "description": "..." },
    { "label": "Option B", "description": "..." }
  ],
  "multiSelect": false
}
```

**`agent/confirmAction`** is triggered by the SDK `canUseTool` callback / `PermissionRequest` hook when a tool needs explicit approval (e.g. destructive Bash commands in `default` permission mode).

## Deployment

- Runs locally on developer machines
- Backend: `uvicorn` serving FastAPI
- Frontend: Dev server (Vite) or built static files served by FastAPI
- Single command to start: `bonsai serve` or similar
- No external database — file-based storage in the repo

## Open Questions

- Which graph visualization library for the frontend? (D3, React Flow, Cytoscape)
- How to handle agent API key management securely?
- Should the frontend be served by FastAPI (single process) or run separately?
- How to handle concurrent agent tasks and resource limits?
- JSON-RPC library: resolved — using `jsonrpcserver` (see `rpc/README.md`)
