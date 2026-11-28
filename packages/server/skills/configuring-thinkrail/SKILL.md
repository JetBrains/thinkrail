---
name: configuring-thinkrail
description: "Use when the user asks to set up, configure, tune, or health-check ThinkRail itself — checking git, gh, JetBrains Central, providers, default and review models, skills from other agents, MCP servers, external editors, projects folder, voice input, appearance, or language — especially right after first launch. Not for onboarding a repository or creating a project's spec graph (use setting-up-a-project), not for pure 'what is / how does ThinkRail work' questions (use about-thinkrail), and not for focused MCP-only edits (use managing-mcp-servers) or building extensions (use making-thinkrail-extensions)."
---

# Configuring ThinkRail

Walk the user through an app-level health check and initial tune-up of ThinkRail after the first-run
provider wizard. Keep it fast, grounded in real checks on their machine, and tailored to what they
actually want to tune.

## Non-negotiable safety rules

1. **Never edit `~/.thinkrail/config.json` (or `$THINKRAIL_DATA_DIR/config.json`).** The running
   ThinkRail host holds `config.json` in memory without watching it; any hand edit is ignored until
   restart and silently overwritten on the next Settings save. Read it only to inspect current
   values, and give the user the exact **Settings › …** path for every ThinkRail-owned setting.
2. **Never run `pi` CLI commands** (`pi login`, `pi mcp add`, `pi config`, etc.). ThinkRail runs
   `pi` in-process — there is no `pi` command to invoke.
3. **Only edit watched `pi` files — and confirm every edit first.** You may edit
   `${PI_CODING_AGENT_DIR:-~/.pi/agent}/mcp.json`, `settings.json`, or `models.json` only after
   showing the exact change and getting the user's explicit confirmation. Never write plaintext API
   keys or tokens; use `${ENV_VAR}` or `!command` references.
4. **Never read or print secrets.** Check only whether `auth.json` exists (`test -f`); never print
   its contents, and never dump full `env` output that could expose API keys or tokens.
5. **No Node required.** ThinkRail needs no Node.js at runtime; run plain shell commands and file
   reads that work on any developer machine.

## Step 1 — Run a silent read-only health check

Run one compact, read-only inspection first so you report facts rather than guessing. Adapt syntax
if the shell is Windows PowerShell.

```sh
DATA_DIR="${THINKRAIL_DATA_DIR:-$HOME/.thinkrail}"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

echo "DATA_DIR=$DATA_DIR"
echo "PI_DIR=$PI_DIR"
echo "PI_PROVIDER=${PI_PROVIDER:-unset} PI_MODEL=${PI_MODEL:-unset} PI_REASONING_LEVEL=${PI_REASONING_LEVEL:-unset}"

git --version 2>&1 || echo "git: missing"
if command -v gh >/dev/null 2>&1; then
  gh --version | head -n 1
  gh auth status 2>&1 || true
else
  echo "gh: missing"
fi
if command -v central >/dev/null 2>&1; then
  central --version 2>&1 || echo "central: installed"
else
  echo "central: missing"
fi

echo "editors:"
for b in code idea webstorm pycharm goland rider clion phpstorm rubymine emacs vim; do
  command -v "$b" >/dev/null 2>&1 && printf " %s" "$b"
done
echo ""

echo "pi_auth_present=$(test -f "$PI_DIR/auth.json" && echo yes || echo no)"
echo "other_agent_skills:"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
for d in "$CLAUDE_DIR/skills" "${CODEX_HOME:-$HOME/.codex}/skills" "$HOME/.copilot/skills" "${GEMINI_CLI_HOME:-$HOME}/.gemini/skills"; do
  [ -d "$d" ] && echo "  dir: $d"
done
[ -f "$CLAUDE_DIR/plugins/installed_plugins.json" ] && echo "  file: $CLAUDE_DIR/plugins/installed_plugins.json"
```

Then use `read` (read-only) on whichever of these files exist:
- `$DATA_DIR/config.json` — inspect `defaultModel`, `defaultEffort`, `reviewModel`, `reviewEffort`,
  `agentReviewEnabled`, `reviewAutoFix`, `reviewAutoFixRounds`, `projectsFolder`,
  `otherAgentSkills`, `theme`, `themeMode`, `locale`, `voiceInputEnabled`.
- `$PI_DIR/settings.json` — inspect `cacheWarming` and fallback defaults (if present).
- `$PI_DIR/mcp.json` — inspect configured server names (never echo secret values if any appear).
- `$PI_DIR/models.json` — inspect custom provider names (never echo secret values if any appear).

## Step 2 — Present a concise status summary

Show the user a short, scannable report with two parts:

- **Ready** — tools and settings already working (e.g., `git`, active model/provider, detected
  editors, existing MCP servers).
