---
id: goal-and-requirements
type: goal-and-requirements
status: active
title: ThinkRail-PI — product goal and scope
covers: [product-goal, v1-scope, v2-scope, engine-decision]
tags: [product, scope]
---

## Goal

ThinkRail-PI is a ThinkRail-branded desktop-and-mobile client for the `pi` coding agent. The product
is a thin host that bridges `pi` to a rich UI and, over time, layers spec-driven workflows on top.

## Engine

PI agent only. No second runtime (no `claude-agent-sdk`), in V1 or V2. `pi` owns the model registry,
system prompt, skills/extensions, compaction, and cost. Every feature influences the agent by what we
**feed** `pi` — prompt context, files, `pi`'s own skills/extensions — and which flags we spawn it
with, never by assembling the prompt ourselves.

## V1 — Worktree IDE + cheap wins

A ThinkRail, git-worktree IDE, driven by a CLI you run that opens a browser UI.
The shell is built first, `pi` connected last:

- **Projects → workspaces**: open a git repo as a project; a workspace is a `git worktree` (own branch +
  cwd) under `~/.thinkrail-pi/worktrees`.
- **Center**: a tabbed area — Monaco file tabs + (once `pi` lands) chat tabs.
- **Right**: an All-files tree of the active worktree + a Changes (git diff) tab; terminals below,
  scoped to the worktree.
- Cheap wins `pi` already emits: per-session model pick (#1), token/cost display (#3), skill catalog (#2).
- Multiple chat sessions per workspace, streaming concurrently (#5).
- A bundled **spec-graph** pi extension (`pi-spec-graph`): the agent searches, navigates, and manages
  the project's specs via `spec_*` tools + a skill (no UI).
- ThinkRail branding (violet `#8C81FF`, Darcula background, Geist / JetBrains Mono / Cabinet Grotesk).
- On-disk state under `~/.thinkrail-pi`.

V1 is explicitly **not**: workflows; the spec-graph **product layer** (viewer, drift detection, pre-build
approval, living graph — the pi-side spec capability ships as the bundled extension above); PR / Checks /
Review, self-improvement, automations, per-step model routing, cost ledger.

## V2 — the product

Workflow layer (#8), spec layer (#9: pre-build approval → drift detection → living spec graph, building
on the V1 spec-graph extension), self-improvement (#4), configurable automations (#6), remote/phone over
Tailscale (#7), and deepened parallelism / cost ledger / per-step routing.
