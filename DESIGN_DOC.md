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

```
 ┌──────────────────────────┐
 │     React Frontend       │
 │  (spec editor, graph     │
 │   visualization, health) │
 └───────────┬──────────────┘
             │ JSON-RPC over WebSocket
 ┌───────────▼──────────────┐
 │     FastAPI Backend       │
 │                           │
 │  ┌── JSON-RPC Handler ──┐ │
 │  │  spec/*   agent/*    │ │
 │  └──────────┬───────────┘ │
 │             │              │
 │  ┌──────────▼───────────┐ │
 │  │   Domain Modules     │ │
 │  │  ┌──────┐ ┌────────┐ │ │
 │  │  │ Spec │ │ Agent  │ │ │
 │  │  │+models│ │+models │ │ │
 │  │  └──┬───┘ └───┬────┘ │ │
 │  └─────┼─────────┼──────┘ │
 │        │         │         │
 │  ┌─────▼─────────▼──────┐ │
 │  │    Shared Core       │ │
 │  │  Config  FileIO      │ │
 │  └──────────┬───────────┘ │
 └─────────────┼─────────────┘
          ┌────▼─────┐  ┌───────────────┐
          │ Repo FS  │  │ AI Agent APIs │
          │ (specs   │  │ (Claude, etc.)│
          │ as files)│  │               │
          └──────────┘  └───────────────┘
```

**Communication Protocol:** JSON-RPC over WebSocket (LSP-inspired)

The frontend and backend communicate over a single WebSocket connection using JSON-RPC 2.0.
This enables bidirectional messaging — the server can push file change notifications to the
client without polling.

```
  React Frontend ◀═══ JSON-RPC/WS ═══▶ FastAPI Backend
    │                                        │
    │  Client → Server (requests):           │
    │   spec/*                               │
    │   agent/*                              │
    │                                        │
    │  Server → Client (notifications):      │
    │   spec/*                               │
    │   registry/*                           │
    ▼                                        ▼
  Browser                     ┌──── File Watcher ────┐
                              │  watches:             │
                              │   .specs/registry.json│
                              │   spec files (*.md)   │
                              └───────────────────────┘
```

**Data Flow:**

```
  User (Browser)
    │
    ▼
  React Frontend ◀══ JSON-RPC/WS ══╗
    │                                ║
    │  requests                      ║ notifications
    ▼                                ║
  FastAPI JSON-RPC Handler           ║
    │                                ║
    ├──▶ Spec Module ────────────────╝
    │     │ read/write spec files
    │     │ build hierarchy graph
    │     │ validate & parse
    │     ▼
    │   Core (FileIO) ◀──▶ Repo FS
    │         ▲
    │         │ file watcher
    │         │ (registry.json, specs)
    │
    ├──▶ Agent Module ───────────────╗
    │     │ load specs as context    ║ agent/progress
    │     │ call AI agent APIs       ║ agent/result
    │     │ stream results back ─────╝
    │     ▼
    │   External AI APIs (Claude, etc.)
    │
    └──▶ Core (Config, FileIO)
```

## Backend (Python)

**Framework:** FastAPI

**Module Structure:**

```
backend/
├── app/
│   ├── main.py              # FastAPI app entry point
│   ├── rpc/                 # JSON-RPC Layer
│   │   ├── server.py        # WebSocket + JSON-RPC dispatcher
│   │   ├── methods/
│   │   │   ├── specs.py     # spec/* methods
│   │   │   └── agents.py   # agent/* methods
│   │   └── notifications.py # Server→client notifications
│   ├── spec/                # Spec Domain Module
│   │   ├── models.py        # Spec, RegistryEntry, Link models
│   │   ├── service.py       # CRUD operations
│   │   ├── parser.py        # Spec file parsing (JSON/YAML/MD)
│   │   ├── validator.py     # Spec validation
│   │   └── graph.py         # Hierarchy & graph building
│   ├── agent/               # Agent Domain Module
│   │   ├── models.py        # AgentTask, AgentEvent, AgentResult models
│   │   ├── service.py       # Orchestration logic
│   │   ├── runner.py        # Agent execution
│   │   └── tracker.py       # Progress & result tracking
│   └── core/                # Shared Core
│       ├── config.py        # App configuration
│       └── fileio.py        # File system operations
├── tests/
│   ├── test_spec/
│   ├── test_agent/
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
- Markdown files in the repo
- Content varies by type (goal, architecture, module, task)

**Registry Entry (`.specs/registry.json`):**
- `id` — unique identifier
- `type` — goal-and-requirements | architecture-design | module-design | submodule-design | task-spec
- `path` — relative file path
- `status` — draft | active | stale | deprecated
- `covers` — source paths this spec covers
- `tags` — metadata labels

**Links (in registry):**
- `from` / `to` — spec IDs
- `type` — parent | child | depends-on | references | implements

## API Design (to be designed)

**Style:** JSON-RPC 2.0 over WebSocket (LSP-inspired)

All communication happens over a single WebSocket connection at `/ws`. Messages follow the
JSON-RPC 2.0 specification — requests have `id` + `method` + `params`, notifications omit `id`.

**Client → Server (requests):**

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

**Server → Client (notifications):**

| Method | Params | Description |
| --- | --- | --- |
| `spec/didChange` | `{ id, changes }` | Spec file changed on disk |
| `spec/didCreate` | `{ id, path }` | New spec file detected |
| `spec/didDelete` | `{ id }` | Spec file removed |
| `registry/didUpdate` | `{ registry }` | registry.json changed |
| `agent/progress` | `{ taskId, status }` | Agent task progress update |
| `agent/result` | `{ taskId, output }` | Agent task completed |

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
- JSON-RPC library choice: custom implementation or existing library (e.g., jsonrpcserver)?
