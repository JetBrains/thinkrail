# Delegation and orchestration in ThinkRail

> Exploratory product research, not a normative specification. The canonical product and architecture decisions remain in the spec graph.

## Purpose

This report maps possible product uses for ThinkRail's delegation core and subagents. It is intended to help choose prototypes, shape a future orchestration layer, and assess collaboration with [ytdb-slate](https://github.com/JetBrains/ytdb-slate).

## Starting point

ThinkRail already has three strong foundations:

- **Delegation:** in-process child sessions with roles, bounded concurrency, lifecycle events, cancellation, usage reporting, and persisted transcripts.
- **Intent and work:** a durable spec graph plus a chat-scoped TODO plan that records the current working commitment.
- **Evidence and review:** TODO-attributed commits, revision history, reviewed-SHA watermarks, anchored findings, reviewer chats, independent reflection, and bounded fix/re-review cycles.

The missing layer is not another subagent implementation. It is a product-level orchestrator above delegation, with clear human gates and views that explain what ran, why it ran, what it knew, what it produced, and what remains unsettled. The canonical roadmap places a workflow runtime in V2; the ideas below are research directions and prototypes, not current capabilities or V1 commitments.

## Orchestration models

### LLM supervisor

The parent session chooses specialists turn by turn and synthesizes their results. This is ThinkRail's current model and should remain the default for ordinary work. Parent sessions, plans, and transcripts persist, but the live child registry, detached runs, and any implicit workflow frontier do not recover after a host restart.

### Skill composer

A composer chooses a pipeline of reusable stages—research, design, implementation, verification, review—and adjusts it as findings arrive. Its frontier can live in the temporary task-spec while the spec graph remains the durable record.

This is the best immediate step because it fits ThinkRail's current workflow system without adding a second runtime.

### Scripted workflows

