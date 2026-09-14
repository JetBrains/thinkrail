---
id: module-pi-background-commands
type: module-design
status: draft
title: pi-background-commands — explicit, session-owned background commands
parent: architecture
tags: [pi-extension, background-commands]
---

## Responsibility

An explicit background-command capability for Pi: start a noninteractive command without holding
the agent turn, inspect its recent output, and stop that exact command. Ordinary `bash` is unchanged.
The user-approved scope is log-only commands; no PTY, terminal tabs, automatic handoff, stdin,
restart/rerun, daemon discovery, or arbitrary-process management.

This is a draft design; the package is not implemented yet.

## Boundary

- **Owns:** one session-bound command service, its opaque command identities, admission, runtime
  snapshots, bounded output, cancellation and completion-delivery bookkeeping; the
  `background_command` Pi tool and a default vanilla-Pi extension entry.
- **Public surface:** `createBackgroundCommands`, `createBackgroundCommandsExtension`, their
  service/handle/binding/snapshot/output types, and the default extension. A service exposes
  start/list/find/change-subscription/dispose; a command handle exposes its snapshot, output and
  idempotent stop. Controllers and subprocess details stay private. The root `index.ts` is the
  only import surface; `src/` is private implementation.
- **Allowed deps:** public package-root Pi SDK APIs and `typebox` as peers; Node standard libraries.
  Execution delegates to Pi's exported `createLocalBashOperations`, not a copied spawn runner.
- **Forbidden:** ThinkRail packages, web/TUI widget ownership, Pi private imports, delegation
  ownership, workspace PTYs, and generic resource-provider/plugin machinery. Wire DTOs are mirrored
  in contracts, never imported from or re-exported through this package.

## Session binding and execution

The embedder binds one service to one immutable session identity and supplies current session
context plus effective shell settings. The standalone extension supplies the equivalent binding from
Pi's public context/settings APIs, respecting project trust. Cwd, shell path/command prefix and
`PI_SESSION_*`/model/reasoning environment follow Pi's current session values at command launch;
user-provided environment overrides and host-selected cwd are not additional tool inputs.

The shell command itself stays foreground; backgrounding means the tool does not await its outcome.
Each command owns an AbortController independent of the parent turn. Pi supplies output callbacks,
exit status and process-tree termination. A timeout is optional and means terminate, never switch
execution modes. No default timeout is imposed on intentionally long-lived commands.

`background_command` has four actions: `start` (command, optional display name and timeout),
`list`, `output` (command id), and `stop` (command id). Starts acknowledge acceptance with the opaque
id and current snapshot. Every other action is scoped to the bound session; command ids are not
PIDs, paths, or authorization tokens. Repeating stop is safe, and stop never creates a command.
Tool prompt guidance requires managed commands to avoid shell detachment such as `&`/`nohup`;
this is not a shell sandbox and does not promise to recover descendants that escape supervision.

## Runtime and retention

Command states are `running`, `stopping`, `completed`, `error`, and `stopped`. Only executor
settlement establishes a terminal state: exit zero is completed, a nonzero exit or unsignalled null
exit is error, and a requested cancellation is stopped after settlement. A stop request alone is
not proof the process exited. Error text is bounded, and failed launch remains inspectable.

A session admits at most eight active commands and retains its newest twenty terminal records;
excess starts fail explicitly rather than queue. Active/stopping work is never evicted. Display
names are bounded to 200 characters and commands to 64 KiB. Each output record retains only the
latest 2,000 lines or 50 KiB, whichever is reached first, with UTF-8-safe trimming and an explicit
truncation indication. Reads are non-consuming, and output snapshots REPLACE earlier snapshots.
This intentionally provides recent logs, not an archive: there are no uncapped temporary files or
second durable command index.

Records/output survive browser reloads, client disconnection, chat placement closure and parent-turn
Stop while the owning host/session remains live. They are lost on host restart; historical Pi
acknowledgements never recreate active records. Completed command notices in Pi's transcript retain
a bounded diagnostic excerpt, not the full log. Missing/evicted output reports unavailable.

Actual session disposal closes admission, disables completion wake-ups, signals every active command
before awaiting any one, and participates in the embedder's bounded shutdown. Workspace archive and
chat deletion use that same lifetime path. No idle timer kills quiet work. Abrupt host death and
escaped daemon descendants cannot be promised cleanly terminated or recoverable; never reconstruct
control authority from a persisted PID.

An injected service belongs to the embedder, not an extension instance: resource reload rebinds
completion delivery without dropping its jobs. The standalone extension disposes its own service
on session shutdown. Completion claims live with the retained records so rebind cannot deliver the
same outcome twice or silently lose a completion during the reload gap.

## Completion and controls

Natural completion sends one displayed Pi custom message with a bounded result excerpt and schedules
a follow-up turn, matching the existing detached-subagent convention. The agent can inspect more
retained output explicitly rather than poll to wait for completion. An explicit user/tool stop records
the cancellation without starting an idle parent; it does not abort a parent already running. Actual
session shutdown suppresses delivery into the dying session.

The tool and the host UI call the same handles. A service change subscription reports catalog or
lifecycle changes, not every byte of output; output is read separately while inspected. Native
`tool_execution_update` stops being a delivery path once the start acknowledgement resolves.

## Verification obligations

Exercise admission and eviction, bounded multibyte output, natural/nonzero/null exits, launch errors,
per-job stop isolation, parent-abort independence, duplicate stop, notification/reload races and
bounded disposal. Integration checks use real local commands and Pi's public executor; provider-driven
coverage verifies tool use and completion through a real Pi session. Windows tree termination and
hidden-shell behavior need native evidence, not a Unix-only claim.
