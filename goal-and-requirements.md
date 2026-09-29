---
id: goal-and-requirements
type: goal-and-requirements
status: active
title: ThinkRail — product goal and scope
covers: [product-goal, product-audience, product-principles, product-capabilities, product-non-goals, engine-decision]
tags: [product, scope]
---

## Goal

ThinkRail is a desktop-and-mobile client for the `pi` coding agent: a thin host that runs `pi` and
bridges it to a rich UI, so agent work is approachable without a terminal and stays isolated,
reviewable, and grounded in specs — building with agents without losing control.

This document describes the product as it is and why it exists, and changes with it: a capability that
lands is added here, a decision that changes is rewritten here. It holds no versions or roadmap.

## Problem

`pi` is a deliberately minimal, extensible harness. That flexibility costs time: newcomers spend long
learning to drive it, and experienced users still find the terminal clumsy for the work around the agent.

- **Parallel agents collide** in one working tree — with each other and with the user's own edits.
- **Agent changes are hard to review** from a CLI: reading diffs, commenting on exact lines, and
  handing that feedback back to the agent.
- **Intent evaporates.** Decisions made in a chat end with the session; the next one re-derives or
  contradicts them.

## Who it's for

People who build with `pi` on real git repositories — newcomers who want a visual on-ramp, experienced
users who want an IDE around the agent without giving up pi's depth, and agent-first builders who want
to move fast without losing control of what the agent did.

## Value

- **Isolation by default.** A workspace ThinkRail creates is a git worktree with its own branch and cwd:
  agents run in parallel and the main branch stays clean until the user merges. Working directly in the
  project folder (the Default workspace) is an explicit choice, never the default.
- **A real IDE around the agent.** Editor, diffs, terminals, and review in one workbench, so the user
  sees and steers the agent's work instead of reconstructing it from a scrollback.
- **Specs as ground truth.** The project's intent lives in a spec graph beside the code that the agent
  reads, searches, and maintains, so intent survives the session.
- **All of pi, nothing hidden.** Models, skills, extensions, and session state stay pi's; ThinkRail adds
  a surface, not a second agent.

## Principles

Durable decisions every feature follows; [[architecture]] carries the structure that enforces them.

- **pi is the only engine**, run in-process — no second runtime (no `claude-agent-sdk`). `pi` owns the
  model registry, system prompt, skills/extensions, compaction, cost, and session state.
- **Influence by feeding, never by assembling.** Features shape the agent only through what they feed
  `pi` — prompt context, files, pi's own skills/extensions — and the flags a session starts with.
- **Expose, don't recompute.** The host shows what `pi` reports rather than deriving its own copy.
- **The user's own tools and credentials.** Git, GitHub, and model access go through the user's `git`,
  `gh`, `central` CLI, and pi's provider auth; ThinkRail keeps no accounts or tokens of its own.
- **Trust is explicit.** What a cloned repository could inject into the agent — its committed skill
  aliases — loads only after a per-project trust grant.
- **Spec-first.** ThinkRail is built spec-first and helps the projects it opens work the same way.

## Capabilities

What ThinkRail does, at product level; the linked spec owns the detail.

- **Two launchers, one app** — a native desktop app and the `thinkrail` CLI that opens the same UI in a
  browser, both embedding the same host; state lives under `~/.thinkrail` ([[module-desktop]],
  [[module-cli]]).
- **Projects → workspaces** — a git repo is a project; a workspace is a git worktree, plus the built-in
  Default workspace (the project folder itself) and existing worktrees attached in place
  ([[submodule-server-workspaces]]).
- **Workbench** — a splittable layout of files, diffs, documents, chats, and terminals with movable side
  and bottom tool panels, kept local to each window ([[submodule-web-shell-layout]]).
- **Chats** — concurrent `pi` sessions per workspace, each with its own model, pi-reported token/cost,
  steering and follow-ups mid-run, skill and prompt-template autocomplete, and history search
  ([[submodule-web-chat]], [[submodule-server-agent]]).
- **Existing skills reused** — portable Agent Skills kept for other coding agents are read in place;
  `pi` stays the parser and runtime ([[submodule-server-agent]]).
- **Plans with per-step review** — a shared TODO plan the agent works and the user edits; a completed step
  is committed on its own when its changes are provably its own, and can be reviewed by an independent
  reviewer ([[module-pi-todos]], [[submodule-server-todos]],
  [[submodule-server-host-plan-review]]).
- **Subagents** — delegation to isolated child sessions, in the foreground, in parallel, or in the
  background ([[module-pi-subagents]]).
- **Review** — anchored comments on files and diffs, collected without starting the agent and sent as
  structured context to chats that can resolve them; local review, not a forge integration
  ([[submodule-server-reviews]]).
- **Open PR** — push the workspace branch and open or update its GitHub PR through the user's `gh`,
  falling back to a prefilled compare URL ([[submodule-server-pr]]).
- **Specs** — the agent searches, navigates, and maintains the spec graph through `spec_*` tools; the
  read-only Specs tool renders it as a tree ([[module-spec-graph]], [[submodule-server-spec]]).
- **Workflows** — bundled workflow skills for project setup, design brainstorming, and shipping a PR
  ([[module-thinkrail-workflow]]).
- **Providers** — in-app sign-in and API keys through pi's auth, and JetBrains AI through the user's
  `central` CLI ([[submodule-server-auth]], [[central-integration]]).
- **Agent tools** — web research and inline diagrams and comparisons in chat
  ([[submodule-web-chat-tools-web]], [[pi-visualize-module]]).
- **Around the workspace** — open a worktree in an installed editor or IDE, and keep the app itself up
  to date ([[submodule-server-editors]], [[submodule-web-updates]]).
- **Brand** — ThinkRail green accent (bright on dark themes, deepened on light ones so it clears AA on
  both), a Darcula-family dark background, Orbitron for the brand display role, Geist and JetBrains Mono
  for UI and code ([[submodule-web-themes]], [[web-typography]]).

## Non-goals

Only these are excluded by decision. Anything neither listed above nor excluded here is open, not
forbidden.

- **A second agent runtime**, or any host-side agent loop or prompt assembly (see Principles).
- **ThinkRail accounts or a login UI.** Who may reach a host is decided by the network — Tailscale ACLs
  and device identity ([[architecture]]).
