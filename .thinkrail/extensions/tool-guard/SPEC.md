---
id: ext-tool-guard
type: submodule-design
status: active
title: tool-guard — safety rails for agent tool calls
parent: module-ext-sdk
depends-on: [module-ext-sdk]
references: [submodule-server-ext, submodule-web-ext, ext-timeline, ext-railmap, ext-git-pulse]
tags: [extensions, example]
---

## Responsibility

Stops the agent before it runs a dangerous shell command or writes a secret file, tells it why, and
shows the user every decision. A ThinkRail UI extension written only against `@thinkrail/ext` and
`@thinkrail/ext/view`; the SDK README's reference for a **blocking** pi hook through `tr.pi`.

## Hook

`tr.pi` adds a pi `tool_call` handler to every top-level chat session. pi 0.87.1 awaits it before the
tool runs; returning `{ block: true, reason }` skips the tool, and pi hands `reason` back to the model as
the tool's error result. The handler inspects only `bash` (`input.command`) and `write` / `edit`
(`input.path`, a leading `@` stripped, resolved against the session `cwd`); every other tool passes
without a decision. The workspace is the session `cwd`.

## Rules

A rule has an `action` (`block` or `allow`), a `target` (`bash` or `path`), and `enabled`. Order is user
rules (newest first), then built-ins; the first enabled rule that matches decides.

- **Bash.** `shell.ts` splits a command line into simple commands at `;`, `&&`, `||`, `|`, `&`,
  newlines, `(`, `)`, `$(`, and backticks, honouring quotes. Each command drops leading `VAR=x`
  assignments and `sudo` / `env` / `command` / `exec` / `nohup` / `time` wrappers; `sh|bash|zsh|dash -c
  "<script>"` is split again. `cd <dir>` moves the working directory for later commands. Each simple
  command takes its own first match; any `block` blocks the whole call, so an `allow` rule only excuses
  the command it matches. A user `block` regex also tests the whole command line (catches patterns that
  span a pipe).
- **Path.** A glob (`*`, `**`, `?`) tested against the resolved absolute path; `~/` expands to the home
  directory; a pattern without `/` tests the file name; a relative pattern with `/` tests the path
  relative to the workspace.
- User `bash` patterns are JavaScript regular expressions, checked when added. At most 100 user rules,
  300 characters each.

Built-ins (all `block`, each can be turned off, none removed):

| id | target | blocks |
| --- | --- | --- |
| `rm-rf-outside` | bash | `rm` with recursive and force flags on a target outside the workspace, the workspace itself, `~`/`$HOME`, or a target it cannot resolve (`$VAR`, unknown `cd -`) |
| `git-push-force` | bash | `git push` with `-f`, `--force`, or a `+refspec` (`--force-with-lease` passes) |
| `git-reset-hard` | bash | `git reset --hard` |
| `curl-pipe-shell` | bash | `curl`/`wget` piped straight into `sh`/`bash`/`zsh`/`dash` |
| `env-files` | path | `.env` and `.env.*`, except `.env.example`, `.env.sample`, `.env.template` |
| `ssh-dir` | path | anything under `~/.ssh` |

A blocked call's reason names the rule, says why, and tells the agent not to work around it but to ask
the user.

## Decision log

Each inspected call makes a `Decision { id, at, sessionId, sessionTitle?, tool, summary, verdict, rule?
{ id, label }, reason? }`. `summary` is the command or the workspace-relative path, clipped to 200
characters. The newest 200 are kept. The log is published at once and saved to `tr.store` at most once a
second (and on unload), so it survives reloads and restarts.

## Host half

- Channels: `log` (`Decision[]`, newest first) and `rules` (`RuleView[]` in evaluation order: `{ id,
  source: user | builtin, target, action, enabled, label, description? }`).
- Store keys: `rules` (user rules), `disabled` (built-in ids turned off), `log`.
- Actions: `addRule { target, pattern, action, note? }` → `{ ok: true, rule } | { ok: false, error }`;
  `toggleRule { id }`; `removeRule { id }` (user rules only); `clearLog`; `check { tool, input }` → the
  verdict for a bash command or path in the calling view's workspace, without logging.
- Session titles come from `tr.sessions.list()`.

## Views

- `guard` (panel): counts (blocked / allowed), then two sections. **Log**: one row per decision (verdict
  chip, tool, summary, rule, session, age), **Clear**. **Rules**: an add form (bash or path, block or
  allow, pattern, note), a **Try** box that runs `check` on a command or path, and the rule list in
  evaluation order with a toggle and, for user rules, a remove button.
- `badge` (status): a shield with the number of blocked calls in the log; hidden when there are none.
  Click opens the panel.

## Boundary

- Public surface: the `guard` and `badge` surfaces, the actions above, and the `log` / `rules` channels.
- Host half: `index.ts`, `pi.ts`, `rules.ts`, `shell.ts`, `glob.ts`. Views: the `.tsx` files plus
  `hooks.ts`. `model.ts` is shared (types and pure helpers, no Node imports).
- Allowed dependencies: `@thinkrail/ext`, `@thinkrail/ext/view`, `react`, and Node `path` / `os` in the
  host half; pi types only.
- Forbidden: any ThinkRail package internals, views importing host-half files, and running or rewriting
  a tool call (the hook only blocks or passes; it never mutates `event.input`).

## Known limitations

- The shell split is a heuristic, not a shell. `eval`, aliases, functions, here-docs, scripts on disk,
  `xargs rm`, `find -delete`, and redirections (`> .env`) are not inspected; path rules never apply to
  bash.
- Paths are not resolved through symlinks.
- `powershell` and custom tools are not inspected.
- A session picks up a reloaded extension after its current run settles; until then the old version's
  hook decides with the rules it loaded.
