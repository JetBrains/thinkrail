---
id: module-pi-sandbox
type: module-design
status: draft
title: pi-sandbox — OS-level sandbox for Pi's shell and file tools
parent: architecture
tags: [pi-extension, sandbox, security, prototype]
---

## Responsibility

Limit what model-generated actions can touch, without moving Pi out of the host process. Pi itself,
provider calls and credentials stay in the host; the agent's shell commands run inside an OS sandbox
and its in-process file tools are held to the same path policy. A git worktree isolates *branches*;
this module isolates the *machine*: writes outside the workspace, reads of credential stores, and
network egress beyond an allow-list.

Pi's own guidance (`docs/security.md`) is the premise: project trust, transcript review and diff
review are not security boundaries; only an OS or virtualization boundary is.

## Boundary

- **Owns:** the sandbox policy model and its default, the sandboxed `BashOperations` executor, and a
  Pi extension that replaces the built-in `bash` tool, routes `user_bash`, and gates the
  `read`/`grep`/`find`/`ls`/`write`/`edit` tools through `tool_call`.
- **Public surface:** `createSandboxExtension`, `SandboxExtensionOptions`, `createSandboxedBashOperations`,
  `defaultSandboxPolicy`, `SandboxPolicy`, `canRead`, `canWrite`, `sandboxSupport`, `SandboxSupport`,
  `default` (the standalone extension).
- **Allowed deps:** public package-root Pi SDK APIs as a peer; `@anthropic-ai/sandbox-runtime`
  (seatbelt on macOS, bubblewrap + seccomp on Linux, plus its filtering HTTP/SOCKS proxy); Node
  standard libraries. Execution delegates to Pi's `createLocalBashOperations` after wrapping, never a
  copied spawn runner.
- **Forbidden:** ThinkRail packages, wire DTOs, UI, a second agent runtime, or running Pi out of
  process. Works in vanilla Pi: `pi -e packages/pi-sandbox`.

## Mechanism

The replacement `bash` keeps the built-in name, schema and renderer, so transcripts and the web tool
renderer are unchanged; only its description gains a short note telling the model what the sandbox
denies and to use `$TMPDIR`. Each command is wrapped by `SandboxManager.wrapWithSandbox` with the
policy for its own cwd, so one host process serves workspaces with different write roots. The
runtime (proxy, violation monitor) initializes once per process on first use.

File tools run inside the host process, which the OS sandbox does not cover. The `tool_call` gate
resolves the target path (cwd-relative, `~`, then `realpath` of its longest existing prefix so a
symlink inside the workspace cannot launder an outside path) and blocks a write outside `allowWrite`
or a read under `denyRead` that no `allowRead` re-opens. Nested calls issued by codemode scripts fire
`tool_call` too, so they are held to the same gate.

## Default policy

| Axis | Default |
|---|---|
| Write | the workspace cwd, its git common dir (worktree commits write there), the host temp dir, package caches (`~/.npm`, `~/.bun/install/cache`, `~/.cache`, `~/Library/Caches`) |
| Read | everything, except `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.netrc`, `~/.docker/config.json`, `~/.config/gh`, `~/.kube`, `~/.pi/agent/auth.json`, `~/.thinkrail`; the workspace and its git dir are re-opened by `allowRead` because ThinkRail worktrees live under `~/.thinkrail/worktrees` |
| Deny-write | `.env`, `.env.*`, `*.pem`, `*.key`; the git common dir's `hooks/` and `config`, which would otherwise let a sandboxed command plant code that git later runs outside the sandbox (hooks, `core.fsmonitor`, `core.hooksPath`) |
| Network | npm, Yarn, PyPI, crates.io, Go proxy, GitHub; everything else gets a 403 from the proxy. Local port binding is allowed so dev servers and test servers work |
| macOS trust | `com.apple.trustd.agent` mach lookup is allowed so Python/Go TLS verification works; sandbox-runtime labels this "weaker network isolation" |

## Prototype findings

Verified on macOS (arm64) with the real seatbelt sandbox, a real Pi agent (`pi -e`), and the ThinkRail
host behind `THINKRAIL_SANDBOX=1`:

- **Works unchanged:** `bun add` / `npm install`, `bun test`, `git commit` in a worktree,
  `git ls-remote` over HTTPS, a local HTTP server on a port, background commands, subagents' shell.
  The no-agent e2e suite (8 shards) and `e2e/tool-cards.live.spec.ts` pass with the flag on.
- **Denied as intended:** writes to `$HOME`, reads of `~/.ssh` and `~/.pi/agent/auth.json`, egress to
  unlisted domains.
- **Broke, fixed in the prototype:** local port binding (`EADDRINUSE` until `allowLocalBinding`);
  pip TLS on macOS (`OSStatus -26276` until trustd lookup is allowed); every workspace under
  `~/.thinkrail` was unreadable (fixed with `allowRead`); bare `/tmp` is silently dropped by
  sandbox-runtime (it accepts `$TMPDIR` = `/tmp/claude`), so the model is told to use `$TMPDIR`.
- **Found by the prototype, closed:** the writable git common dir let a sandboxed command write
  `.git/hooks/*` or `.git/config` and escape on the user's next unsandboxed git command; both are now
  deny-write (verified: worktree commits and `checkout -b` still work).
- **Broke, open:** `gh` (its config is a credential store), `git push` over SSH (no raw TCP, keys
  unreadable), `git remote add` / `push -u` (they write `.git/config`), any docs or API host outside
  the allow-list. The `shipping-a-pr` skill therefore
  cannot ship from inside a sandboxed session.
- **Not covered:** workspace terminals (user PTYs), MCP servers, and extension tools that spawn or
  fetch on their own run unsandboxed; host environment variables are inherited by sandboxed
  commands; Windows has no backend.

## Open decisions

1. **Credential-needing actions** (`gh`, push): a host-mediated tool that runs the one command
   outside the sandbox after an explicit approval, versus re-opening `~/.config/gh` per workspace.
2. **Network denials:** wire sandbox-runtime's ask callback to the host's question flow ("Allow
   `docs.rs` for this workspace?") with a per-workspace remembered allow-list, versus a static list.
3. **Environment:** strip provider/cloud credential variables from sandboxed commands (the e2e
   runner's ambient-credential denylist is a ready source) or keep inheriting them.
4. **Scope of the boundary:** whether workspace terminals and MCP stdio servers join it.
5. **Default:** opt-in per workspace first; default-on for new workspaces once the open items above
   land; never silently on for the Default (project-folder) workspace.

## Host integration (planned)

The prototype reads `THINKRAIL_SANDBOX=1` process-wide in `packages/server/src/agent/sandbox.ts`. The
product version makes it a workspace property: a `sandbox` field on the workspace in `contracts`,
chosen in the New Workspace dialog and switchable in workspace settings (applies to new sessions),
a shield badge on the workspace tab and chat header showing the state, a host capability probe
(`sandboxSupport`) that disables the toggle with the reason when the platform lacks a backend, and a
denial rendered in the bash tool card as "Blocked by sandbox" with the denied path or domain and an
"Allow for this workspace" action.
