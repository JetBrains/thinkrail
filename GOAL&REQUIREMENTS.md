---
id: goal-and-requirements
type: goal-and-requirements
status: active
title: ThinkRail Goal & Requirements
tags:
- high
- new-project
---
* Project\Feature name: ThinkRail
* Category: new-project
* Priority: high

## Goal

Build a developer tool that introduces specification-driven development — where hierarchical, interconnected specs live in the repo alongside code — to help developers effectively control and align AI coding agents through structured project context.

## Description

ThinkRail is a developer tool and web workspace for specification-driven development. It provides a Python backend API and a TypeScript/JavaScript frontend that runs on developers' machines, offering a comprehensive environment for creating, editing, and visualizing hierarchical specifications that live in the project repository alongside code. Specs are interconnected, forming a structured knowledge graph that captures project goals, architecture, module designs, and tasks.

ThinkRail serves as both a spec management layer and an AI agent orchestrator. By maintaining rich, structured project context in the repo, it enables developers to align AI coding agents with clear intent, scope, and constraints — making agent-assisted development more predictable and effective. The tool can feed specs to agents, monitor their work, and track progress against the specification hierarchy.

## Requirements

### Feature Requirements

| Requirement | Priority | Rationale |
| --- | --- | --- |
| Spec hierarchy & graph visualization (with integrated project health/coverage) | high | Core value prop — developers need to see and navigate the spec tree and understand project state at a glance |
| Agent orchestration (feed specs to agents, run tasks, collect results) | high | Key differentiator — structured specs enable controlled, predictable agent-assisted development |
| Spec CRUD & editor (web UI) | medium | Necessary for creating and maintaining specs, but can start with basic editing |
| Spec templates (pre-built templates for goals, architecture, modules, tasks) | low | Convenience feature — helps onboarding but not essential for core workflow |

### Technology Stack

| Component | Choice |
| --- | --- |
| Backend language | Python |
| Backend framework | FastAPI |
| Frontend language | TypeScript |
| Frontend framework | React |
| Communication protocol | JSON-RPC over WebSocket (LSP-inspired) |
| File watching | watchfiles (spec files, .tr/ config files) |
| Data validation | Pydantic 2.0+ (models & serialization) |
| ASGI server | uvicorn (serving FastAPI) |
| JSON-RPC library | jsonrpcserver (JSON-RPC 2.0 protocol) |
| Agent SDK | claude-agent-sdk (AI agent orchestration) |
| Database | File-based (Markdown or JSON in repo) |
| Testing (backend) | pytest |
| Testing (frontend) | Vitest |

### Technical Constraints

| Constraint | Description |
| --- | --- |
| Single-user only | No multi-user collaboration or authentication; assumes one developer |
| Localhost only | No cloud hosting or remote deployment; runs on the developer's machine |
| Single WebSocket connection | One active client at a time; opening a second browser tab disconnects the first |
| File-based storage only | Specs and registry stored as files in the repo; no external database |
| No offline support | Frontend requires a live backend WebSocket connection |
| English only | No internationalization (i18n) support |
| In-memory session history (v1) | Archived agent sessions are lost on server restart; disk persistence planned for v2 |

### Non-Functional Requirements

| Requirement | Priority | Details |
| --- | --- | --- |
| Startup time | medium | Backend should start and be ready to accept connections within a few seconds |
| Graph visualization performance | medium | Spec graph renders ≤15 nodes per layer using DOM + SVG; no heavy graph library |
| Data integrity | high | Registry writes are atomic (write to temp file, then rename) to prevent corruption |
| Security | medium | No authentication — relies on localhost-only access. API key management for AI agents is an open design question. |
| Reliability | medium | File watcher detects changes from any source (user, agent, external tool); task state machine prevents invalid transitions |

### Notes

- The project dashboard is not a separate view — project health and coverage information is integrated into the spec hierarchy & graph visualization.
- Specs are stored as files in the project repository, not in a separate database. This keeps specs versioned alongside code.
