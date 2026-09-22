---
id: module-pi-background-commands
type: module-design
status: active
title: pi-background-commands — explicit, session-owned background commands
parent: architecture
tags: [pi-extension, background-commands, public-surface-checked]
---

## Responsibility

An explicit background-command capability for Pi: start a noninteractive command without holding
the agent turn, inspect its recent output, and stop that exact command. Ordinary `bash` is unchanged.
The user-approved scope is log-only commands; no PTY, terminal tabs, automatic handoff, stdin,
restart/rerun, daemon discovery, or arbitrary-process management.

## Boundary

- **Owns:** one session-bound command service, its opaque command identities, admission, runtime
  snapshots, bounded output, cancellation and completion-delivery bookkeeping; the
  `background_command` Pi tool and a default vanilla-Pi extension entry.
- **Public surface:** `BACKGROUND_COMMAND_COMPLETION_MESSAGE`, `BackgroundCommandInput`,
  `BackgroundCommandsExtensionOptions`, `createBackgroundCommandsExtension`,
  `createBackgroundCommands`, `default`, `BackgroundCommandCompletion`,
  `BackgroundCommandCompletionBinding`, `BackgroundCommandContext`, `BackgroundCommandHandle`,
  `BackgroundCommandOutput`, `BackgroundCommandSnapshot`, `BackgroundCommandStart`,
  `BackgroundCommandStatus`, `BackgroundCommands`, `BackgroundCommandsBinding`,
  `BackgroundCommandsOptions`.
- **Allowed deps:** public package-root Pi SDK APIs and `typebox` as peers; Node standard libraries.
  Execution delegates to Pi's exported `createLocalBashOperations`, not a copied spawn runner.
- **Forbidden:** ThinkRail packages, web/TUI widget ownership, Pi private imports, delegation
  ownership, workspace PTYs, and generic resource-provider/plugin machinery. Wire DTOs are mirrored
  in contracts, never imported from or re-exported through this package.

## Session binding and execution

The root `index.ts` is the only import surface; `src/` is private implementation. A service exposes
start/list/find/change-subscription/dispose, plus completion binding and replay; a command handle
exposes its snapshot, output and idempotent stop. Controllers and subprocess details stay private.

The embedder binds one service to one immutable session identity and supplies current session
context plus effective shell settings. The standalone extension supplies the equivalent binding from
Pi's public context/settings APIs, respecting project trust. Cwd, shell path/command prefix and
`PI_SESSION_*`/model/reasoning environment follow Pi's current session values at command launch;
user-provided environment overrides and host-selected cwd are not additional tool inputs.

`createBackgroundCommands({ sessionId, getContext, canDeliverCompletion? })` captures the immutable
identity; synchronous `getContext()` is evaluated for every accepted launch. Its projection carries
`cwd`, optional `sessionFile`, `model` (provider/id), `thinkingLevel`, `shellPath`, `commandPrefix`,
and `exposeSessionEnvironment` (default true). Embedders project their effective in-memory settings;
standalone Pi reads `SettingsManager.create` with the latest tool context's project-trust decision
at launch. Pi does not expose its live SettingsManager on ExtensionContext. The environment preserves
process values, removes stale Pi session/model markers, and injects only this launch's current values.
Because Pi's `getShellEnv` is not public, managed-bin PATH parity uses public `getAgentDir()` plus
`bin`, preserving an existing entry and the environment's PATH-key casing. Tests compare the complete
environment against the public native bash definition; no production code uses that definition or its
unbounded temporary-output accumulator. An optional second factory argument, `createOperations`, is
an executor-construction seam for external-boundary tests, defaulting to Pi's public local executor.

The shell command itself stays foreground; backgrounding means the tool does not await its outcome.
Each command owns an AbortController independent of the parent turn. Pi supplies output callbacks,
exit status and process-tree termination. A timeout is optional and means terminate, never switch
execution modes. No default timeout is imposed on intentionally long-lived commands.

`background_command` has four actions: `start` (command, optional display name and timeout),
`list`, `output` (command id), and `stop` (command id). Starts acknowledge acceptance with the opaque
id and current snapshot. The id field is `id` on output/stop; action-specific extra fields are
rejected, including path, cwd, env, PID and stdin controls. Every other action is scoped to the bound
session; command ids are not PIDs, paths, or authorization tokens. Repeating stop is safe, and stop never creates a command.
Tool prompt guidance requires managed commands to avoid shell detachment such as `&`/`nohup`;
this is not a shell sandbox and does not promise to recover descendants that escape supervision.

## Runtime and retention

Command states are `running`, `stopping`, `completed`, `error`, and `stopped`. Only executor
settlement establishes a terminal state: exit zero is completed, a nonzero exit or unsignalled null
exit is error, and a requested cancellation is stopped after settlement. A stop request alone is
not proof the process exited. Error text is bounded to 4 KiB, and failed launch remains inspectable.
Timeouts are executor errors (natural failure notifications), not user-stop requests.

