---
id: goal-and-requirements
type: goal-and-requirements
status: active
title: ThinkRail — product goal and scope
covers: [product-goal, v1-scope, v2-scope, engine-decision]
tags: [product, scope]
---

## Goal

ThinkRail is a ThinkRail-branded desktop-and-mobile client for the `pi` coding agent. The product
is a thin host that bridges `pi` to a rich UI and, over time, layers spec-driven workflows on top.

## Engine

PI agent only. No second runtime (no `claude-agent-sdk`), in V1 or V2. `pi` owns the model registry,
system prompt, skills/extensions, compaction, and cost. Every feature influences the agent by what we
**feed** `pi` — prompt context, files, `pi`'s own skills/extensions — and which flags we spawn it
with, never by assembling the prompt ourselves.

## V1 — Worktree IDE + cheap wins

A ThinkRail git-worktree IDE shipped through two additive local launchers: a native Electrobun desktop
app and the retained CLI that opens the browser UI. Both embed the same host and serve the same client;
the shell is built first, `pi` connected last:

- **Projects → workspaces**: open a git repo as a project; a workspace is a `git worktree` (own branch +
  cwd) under `~/.thinkrail/worktrees` — plus one built-in, non-removable **Default workspace** per
  project (the project folder itself), offered as an explicit choice on the project's Welcome so
  newcomers aren't lost in the worktree model, and any **existing worktree** the user attaches in place
  from the project menu (ThinkRail uses its cwd, never touches its checkout).
- **Desktop workbench**: a recursively splittable center for files, diffs, registered documents, chats, and terminals,
  bounded to four visible groups; Projects / Specs / Files / Changes / Review and terminals may occupy
  movable auxiliary groups—vertical stacks at left/right and a horizontally grouped, alignable bottom panel.
  New workspaces place one terminal in that bottom panel by default. Each frontend window owns one locally
  persisted, resource-free frame—topology, tool placement, visibility, and geometry—reused across all of its
  opened workspaces. Open resources, previews, selection, and focus remain local per workspace and window;
  current layout never synchronizes through the host. Only custom layout presets are shared across clients.
- A workspace-local **Review** surface for the current worktree: GitHub-style anchored file/diff drafts
  are collected without starting the agent, then sent as structured context into per-file `pi` chats;
  sent records persist and the agent can resolve them. This is local review, not PR-provider integration.
- A plan-header **Open PR** action (`task-open-pr`, deterministic host-side — never agent-routed):
  pushes the workspace branch and opens or updates its GitHub PR through the user's own `gh` CLI (no
  stored tokens, no provider REST API), with the PR body rendered from the verified plan; falls back to
  a prefilled compare URL when `gh` is missing or the forge isn't GitHub. Re-press pushes updates to the
  SAME PR, never a second one. CI/Checks status, merge/squash from the app, and `glab` support are not
  part of this slice. See `packages/server/src/pr`.
- Cheap wins `pi` already emits: per-session model pick (#1), token/cost display (#3), and skill
  catalog/autocomplete (#2), including read-through reuse of portable Agent Skills a user already keeps
  for major coding agents — Pi remains the parser/runtime; no copying or vendor-semantic emulation. A
  repo's **committed** skill aliases load only after an explicit **per-project trust** grant (a clone's are
  attacker-controlled); personal + bundled skills load regardless.
- Multiple chat sessions per workspace, streaming concurrently (#5).
- A bundled **spec-graph** pi extension (`pi-spec-graph`): the agent searches, navigates, and manages
  the project's specs via `spec_*` tools + a skill.
- A read-only **Specs** side tool: the active worktree's spec-graph rendered as its `parent` tree, backed
  by the same `pi-spec-graph` core model host-side;
  opening a node opens the spec file as an editor tab. Viewer only — no editing, drift detection, or
  graph canvas.
- ThinkRail branding: **green accent** (`#8dff4f` on the dark-family themes, `#2e7d16` on the light
  ones — inverse by appearance so it clears AA on both), Darcula background, **Orbitron** for the brand
  display role, Geist / JetBrains Mono for UI and code.
- On-disk state under `~/.thinkrail`.

V1 is explicitly **not**: the workflow **product layer** (a runtime/engine, configurable pipelines —
the skill-based workflow *system*, skills + an always-on rule with no runtime machinery, ships as the
bundled `pi-thinkrail-workflow` extension); the spec-graph **product layer** beyond the read-only viewer
(drift detection, pre-build approval, living graph — the pi-side spec capability ships as the bundled
extension above); PR/Checks automation beyond push + open/update via `gh` (CI/checks status, merge or
squash from the app, provider REST API integration, `glab` — see `packages/server/src/pr`'s Out of
scope), self-improvement, automations, per-step model routing, cost ledger.

## V2 — the product

Workflow layer (#8), spec layer (#9: pre-build approval → drift detection → living spec graph, building
on the V1 spec-graph extension), self-improvement (#4), configurable automations (#6), remote/phone over
Tailscale (#7), and deepened parallelism / cost ledger / per-step routing.