A small script owns phases, fan-out, joins, loops, and intermediate results while agents perform the actual work. This is the model behind [Claude Code dynamic workflows](https://code.claude.com/docs/en/workflows).

This is the recommended product direction after the composer. It makes orchestration inspectable and repeatable without forcing every task into a durable DAG. A run can expose progress, pause, stop, retry, approval, and cost controls while continuing to use the delegation core for execution.

### Durable workflow graph

Frameworks such as [LangGraph](https://docs.langchain.com/oss/python/langgraph/graph-api), [Google ADK](https://adk.dev/graphs/), [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/), and [Temporal](https://docs.temporal.io/workflow-execution) provide different combinations of graphs, checkpoints, retries, human gates, and durable execution.

This model becomes valuable for unattended automation, long human waits, and process-loss recovery. Durable replay also introduces idempotency requirements, so it should remain an outer layer built only when real workflows justify it.

### Agent teams

Long-lived peers share tasks and communicate directly under a lead, as in the experimental [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams). Teams are useful for competing hypotheses, independent modules, and multi-perspective research, but current implementations carry resumption and coordination limitations. They are expensive and risky when agents edit the same worktree, so they should follow isolated workspace support rather than lead the roadmap.

### Thread weaving

Thread weaving gives each bounded action a fresh worker session and normally one durable episode as the synchronization boundary. It preserves an adaptive supervisor loop while making compaction deliberate; Slate's implementation is described below.

## Recommended product model

Keep these authorities separate but linked:

1. **Spec graph:** what should remain true—requirements, boundaries, contracts, and decisions.
2. **Task-spec pipeline:** the temporary strategy for one change.
3. **TODO plan:** the current conversation's working commitment.
4. **Workflow run:** what can run next, what is blocked, and where human approval is required.
5. **Session lineage:** which session created each child.
6. **Evidence:** commits, checks, findings, review decisions, and delivered artifacts.

The delegation core should remain a session fabric. Workflow dependencies, joins, retries, budgets, and recovery belong above it. The TODO plan should not become a workflow DAG, and session lineage should not be presented as execution order.

## Specifications without rigidity

The criticism that spec-driven development becomes rigid is valid when specifications turn into deeply decomposed tactical plans. ThinkRail should instead treat specs as durable constraints and decisions, while orchestration remains adaptive.

A useful new concept is **specification tension**. When implementation evidence contradicts a spec, the agent raises a visible conflict rather than blindly following either side. The affected branch pauses while the user chooses to uphold the spec, revise it, change scope, or record the limitation in the spec. Work must not proceed with an active canonical spec that contradicts the accepted implementation.

This addresses the main failure modes of rigid specification workflows:

- decomposition can change after every finding;
- code/spec disagreement becomes an explicit gate;
- commits and review evidence show which parts of a spec were implemented or challenged;
- children receive only the relevant spec neighborhood instead of the whole strategic context;
- transcripts and structured handoffs reduce dependence on emergency compaction.

## ytdb-slate

Slate implements **thread weaving** as an artifact-mediated loop; its own thread graph is single-depth:

1. The user's main pi session is the orchestrator.
2. Each dispatch creates a fresh worker session for exactly one bounded action. Workers cannot create Slate threads, although whitelisted extensions may offer other delegation tools.
3. Terminal work normally yields one durable **episode** recording intent, actions, findings, changed artifacts, open issues, and handoff notes. Successful work and failed partial work are compressed from the transcript; a no-response failure gets a fixed episode, while cancellation or preflight rejection produces none. The full worker transcript remains separate.
4. A later worker starts fresh and can receive selected earlier episodes by identifier. It inherits their conclusions without inheriting their full conversations.

The episode—not an ongoing conversation with the worker—is the synchronization primitive. After each episode, the orchestrator chooses the next action from the new evidence rather than following a fixed task tree. Independent actions can run concurrently, then return separate episodes for synthesis. This gives Slate predictable compaction boundaries and adaptive strategy while keeping tactical work out of the orchestrator's context.

Around this loop, Slate adds a track-based development doctrine, review roles, context budgets and handoffs, model routing, and failover. This assessment uses repository `main` at [`b3a3f7b`](https://github.com/JetBrains/ytdb-slate/tree/b3a3f7bae83b13f623f1de0dc1949b19050efc7f); its [design principles](https://github.com/JetBrains/ytdb-slate/blob/b3a3f7bae83b13f623f1de0dc1949b19050efc7f/docs/design-principles.md) are the best description of the shipped model.

Open issues propose capabilities not present at that revision: [semantic review units and inline discussion](https://github.com/JetBrains/ytdb-slate/issues/256), [knowledge pumping](https://github.com/JetBrains/ytdb-slate/issues/249), [cache-stable prefixes](https://github.com/JetBrains/ytdb-slate/issues/190), and [parallel worktree tracks](https://github.com/JetBrains/ytdb-slate/issues/232).

### Collaboration fit

ThinkRail could support thread weaving as a policy above its delegation core: create a fresh child for one action, retain its transcript, derive one episode, end the child, and pass selected episode references into later actions. This preserves ThinkRail's reusable session fabric while making Slate compatibility a matter of shared run and episode records rather than two competing delegation authorities.

The strongest collaboration surfaces are therefore portable episodes with transcript provenance, inspectable context packs, a shared review-story format, and a first-party ThinkRail renderer for Slate's tools.

## Product views

These should be different projections over the same authorities, not separate stores.

### Conversation timeline

Show agent fan-out, active work, questions, evidence, and review blockers in the chat where they occurred. This is the natural default for interactive work and mobile.

### Mission control

Evolve the Plan page into a board for Ready, Active, Review, and Landed work. Each item links to its specs, delegated agents, commits, verification, and findings. Dependencies appear as blocker information rather than a graph canvas.

### Execution graph

Show workflow steps, joins, gates, attempts, context flow, and produced evidence. Keep execution, session lineage, provenance, and specs as switchable lenses to avoid a universal "graph of everything." This view is most useful for debugging and unattended workflows.

### Review Story

Present a change as flow-ordered semantic units rather than file order alone. Each unit keeps its diff visible and combines captured intent, related specs, evidence, findings, reflection, and human discussion. A read-only research agent can investigate a unit without being allowed to edit it.

This is the strongest candidate for a differentiating feature because ThinkRail already owns most of the difficult foundations. Slate's semantic analysis and intent-capture proposals could complete the experience.

## Suggested experiments

1. **Delegation Run Center:** surface existing children, transcripts, usage, failures, cancellation, and steering.
2. **Adaptive composer:** run one real workflow through staged skills and existing subagents.
3. **Scripted workflow prototype:** add inspectable phases, fan-out, bounded loops, approval, and progress above delegation.
4. **Context-pack evaluation:** compare fresh workers with workers given relevant specs, source ranges, and episodes; measure quality, turns, list misses, latency, and total cost.
5. **Review Story slice:** for one language, combine captured intent, semantic units, existing anchored findings, and read-only research.
6. **Slate exchange:** share the review record before attempting deeper runtime integration.
7. **Durability and parallel writers:** add them only after restart recovery or isolated concurrent implementation becomes a demonstrated requirement.
