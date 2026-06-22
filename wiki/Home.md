# ThinkRail

**Specification-driven development for AI coding agents.** ThinkRail keeps a hierarchical, interconnected set of **specs** in your repo alongside the code and uses them to align AI agents with your intent. You grow software one **ticket** at a time — each ticket writes down *what* the change should do and *how* before any code is generated, so the agent builds what you actually meant.

> ThinkRail is a JetBrains incubator project. It runs locally and drives Claude Code under the hood.

## Getting started

1. **Install & launch.** Follow the [installation steps in the README](https://github.com/JetBrains/thinkrail#quick-start), then run `thinkrail`. (ThinkRail drives Claude Code, so make sure Claude Code is authenticated.)
2. **Open a project.** On the start screen, either **start a new project** — ThinkRail interviews you to produce a Goal & Requirements doc — or **open an existing project**, and it investigates the code with you.
3. **Create your first ticket** from the Board and let ThinkRail walk it through design → plan → implementation.

→ See **[Working with Tickets](Working-with-Tickets)** for the full walkthrough.

## How it works

ThinkRail turns intent into code through a short, reviewable loop:

1. You describe a change as a **ticket**.
2. ThinkRail captures your **product and technical decisions** as design docs.
3. It **updates your project's specs** to match, and flags contradictions.
4. It produces an **implementation plan**, then **implements** it — with you reviewing at each step.

Because the thinking is written down and checked before code is written, you catch problems early and keep the agent on-intent.

## Key concepts

- **Project** — the codebase you're working in. ThinkRail keeps its specs and ticket data under `.tr/` in the repo.
- **Specs** — the living design docs (goal & requirements, architecture, module and submodule designs) that describe the system. They're the source of truth agents read from and update.
- **Ticket** — one unit of change, taken from idea to shipped code through a pipeline of stages.
- **Board & Workspace** — the **Board** is the Kanban of tickets; the **Workspace** is where you drive the agent sessions, browse specs, and view files.

## Pages

- **[Working with Tickets](Working-with-Tickets)** — creating tickets, the orchestrator, choosing a pipeline, running stages, artifacts, and current limitations.
