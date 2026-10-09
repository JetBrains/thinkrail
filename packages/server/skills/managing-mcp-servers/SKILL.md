---
name: managing-mcp-servers
description: Use when the user asks to add, change, remove, enable or disable an MCP server, or when an MCP tool is missing, needs sign-in, fails, or was blocked. ThinkRail runs pi in-process, so there is no `pi` command to call.
---

# Managing MCP servers in ThinkRail

ThinkRail uses pi's built-in MCP support but has no `pi` executable. Never run `pi mcp add`,
`pi mcp login` or other `pi` commands; edit the configuration files and point the user at
**Settings › MCP servers** for everything that needs them.

## Where servers are configured

- **User level** — pi's agent directory, usually `~/.pi/agent/mcp.json`: available in every project.
- **This repository** — `.pi/mcp.json` in the worktree, tracked in git. A server defined here does not
  run until the user approves it in Settings, and any later change to its entry needs approval again.
  It only loads when the user trusts the project.

Both files use pi's format:

```json
{
  "mcpServers": {
    "docs": { "url": "https://example.com/mcp" },
    "browser": { "command": "npx", "args": ["-y", "@playwright/mcp@0.0.83"] }
  }
}
```

- Pin package versions in `args`; never `@latest`.
- Never write a secret into either file. Reference it as `${ENV_VAR}` (from the host's environment) or
  `!command` (the command's output, for example `!gh auth token`), or let the user sign in.
- `exposure`: `deferred` (the default here — load the server's tools with `tool_search` first),
  `direct` (a few always-useful tools), or `hidden`. `codemode` is treated as `deferred`.
- Prefer the user-level file for personal servers; only put a server in `.pi/mcp.json` when the user
  wants it shared with the repository.

## GitHub

GitHub is a recipe, not a preset: its hosted server, authenticated with the user's GitHub CLI sign-in.
Add it to the user-level file (Settings › MCP servers offers the same entry under Paste JSON):

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/readonly",
      "headers": { "Authorization": "!t=$(gh auth token) && echo \"Bearer $t\"" }
    }
  }
}
```

- `/readonly` is GitHub's documented read-only mode (same as an `X-MCP-Readonly: true` header). Use
  `https://api.githubcopilot.com/mcp/` only when the user asks for tools that change data.
- The header command runs each time a chat connects. While `gh` is logged out it fails instead of sending
  an empty token; the user runs `gh auth login` in a terminal.
- Unverified: whether GitHub accepts the GitHub CLI token's scopes for every toolset. If the server
  rejects it, ask the user for a token in an environment variable: `"Authorization": "Bearer ${GITHUB_TOKEN}"`.

## After editing

The host reloads idle chats on its own and a busy chat picks the change up when it is idle. Tell the user
when a step is theirs: approving a repository server, or **Sign in** for a server that uses OAuth (both in
Settings › MCP servers). Do not ask them to restart ThinkRail.

## Using MCP tools

- Tools are named `mcp__<server>__<tool>`. For a `deferred` server, call `tool_search` to load them.
- Subagents cannot call MCP tools: call them yourself and put what the subagent needs in its task.
- ThinkRail asks the user before a call that may change data. A denied or cancelled call is final for that
  call; do not retry it without asking the user first.