A session admits at most eight active commands and retains its newest twenty terminal records;
excess starts fail explicitly rather than queue. Active/stopping work is never evicted. Display
names are bounded to 200 characters and commands to 64 KiB. Each output record retains only the
latest 2,000 lines or 50 KiB, whichever is reached first, with UTF-8-safe trimming and an explicit
truncation indication. Reads are non-consuming, and output snapshots REPLACE earlier snapshots.
Line counting includes an empty final line after a trailing newline. Incremental UTF-8 decoding
preserves characters split between executor chunks; invalid/incomplete terminal bytes use normal
UTF-8 replacement decoding. This intentionally provides recent logs, not an archive: there are no
uncapped temporary files or second durable command index. Eviction releases the output even when a
caller still holds an old handle.

Records/output survive browser reloads, client disconnection, chat placement closure and parent-turn
Stop while the owning host/session remains live. They are lost on host restart; historical Pi
acknowledgements never recreate active records. Completed command notices in Pi's transcript retain
a bounded diagnostic excerpt, not the full log. Missing/evicted output reports unavailable.

Actual session disposal closes admission, disables completion wake-ups, signals every active command
before awaiting any one, and participates in the embedder's bounded shutdown. Workspace archive and
chat deletion use that same lifetime path. No idle timer kills quiet work. Abrupt host death and
escaped daemon descendants cannot be promised cleanly terminated or recoverable; never reconstruct
control authority from a persisted PID.

`list()` returns snapshot copies; `find(id)` returns this service's handle or undefined. `stop()` is
synchronous and returns the post-request snapshot; it does not await or manufacture settlement.
`output` is a non-consuming `{ text, truncated }` snapshot, or undefined after eviction.
`onChange(listener)` returns an unsubscribe and reports admission, stopping and terminal/eviction
changes, never byte updates. Observer errors cannot interrupt command cleanup.
`dispose({ timeoutMs? })` closes admission immediately and shares one promise across concurrent
callers. Its default wait budget is 5 seconds; a host can select a shorter nonnegative budget. Expiry
ends waiting, not execution authority: unsettled commands remain `stopping`, and any eventual executor
settlement still establishes `stopped`. All active commands are signalled before awaiting any one.

An injected service belongs to the embedder, not an extension instance: resource reload rebinds
completion delivery without dropping its jobs. The standalone extension disposes its own service
on session shutdown. Completion claims live with the retained records so rebind cannot deliver the
same outcome twice or silently lose a retained completion during the reload gap. Standalone resource
reload is a Pi session-shutdown event and disposes standalone-owned work; only injected services have
an owner outside that extension lifetime.

`bindCompletion({ deliver, canDeliverCompletion? })` replaces the current synchronous delivery
binding, immediately replays pending retained outcomes, and returns an identity-safe unbind function.
`flushCompletions()` retries pending outcomes against the current binding without polling. Both the
service binding's and the delivery binding's optional predicates must permit delivery. A host closes
its predicate during a provisional deletion tombstone, then calls `flushCompletions()` after rollback;
confirmed deletion calls `dispose()`. A resource-reload gap has no delivery binding and is replayed
on the next bind. Claims are made before synchronous send to prevent reentrant duplication; a thrown
send keeps the record pending. A successful send means acceptance by Pi's public fire-and-forget API,
not confirmation of an eventual provider response. Eviction also removes a pending claim: there is no
unbounded second notification queue.

## Completion and controls

Natural completion sends one displayed Pi custom message with a bounded result excerpt and schedules
a follow-up turn, matching the existing detached-subagent convention. The agent can inspect more
retained output explicitly rather than poll to wait for completion. The exported
`BACKGROUND_COMMAND_COMPLETION_MESSAGE` is `background-command-completion`; message details omit the
full command and retain only a 40-line/4-KiB diagnostic output excerpt plus bounded snapshot metadata.
Messages are displayed with `deliverAs: "followUp"`, with `triggerTurn: true` for natural outcomes and
`false` for stopped commands. An explicit user/tool stop records the cancellation without starting
an idle parent; it does not abort a parent already running. Actual
session shutdown suppresses delivery into the dying session.

The tool and the host UI call the same handles. A service change subscription reports catalog or
lifecycle changes, not every byte of output; output is read separately while inspected. Native
`tool_execution_update` stops being a delivery path once the start acknowledgement resolves.

## Verification obligations

Exercise admission and eviction, bounded multibyte output, natural/nonzero/null exits, launch errors,
per-job stop isolation, parent-abort independence, duplicate stop, notification/reload races and
bounded disposal. Integration checks use real local commands and Pi's public executor; provider-driven
coverage verifies tool use and completion through a real Pi session. Windows tree termination and
hidden-shell behavior need native evidence, not a Unix-only claim. The package suite uses Bun tests,
controlled executor settlement, real local shell commands, and Pi AgentSessions driven by the SDK's
faux provider. Live-provider host E2E remains the embedder's acceptance check, distinct from these
in-package tests.
