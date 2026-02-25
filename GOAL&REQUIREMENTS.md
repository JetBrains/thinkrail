* Project\Feature name: Bonsai
* Category: new-project
* Priority: high

## Goal

Build a developer tool that introduces specification-driven development — where hierarchical, interconnected specs live in the repo alongside code — to help developers effectively control and align AI coding agents through structured project context.

## Description

Bonsai is a developer tool and web workspace for specification-driven development. It provides a Python backend API and a TypeScript/JavaScript frontend that runs on developers' machines, offering a comprehensive environment for creating, editing, and visualizing hierarchical specifications that live in the project repository alongside code. Specs are interconnected, forming a structured knowledge graph that captures project goals, architecture, module designs, and tasks.

Bonsai serves as both a spec management layer and an AI agent orchestrator. By maintaining rich, structured project context in the repo, it enables developers to align AI coding agents with clear intent, scope, and constraints — making agent-assisted development more predictable and effective. The tool can feed specs to agents, monitor their work, and track progress against the specification hierarchy.

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
| File watching | watchfiles/watchdog (registry.json, spec files) |
| Database | File-based (JSON/YAML in repo) |
| Testing (backend) | pytest |
| Testing (frontend) | Jest or Vitest |

### Notes

- The project dashboard is not a separate view — project health and coverage information is integrated into the spec hierarchy & graph visualization.
- Specs are stored as files in the project repository, not in a separate database. This keeps specs versioned alongside code.
