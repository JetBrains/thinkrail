---
id: concurrency-orchestration
type: architecture-design
status: active
title: Concurrency & Orchestration Design
parent: design-doc
depends-on:
- module-rpc
- frontend-module
references:
- module-agent
- proactive-agent-design
covers:
- backend/app/coordinator/
- backend/app/agent/
- backend/app/rpc/
- frontend/
tags:
- concurrency
- orchestration
- coordinator
- multi-session
---
# Concurrency & Orchestration — Architecture Design

> Parent: [DESIGN_DOC.md](../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-10 | Updated: 2026-03-11

## Table of Contents
1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [High-Level Design](#high-level-design)
4. [Source Tree](#source-tree)
5. [Data Flow](#data-flow)
6. [Coordinator Service](#coordinator-service)
7. [Scope Resolution](#scope-resolution)
8. [Conflict Detection & Resolution](#conflict-detection--resolution)
9. [Coordinator MCP Tools](#coordinator-mcp-tools)
10. [Worker Communication](#worker-communication)
11. [Coordinated Session Lifecycle](#coordinated-session-lifecycle)
12. [Frontend UX](#frontend-ux)
13. [Key Design Decisions](#key-design-decisions)
14. [Implementation Roadmap](#implementation-roadmap)
15. [Resolved Questions](#resolved-questions)

## Overview

This design introduces **coordinated multi-session orchestration** — enabling multiple agent sessions to work on the same project in parallel without stepping on each other's work. A lightweight **Coordinator Service** uses Bonsai's own spec hierarchy to partition file scopes between sessions, mediates access to shared files, and exposes MCP tools that let worker agents pull context updates on demand.

**Core idea:** Specs already define module boundaries via `covers` paths. Sessions inherit write scope from their assigned spec. An in-process coordinator service enforces boundaries at runtime and provides an LLM-powered query interface for ambiguous situations.

## Problem Statement

When multiple agent sessions run in parallel on the same project, they can corrupt each other's work:

```
Timeline:
  t0  Agent A reads core/config.py (v1)
  t1  Agent B reads core/config.py (v1)
  t2  Agent A writes core/config.py (v2) — adds new field
  t3  Agent B detects change, re-reads... or doesn't
  t4  Agent B writes core/config.py (v3) — overwrites A's field
      ⚠ Agent A's work is lost
```

**Failure modes:**
- **Write-Write conflict:** Two agents write the same file — last write wins, earlier work lost
- **Stale context:** Agent B's reasoning is based on an outdated version of a file Agent A changed
- **Semantic dependency:** Agent A changes a function signature that Agent B calls
- **Create conflict:** Two agents independently create the same new file
- **Delete conflict:** Agent A deletes a file Agent B is actively using

Without coordination, parallel sessions are unreliable. The user must manually ensure agents don't overlap — which defeats the purpose of parallelism.

## High-Level Design

```
                        ┌─────────────────────────┐
                        │       Developer          │
                        │  (approve / resolve)     │
                        └─────────┬───────────────┘
                                  │
                        ┌─────────▼───────────────┐
                        │       Frontend           │
                        │  Tabbed sessions +       │
                        │  overview panel          │
                        └─────────┬───────────────┘
                                  │ JSON-RPC / WebSocket
                        ┌─────────▼───────────────┐
                        │    RPC Server            │
                        │  (existing dispatch)     │
                        └─────────┬───────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                    │
    ┌─────────▼─────────┐ ┌──────▼──────┐ ┌──────────▼──────────┐
    │  Agent Service     │ │ Coordinator │ │   Agent Service      │
    │  (Worker A)        │ │  Service    │ │   (Worker B)         │
    │  scope: agent/**   │ │             │ │   scope: spec/**     │
    └─────────┬─────────┘ │  • Scopes   │ └──────────┬──────────┘
              │           │  • Locks     │            │
              │           │  • Tracker   │            │
              │           │  • LLM client│            │
              │           └──────┬──────┘            │
              │                  │                    │
              └──────────────────┼────────────────────┘
                                 │
                        ┌────────▼────────┐
                        │   Project Files  │
                        └─────────────────┘
```

**Pattern:** Spec-scoped partitioning with coordinator-mediated shared zones.

**Key principles:**
- Specs define write boundaries (`covers` → file scope per session)
- Coordinator is an **in-process service** (not an agent session itself)
- Coordinator uses a cheap LLM (Haiku-class) for ambiguous decisions
- Workers query the coordinator via MCP tools (pull model, not push)
- The existing `canUseTool` hook enforces scope at write time
- No resource limits — developer has full freedom
- Coordinator can proactively propose parallel work (integrates with `SuggestSession`)

## Source Tree

New and modified locations introduced by this design:

```
backend/app/
├── coordinator/               # NEW — Coordinator module
│   ├── service.py             # CoordinatorService: scope assignment, write auth, LLM decisions
│   ├── models.py              # ScopeInfo, LockInfo, WriteDecision, ChangeRecord
│   ├── file_tracker.py        # Per-session read/write tracking, stale detection
│   └── tools.py               # MCP tool handlers (file_changes, session_status, query, etc.)
├── agent/
│   ├── runner.py              # MODIFIED — scope check + coordinator tools in canUseTool
│   ├── context.py             # MODIFIED — inject Coordination Context section
│   └── service.py             # MODIFIED — assign/release scope on session start/end
├── rpc/
│   ├── server.py              # MODIFIED — instantiate CoordinatorService, wire watcher events
│   └── methods/
│       └── coordinator.py     # NEW — coordinator/status RPC method
frontend/src/
├── components/
│   ├── SessionPanel/          # MODIFIED — session tab bar for multi-session
│   └── ChatStream/
│       └── ConflictCard.tsx   # NEW — inline conflict resolution card
├── store/
│   └── coordinatorStore.ts    # NEW — scopes, locks, conflicts state
```

## Data Flow

### Write Authorization Path (hot path)

```
Worker Agent → canUseTool("Write", {file_path}) → Scope check
    │
    ├── In scope → allow (no network, no LLM)
    │
    └── Out of scope → CoordinatorService.authorize_write()
         │
         ├── Rules engine → allow / deny (instant)
         │
         └── LLM (Haiku) → allow / deny / escalate (~300ms)
              │
              └── Escalate → agent/conflictResolution → Frontend → User
                                                        │
                                                        └── agent/respond → resume worker
```

### Coordinator Query Path (worker-initiated)

```
Worker Agent → coordinator_file_changes(path) → CoordinatorService
    │                                                │
    │                                                ├── FileTracker lookup (instant)
    │                                                │
    │                                                └── Return: changes, staleness flag
    │
    ├── coordinator_session_status() → return active sessions (instant)
    │
    └── coordinator_query(question) → LLM call with state context (~300ms)
```

### File Watcher → Coordinator Path

```
File system change → Core Watcher → RPC server callback
    │
    └── CoordinatorService.record_external_change(path, type)
         │
         └── Update FileTracker change log
             (no push to workers — pull only)
```

## Coordinator Service

The coordinator is an in-process service instantiated alongside `AgentService`. It has no persistent LLM session; it makes stateless LLM calls with injected context only when deterministic rules can't decide.

### Responsibilities

| Responsibility | Description |
|----------------|-------------|
| **Scope management** | Assign, track, and release per-session write scopes derived from spec `covers` paths |
| **Write authorization** | Decide whether an out-of-scope write should be allowed, denied, or escalated to the user |
| **File tracking** | Record which sessions have read/written which files, detect stale reads |
| **Lock management** | Grant and release temporary exclusive locks on shared-zone files |
| **MCP tool handling** | Answer worker queries about file changes, session status, and scope requests |
| **LLM reasoning** | Make ambiguous decisions that rules can't handle (conflict severity, semantic dependencies, free-form queries) |

### Intelligence Tiers

The coordinator uses a tiered decision strategy. Start with the cloud model; iteratively
create cheaper alternatives as patterns emerge:

```
Decision request
    │
    ├── Rules engine (instant, free)
    │   Handles: in-scope writes, clear ownership, known lock states
    │   ~90% of decisions
    │
    ├── Local model (fast, free) [future]
    │   Handles: ambiguous scope overlap, semantic dependency analysis
    │   Fallback when rules are insufficient
    │
    └── Cloud model — Haiku-class (200-500ms, ~$0.001/decision)
        Handles: complex queries, task decomposition proposals,
        cross-agent semantic reasoning
        Initial implementation for ALL non-trivial decisions
```

**V1:** Cloud model (Haiku) for all non-trivial coordinator decisions. As usage patterns emerge, distill common decisions into deterministic rules.

### Coordinator LLM Context

When the coordinator needs LLM reasoning, it builds a compact context containing:
- Active sessions (IDs, scopes, statuses, task summaries)
- Recent file change log (path, agent, timestamp, change type)
- Relevant spec excerpts (covers paths, module descriptions)
- The specific question or decision to make

## Scope Resolution

### How Specs Map to File Boundaries

Each spec's frontmatter has a `covers` field — a list of path globs relative to the
project root. When a session starts with `spec_ids`, the coordinator unions their `covers`
paths into an exclusive **write scope**.

```
Example:
  Spec "module-agent" covers: ["backend/app/agent/"]
  Session starts with spec_ids: ["module-agent"]
    → write scope: ["backend/app/agent/**"]

  Write to backend/app/agent/runner.py  → in scope  → auto-allow
  Write to backend/app/core/config.py   → out of scope → ask coordinator
```

### Scope Categories

| Category | Definition | Write Policy |
|----------|-----------|--------------|
| **Exclusive scope** | Files matching session's spec `covers` globs | Auto-allow |
| **Another session's scope** | Files in a different active session's scope | Coordinator evaluates (usually deny) |
| **Shared zone** | Files not covered by any active session's spec | Coordinator mediates (lock-based) |
| **Uncovered** | Files not covered by any spec at all | Shared zone rules apply |

### Scope Assignment

When a new session starts, the coordinator:
1. Resolves `spec.covers` → glob patterns
2. Checks for overlap with existing active scopes
3. If no overlap → assigns scope
4. If overlap detected → LLM evaluates severity:
   - Minor overlap → assigns with warnings
   - Major overlap → reports conflict, informs user

## Conflict Detection & Resolution

### Write Authorization Flow

Every file write by a worker agent passes through the permission hook. The coordinator is consulted for out-of-scope writes:

```
Worker attempts to write a file
    │
    ▼
Is file within session's write scope?
    │
    ├── YES → Allow (fast path, no coordinator call)
    │         Record the write for tracking
    │
    └── NO → Ask coordinator to authorize
             │
             ├── ALLOW — No conflict (e.g., shared zone, no lock)
             │
             ├── DENY — Another agent exclusively owns this file
             │          Return explanation to agent
             │
             ├── LOCKED — Shared zone file locked by another agent
             │            Return lock holder info to agent
             │
             └── ESCALATE — Ambiguous, needs user decision
                            Show inline conflict card in chat
                            Suspend agent, await user response
```

### Conflict Types

| Conflict Type | Detection | Resolution |
|--------------|-----------|------------|
| **Write-Write** (same file) | Scope check + lock table | Deny second writer with explanation |
| **Stale context** (read then external write) | File tracker cross-references reads with writes | Worker pulls update via coordinator MCP tools |
| **Semantic dependency** | Coordinator LLM reasoning | LLM suggests re-read or scope adjustment |
| **Create conflict** (same new file) | Path check at creation time | Deny second creator |
| **Delete conflict** | Active read tracking | Deny delete if other agent has active reads |

### Shared Zone Locking

Files not covered by any active session's spec are in the **shared zone**. The coordinator manages access via temporary exclusive write locks:

- Lock acquired **implicitly** when coordinator allows a shared-zone write
- Lock released when the writing session's turn completes (status → idle)
- No explicit lock/unlock API — fully transparent to workers
- Workers never see or manage locks; the coordinator handles everything

### User Escalation

When the coordinator can't resolve a conflict automatically, it escalates to the user **inline in the affected agent's chat stream**. The coordinator LLM generates context-dependent resolution options based on the specific conflict:

```
┌─ ⚠ Scope Conflict ──────────────────────────────┐
│                                                   │
│ You want to write: backend/app/core/config.py     │
│ This file is currently locked by Agent B.         │
│                                                   │
│ Agent B's change: "Adding watcher config fields"  │
│                                                   │
│ [Wait for Agent B]  [Allow anyway]  [Pause me]   │
│                                                   │
└───────────────────────────────────────────────────┘
```

Resolution options vary by conflict type and may include:
- Wait for the other agent to finish
- Allow the write (user accepts risk)
- Pause the current agent
- View the other agent's changes first
- Open the file externally to resolve manually

## Coordinator MCP Tools

Worker agents can **actively query** the coordinator via MCP tools. This is a **pull model** — agents ask when they need context, rather than receiving push notifications.

### Structured Tools (Fast Path — Rules Engine)

These tools have well-defined schemas and can be answered without LLM reasoning:

| Tool | Purpose | Key Output |
|------|---------|------------|
| **`coordinator_file_changes`** | What changed in a file since I last read it? | List of changes (who, when, summary), staleness flag |
| **`coordinator_session_status`** | What are other agents working on? | List of sessions (scope, status, current task) |
| **`coordinator_request_scope`** | Can I safely write to this path? | Allowed/denied, reason, current owner if any |

### Flexible Tool (LLM Path — Complex Queries)

For anything the structured tools can't answer:

**`coordinator_query`** — A free-form natural language question routed to the coordinator LLM. The coordinator receives the question along with all active session scopes, the recent file change log, relevant diffs, and the worker's read history.

Example: _"Agent B changed the SpecService interface. I'm calling get_spec() in my code — did the signature change?"_ → Coordinator reads the diff, reasons about backward compatibility, and returns a concrete answer.

### Tool Routing

Coordinator tools are registered as MCP tools on the agent session (same mechanism as `bonsai_visualize`). Read-only queries (file changes, session status) are auto-allowed. Write authorization is handled transparently through the existing permission hook — agents never call a "request write" tool explicitly.

## Worker Communication

### At Session Start: System Prompt Injection

The coordinator injects a **Coordination Context** section into each worker's system prompt. This tells the agent:

- Its assigned write scope (which files it can freely modify)
- Other active agents and their scopes
- The shared zone concept and rules
- Available coordinator tools and when to use them

Workers understand their boundaries in natural language and can reason about when to query the coordinator.

### At Runtime: Permission Hook Enforcement

The existing permission hook is extended with two behaviors:

1. **Write tool interception:** When a write-class tool targets a file outside the session's scope, the coordinator is consulted before allowing or denying. This is transparent to the agent — it simply receives an allow or deny with an explanation.

2. **Read tracking:** When a read tool is invoked, the file and timestamp are recorded in the file tracker. This enables stale-read detection when another agent later modifies the same file.

### Between Turns: No Automatic Injection

The design uses a **pull-only** model for stale context. Workers are responsible for querying the coordinator when they suspect their context may be outdated. No automatic between-turn notifications are injected.

**Rationale:** Workers already have coordinator tools described in their prompt. Well-behaved agents will check for changes before modifying files they read earlier. This avoids noisy automatic injections and keeps the system simple.

## Coordinated Session Lifecycle

### Starting Parallel Work

Two entry points:

**1. User-initiated (explicit):**
The user creates multiple sessions manually, each with different specs. The coordinator auto-detects that multiple sessions are active, assigns scopes, and begins coordination.

**2. Coordinator-proposed (proactive):**
An active agent session can use the existing `SuggestSession` tool to propose spawning a parallel worker. The coordinator validates that the proposed scope doesn't conflict with existing sessions before the suggestion is shown to the user.

### Full Lifecycle

```
Phase 1: Setup
  ┌─ User or agent proposes parallel work
  ├─ Coordinator resolves scopes from spec_ids
  ├─ Coordinator checks for overlap, warns if any
  ├─ System prompt injected with coordination context
  └─ Workers launched

Phase 2: Execution
  ┌─ Workers run independently within their scopes
  ├─ In-scope writes: auto-allowed (fast path)
  ├─ Out-of-scope writes: coordinator evaluates
  ├─ Workers query coordinator tools as needed
  ├─ File tracker records all reads and writes
  └─ Shared zone writes: lock acquired transparently

Phase 3: Conflicts (if any)
  ┌─ Coordinator detects conflict at write time
  ├─ If resolvable: auto-resolve (deny/redirect with explanation)
  ├─ If ambiguous: escalate to user inline in chat stream
  └─ User resolves, affected worker resumes

Phase 4: Completion
  ┌─ Workers complete independently
  ├─ Coordinator releases scopes and locks
  ├─ File tracker data retained for session history
  └─ Overview panel shows completion summary
```

### Coordination States

The existing session state machine is unchanged. The coordinator adds an orthogonal overlay:

| State | Meaning |
|-------|---------|
| **uncoordinated** | No coordinator involvement (single session — fully backward-compatible) |
| **coordinated** | Session has assigned scope, coordinator enforcing boundaries |
| **paused** | Session paused by coordinator or user due to unresolved conflict |

Single-session usage is completely unaffected — the coordinator only activates when multiple sessions run concurrently.

### Persistence

Coordinator state is **in-memory only** — it exists while coordinated sessions are active and is discarded when they all end. Session metadata is extended with optional coordination fields (assigned scope, coordinated-with list) for session history.

## Frontend UX

### Tabbed Sessions + Overview Panel

Each session gets a tab (like browser tabs). An **overview panel** shows all sessions' coordination state at a glance:

```
┌────────────────────────────────────────────────────────┐
│ [● Agent A] [● Agent B] [○ Agent C (idle)] [+]        │
├──────────────────────────────────────────┬─────────────┤
│                                          │  Overview   │
│  Agent A — backend/app/agent/**          │             │
│                                          │  Sessions:  │
│  [chat stream with tool calls,           │  A: running │
│   inline conflict cards,                 │  B: running │
│   coordinator messages...]               │  C: idle    │
│                                          │             │
│                                          │  Scopes:    │
│  > I need to modify core/config.py...    │  A: agent/  │
│                                          │  B: spec/   │
│  ┌─ Coordinator ────────────────┐        │  C: rpc/    │
│  │ This file is in the shared   │        │             │
│  │ zone. No conflicts detected. │        │  Conflicts: │
│  │ Proceeding with write.       │        │  0 active   │
│  └──────────────────────────────┘        │             │
├──────────────────────────────────────────┴─────────────┤
│  [message input]                              [Send]   │
└────────────────────────────────────────────────────────┘
```

### Inline Conflict Resolution

Conflicts appear as special cards in the affected agent's chat stream. Resolution options are context-dependent — generated by the coordinator LLM based on the specific conflict type, agent states, and files involved.

### Overview Panel

A compact side panel showing coordination state at a glance:
- Active session count, names, and statuses
- Scope assignments (which agent owns what)
- Active conflict count
- Write counts per session and shared zone
- Stale read warnings (files that changed since an agent last read them)

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Conflict prevention strategy | Spec-scoped partitioning + coordinator | Bonsai's specs already define module boundaries via `covers`. Natural fit — specs are the coordination mechanism. |
| Coordinator implementation | In-process service, not an agent session | Simpler, cheaper, no LLM session overhead. Service makes stateless LLM calls only when rules can't decide. |
| Coordinator intelligence | Cloud model (Haiku) first → rules → local model | Start with the most capable option, learn what decisions get made, then distill common patterns into cheaper tiers. |
| Stale context handling | Pull-only via MCP tools | Agents actively query coordinator when they suspect stale context. No noisy push notifications. Clean, agent-driven model. |
| MCP tools | Structured (fast) + flexible `coordinator_query` (LLM) | Structured tools for common queries (instant, rules-based). Flexible tool for complex reasoning (LLM call). Best of both worlds. |
| Scope enforcement | Soft scope + coordinator approval | In-scope writes auto-allowed (fast). Out-of-scope writes go through coordinator. Not rigid — allows legitimate cross-cutting work when safe. |
| Shared zone policy | Coordinator-mediated with temporary locks | Files not covered by any spec are a shared zone. First-writer gets a turn-scoped lock. Coordinator mediates concurrent access. |
| Conflict resolution UX | Inline in chat stream, context-dependent options | Conflicts appear in the affected agent's chat. Resolution options generated by coordinator LLM based on specific conflict. Less disruptive than modal dialogs. |
| Resource limits | None | Developer has full freedom. No session caps, no cost caps. Coordinator manages scopes and conflicts only. |
| Parallel work trigger | Both explicit (user) and proactive (via SuggestSession) | User can manually start parallel sessions. Agents can also propose parallel work via existing proactive tool pattern. |
| Backward compatibility | Coordinator activates only with concurrent sessions | Single-session usage is completely unaffected. Coordinator overhead is zero when not needed. |
| Scope granularity | Both directory-level and file-level globs | Matches existing `covers` format in spec frontmatter. No need to restrict — same matching logic for both. |
| Lock lifetime | Turn-scoped only (no timeout) | Released when holding session's turn ends (status → idle). Crash recovery via disconnect detection. Simple and predictable. |
| Cross-session dependencies | No auto-detection — workers ask when needed | Workers use `coordinator_query` tool to check for changes. No import graph analysis. Keep it simple. |
| Session handoff | No explicit protocol — stale-context tools suffice | Workers pull updates via `coordinator_file_changes`. No special handoff notification needed. |
| Testing approach | Mock LLM + test rules directly | Rules engine tested with deterministic inputs. LLM mocked with canned responses. Integration tests verify routing. |

## Implementation Roadmap

### Phase 1: Core Coordinator (Foundation)

Coordinator service with scope assignment/release, file tracking, write authorization via
the permission hook, system prompt injection with coordination context, and Haiku LLM
for non-trivial decisions.

### Phase 2: MCP Tools

Structured tools (`coordinator_file_changes`, `coordinator_session_status`,
`coordinator_request_scope`) and the flexible `coordinator_query` LLM tool.
Tool registration and routing through the existing MCP mechanism.

### Phase 3: Conflict Resolution UX

Inline conflict cards in chat stream with context-dependent resolution options.
New server → client request type for conflict escalation. User response handling
via the existing Future mechanism.

### Phase 4: Frontend

Tabbed session view, overview panel (scopes, statuses, conflicts), inline conflict
card rendering, and coordinator status display.

### Phase 5: Intelligence Optimization

Analyze coordinator LLM call patterns, extract common decisions into deterministic
rules, evaluate local model for medium-complexity decisions, measure cost savings.

## Resolved Questions

1. ~~**Scope granularity:**~~ **Resolved** — Both directory-level and file-level globs are supported. This matches the existing `covers` field format in spec frontmatter, which already contains both directory paths (`"backend/app/agent/"`) and file paths (`"backend/app/agent/runner.py"`). The scope matching logic handles both consistently.

2. ~~**Lock timeout:**~~ **Resolved** — Turn-scoped only. Shared-zone locks are released when the holding session's turn ends (status → idle). Simple, predictable, no configuration needed. If a session crashes, the coordinator detects the disconnection and releases its locks. No timeout mechanism needed.

3. ~~**Cross-session dependencies:**~~ **Resolved** — No auto-detection. Workers use `coordinator_query` or `coordinator_file_changes` tools to ask about dependencies when they suspect them. The coordinator does not try to infer import graphs or analyze semantic dependencies automatically. Keep it simple — agents are responsible for checking what they need.

4. ~~**Session handoff:**~~ **Resolved** — No explicit handoff protocol. Stale-context tools (`coordinator_file_changes`) are sufficient. Agent B uses `coordinator_file_changes` to pull updates about files it cares about. Workers are responsible for checking what changed. No special handoff notification or protocol needed.

5. ~~**Testing strategy:**~~ **Resolved** — Mock LLM + test rules directly. Unit tests mock the LLM client with canned responses. The rules engine is tested independently with deterministic inputs. Integration tests verify the rules → LLM → escalate routing by mocking the LLM layer and asserting the correct decision path is taken for each conflict type.
