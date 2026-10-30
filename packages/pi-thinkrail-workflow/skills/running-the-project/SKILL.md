---
name: running-the-project
description: "Use when the user asks to set up, learn, or fix how this project is prepared and run (the Run button's recipe), or when a run target failed and the user wants it working again. Not for running ad-hoc commands, and not for CI failures (those belong to shipping-a-pr)."
---

# Running the Project

A worker reached directly: ThinkRail's **Set up run** and **Fix with agent** buttons seed
`/skill:running-the-project …`, and a user may ask in chat. It produces one durable artifact — the
project's run recipe, stored by the host on this machine through the `run_project` tool — and leaves
the project runnable from the Run button in every workspace. No spec is written: the recipe is
machine-local by decision, and the agent's caveats go in its `notes`.

Two branches share the contract and the verification rule below: **Set up** (no recipe, or the user
wants it relearned) and **Fix** (a target exited badly or the user asked for help with a live one).

## Contract first

1. Call `run_project` with `action: "recipe"`. Its answer is the contract: commands are POSIX `sh`
   run by `/bin/sh` from the worktree root with the host's login-shell environment; `ports` declares
   env variable names (`PORT`, `API_PORT`, …) with the project's natural ports, and the host leases a
   stable port per workspace for each — the recipe must make the project *read* those variables,
   never hardcode a port; `prepare` runs before every start and must be idempotent; a `serve` target
   declares the `ports` it binds and a `url`; a `task` target exits. The host also exports
   `THINKRAIL_RUN_DEFAULT_WORKTREE` (the project folder — in the Default workspace it is the cwd
   itself), `THINKRAIL_RUN_WORKSPACE`, `THINKRAIL_RUN_TARGET` and `THINKRAIL_RUN_ID`.
2. Write the recipe only with `run_project set_recipe`; never edit `run.json` or any file under
   `~/.thinkrail` by hand.

## Set up

1. **Look before asking.** Read the manifests and scripts (`package.json`, `Makefile`, `pyproject`,
   `Cargo.toml`, `go.mod`, compose files, `Procfile`, `.env.example`, CI workflows, the README's
   run section). Note every way the project is started, built and tested, which ports it binds and
   how each is configured, what a fresh checkout needs (install, env files, migrations, generated
   code), and whether a database or a container must already be running.
3. **Interview per the asking-user-questions skill** — only what the repository cannot tell: which
   target counts as "running" the project (the primary), which others matter, where secrets and env
   files live (ask for *locations*, never for values; a recipe copies files, it never contains a
   secret), and whether the server must be reachable from another machine (then it needs a bind flag
   such as `--host`, because a loopback-only server is unreachable through the host's address).
4. **Write a draft recipe first**, then try it: `run_project run` each `task` target with
   `wait: "exit"` and each `serve` target with `wait: "listening"`, in this workspace, so the trial
   uses the exact ports and environment the user will get. Fix the recipe until prepare is
   idempotent (a second run changes nothing), every target starts, and the port variables are
   honoured. Stop a serve target you started unless the user asked to keep it running.
5. **Finalise** with `set_recipe`: the primary target, honest `title`s, and `notes` for every
   caveat (shared database, container must be up, first install takes minutes). Report in one short
   paragraph what runs how, and what the user still has to provide.

## Fix

1. Read `run_project output` for the execution named in the request (its `runId`) and `run_project
   recipe`; `status` tells whether the target is still live.
2. Decide whether the project is broken (a code change, a missing dependency, a stale generated
   file) or the recipe is (a renamed script, a moved directory, a port the project no longer reads).
   Fix whichever it is — the project in its files, the recipe through `set_recipe`. Never route
   around a failing prepare step by deleting it; make it idempotent instead.
3. Verify through `run_project run` with the matching `wait`, then report the cause and the fix.

## Degradation

- `ask_user_question` unavailable: state the assumptions you make (primary target, where env files
  live) in the recipe's `notes` and in your report; keep going.
- The project's *Let the agent run targets* setting is off (`RUN_AGENT_FORBIDDEN`): write the
  recipe, then ask the user to press Run and paste or describe what happened — do not bypass the
  setting with `bash` or `background_command`.
- A Windows host (`RUN_UNSUPPORTED_PLATFORM`): explain that project runs are not available there
  yet and stop; do not write a recipe the host cannot execute.
- Something the recipe cannot express (a GUI app, a simulator): record the manual step in `notes`
  and keep the targets that can run.

## Red flags — stop

- A port written as a literal into a command instead of read from a declared variable.
- A secret value anywhere in the recipe, or an `.env` copied from somewhere other than
  `$THINKRAIL_RUN_DEFAULT_WORKTREE`.
- A recipe saved without a trial run in this workspace.
- Prepare that is not safe to run twice.

## Ending

This worker ends in a terminal state: the recipe is saved and verified (or, in Fix, the target runs
again), and the one-paragraph report is delivered. Nothing routes onward.
