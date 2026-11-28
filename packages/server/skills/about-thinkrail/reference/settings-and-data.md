# Settings map, data paths, trust & privacy

## Where every setting lives

Open Settings with `⌘,` / `Ctrl+,` (desktop), the gear button, or the command palette (`⌘K` /
`Ctrl+K` — you can search individual settings by name directly in the palette).

### Agent
- **Settings › Models** — default chat model & reasoning effort, review subagent model & effort,
  agent-triggered review, automatic fix cycle & round limit (default 3, range 1–10), model context
  window, `pi` prompt-cache warming (off, active runs only, or between runs), and visible models
  (star/unstar favorite models directly in the chat model picker).
- **Settings › Providers** — OAuth sign-ins and API keys via `pi` auth, JetBrains AI (`central`
  CLI), and **Custom servers** (any OpenAI-compatible server such as LiteLLM, Ollama, LM Studio,
  vLLM, sglang, or llama.cpp, saved into `pi`'s `models.json` with a **Find models** probe).
- **Settings › Subagents** — built-in, personal, and trusted project subagent roles with model
  policies, per-role enable switches, delegation defaults, and concurrency limits.
- **Settings › Extensions & skills** — built-in ThinkRail extensions (e.g. hint mode, web access,
  session insights), community ThinkRail extensions (Browse or install by npm/git/folder), `pi`
  packages (user or repo scope), `pi` built-ins, and **Skills from other agents** (Claude Code,
  Codex, Copilot, Gemini, Claude plugins).
- **Settings › MCP servers** — user-level (`~/.pi/agent/mcp.json`) and repo-level (`.pi/mcp.json`)
  MCP servers, presets, GitHub recipe, OAuth sign-in, and repo-server approvals.
- **Settings › Prompt templates** — reusable prompt templates (`/` commands).
- **Settings › Environment** — choose an alternate `pi` config directory (`PI_CODING_AGENT_DIR`)
  and extra environment variables passed to the agent, terminals, and MCP servers (applies on next
  app restart; host-wide).

### Interface
- **Settings › Appearance** — themes, light/dark/system mode.
- **Settings › Text & fonts** — interface and code fonts, fallbacks, size, ligatures, weight,
  chat/code line widths.
- **Settings › Chat** — message order, composer box growth limit, and question panel height.
- **Settings › Layout** — saved workbench layout presets and reset.
- **Settings › Keyboard** — view, search, rebind, reset, export, and import all shortcuts.
- **Settings › Language** — UI language (system or fixed) and custom locale folder info.
- **Settings › Voice input** — enable dictation and download/manage the local Nemotron speech
  engine.
- **Settings › Terminal** — terminal replay buffer size and shell choice (Windows).

### System
- **Settings › Workspaces** — default **Projects folder** (`~/thinkrail`) for new/cloned repos and
  auto-settle idle days.
- **Settings › Integrations** — GitHub (`gh` CLI connection status for PRs and PR review).
- **Settings › Notifications** — desktop/system notifications when a chat finishes or needs input.
- **Settings › Privacy** — **Share additional usage data** toggle.
- **Settings › Updates** — desktop update channel (stable / nightly) and manual update check.
- **Settings › Share feedback** — short product feedback survey, Discord link, and email contact.

## Where data is stored on disk

- **ThinkRail host state:** `~/.thinkrail` (override with `THINKRAIL_DATA_DIR`):
  - `config.json` — ThinkRail app settings (managed by the running host — edit through Settings UI,
    not by hand while ThinkRail is running).
  - `environment.json` — **Settings › Environment** overrides (applied at boot).
  - `projects.json`, `workspaces.json`, `chats.json` — known projects, workspaces, and projectless
    chats.
  - `extensions.json` — installed ThinkRail extensions.
  - `themes/` — custom `*.theme.json` files (live on save).
  - `locales/` — custom `<lang>.json` translation overrides (live on save).
  - `fonts/` — custom user font files.
  - `worktrees/` — default worktree storage; projectless chat folders also live under app state.
- **`pi` configuration:** `~/.pi/agent` (override with `PI_CODING_AGENT_DIR` or **Settings ›
  Environment**):
  - `settings.json` — `pi` settings (fallback defaults, `cacheWarming`, package toggles).
  - `auth.json` — provider credentials (managed via `pi` auth / **Settings › Providers**; never
    share or print its contents).
  - `models.json` — custom OpenAI-compatible model providers.
  - `mcp.json` — user-level MCP servers (watched live by ThinkRail).
  - `sessions/` — `pi` session transcripts (read locally by Session insights).
  - `skills/`, `extensions/`, `prompts/` — personal `pi` resources (also `~/.agents/skills`).
- **Per-repository files:**
  - `.pi/` — repo-level `pi` settings, skills, extensions, prompts, subagent definitions, and
    `mcp.json`.
  - `.claude/skills`, `.github/skills`, `.gemini/skills`, `.agents/skills` — portable repo skill
    directories.
  - `.thinkrail/context/` — git-ignored workspace artifacts folder (outputs, task-specs, mockups,
    attachments).

## Trust & approvals

ThinkRail enforces explicit trust for cloned repositories:

- **Per-project trust grant:** repo-committed `.pi/` resources (settings, extensions, skills,
  prompts, subagents) and skill aliases (`.claude/skills`, `.github/skills`, `.gemini/skills`) do
  not load until you trust the project (shown in the Welcome trust notice or the chat Skills
  dialog).
- **Repo MCP servers:** entries in `.pi/mcp.json` require both project trust and per-entry approval
  in **Settings › MCP servers**; any edit to the entry requires re-approval.
- **Modifying MCP calls:** tools not marked read-only ask for confirmation in chat before running,
  with an optional per-project **Always allow**.
- **Agent repository cloning:** if an agent wants to clone an external repo for you, ThinkRail asks
  your approval first.

## Privacy & analytics

- Basic product events (launches, chat creation, sends, provider connection) and crash error
  classifiers (error type, code, ThinkRail-only stack frames — never prompts, code, file paths,
  credentials, or error message text) use a random installation ID.
- Additional product usage is opt-in via **Settings › Privacy** (or disabled per launch with
  `thinkrail --no-analytics` / `THINKRAIL_NO_ANALYTICS=1`).
- Feedback surveys are only sent when you explicitly press **Send** in **Settings › Share
  feedback**.