- **Missing or worth tuning** — concrete gaps found (e.g., `gh` missing or logged out, no review
  model set, Claude/Codex skills present on disk while "Skills from other agents" is off, no GUI
  editor on `PATH`, default `~/thinkrail` projects folder if they prefer another).

Keep this summary brief — a tight bullet list or small table, not a wall of prose.

## Step 3 — Ask what they want to tune

Use `ask_user_question` (`multiSelect: true`) so the user picks which areas to walk through instead
of being dragged through every setting. Include only the areas that are relevant (up to 4 options per
round; combine minor ones naturally):

1. **Models & review** — default chat model/effort, independent review subagent model & auto-fix
   rounds, custom local/gateway servers.
2. **GitHub & PR workflow** — installing/authenticating `gh` so topbar PRs and `/skill:reviewing-a-pr`
   work.
3. **Skills & MCP servers** — enabling "Skills from other agents" (when other-agent skills were
   found) and/or connecting MCP servers.
4. **Workspace, editor & interface** — Projects folder, external editor (`Open in`), voice input,
   theme, fonts, language, shortcuts.

If the user picks nothing or says everything looks good, skip straight to Step 4.

## Step 4 — Walk through each chosen area

Keep guidance concrete and name the exact **Settings › …** section for every ThinkRail-owned
setting:

### Providers & models
- **Sign-ins, API keys, JetBrains AI, and custom servers** → **Settings › Providers** (custom
  OpenAI-compatible servers like Ollama, LM Studio, LiteLLM, or vLLM also have a **Find models**
  probe there and save into `pi`'s `models.json`).
- **Default chat model & effort, review subagent model & effort, agent-triggered review, automatic
  fix cycle & rounds, model context window, prompt-cache warming, and visible models** →
  **Settings › Models**.
- If the user asks you to add a custom OpenAI-compatible endpoint directly in `$PI_DIR/models.json`
  or update `cacheWarming` in `$PI_DIR/settings.json`, show the exact JSON diff and confirm before
  writing.

### GitHub & PR workflow
- If `gh` is missing, share the install command for their OS (`brew install gh` on macOS, package
  manager / `winget install GitHub.cli` on Windows).
- If `gh` is installed but not logged in, tell them to run `gh auth login` in a terminal (ThinkRail
  uses their own `gh` credentials), then verify the Connected status in **Settings › Integrations**.
- Clarify that plain `git clone` / `push` uses their existing Git / SSH credentials, not `gh`.

### Skills from other agents
- If Claude Code, Codex, Copilot, Gemini skills or Claude plugins were detected on disk, explain
  that they stay off by default and can be enabled globally in **Settings › Extensions & skills**
  (under *Skills from other agents*) or per project in a chat's Skills dialog.
- Mention that repo-committed `.pi/` resources and repo skill aliases (`.claude/skills`,
  `.github/skills`, `.gemini/skills`) only load after granting per-project trust.

### MCP servers
- Read and follow the `managing-mcp-servers` skill for any MCP server additions or troubleshooting.
- Summarize the key rules: edit `$PI_DIR/mcp.json` only after confirming the exact entry with the
  user, pin package versions (never `@latest`), never store plaintext secrets (use `${ENV_VAR}` or
  `!command`), and point the user to **Settings › MCP servers** for OAuth sign-in or repo-server
  approvals.

### Workspace, editor, voice & interface
- **Projects folder & auto-settle** → **Settings › Workspaces** (default `~/thinkrail`).
- **External editor ("Open in")** → ThinkRail probes `PATH` for `code`, `idea`, `webstorm`,
  `pycharm`, `goland`, `rider`, `clion`, `phpstorm`, `rubymine`, `emacs`, and `vim`. If their
  preferred editor was not detected, explain how to install its shell command (e.g., VS Code's
  `code` command or JetBrains Toolbox shell scripts) or add its directory to `PATH` in
  **Settings › Environment** and restart ThinkRail.
- **Voice input** → **Settings › Voice input** (one-time download of the local Nemotron model;
  trigger with the mic button or `⌘⇧Space` / `Ctrl+Shift+Space`).
- **Look, language & shortcuts** → **Settings › Appearance** (themes), **Settings › Text & fonts**,
  **Settings › Language**, and **Settings › Keyboard** (plus `⌘?` / `Ctrl+?` for the shortcuts
  cheatsheet).

## Step 5 — Wrap up & offer next step

- Summarize briefly: what is ready now, any `pi` files you edited (if any), and any **Settings › …**
  toggles left for the user to flip.
- Let them know they can ask any question about ThinkRail anytime (or run `/skill:about-thinkrail` /
  **Ask about ThinkRail** in `⌘K` / `Ctrl+K`).
- When they are ready to start working on a repository, offer to set up its spec graph with
  `/skill:setting-up-a-project` (or **Start a new project** / **Open project** from Welcome).
