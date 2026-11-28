# ThinkRail concepts & capabilities

## What ThinkRail is (and how it relates to `pi`)

ThinkRail is a thin IDE host that runs the `pi` coding agent **in-process** and bridges it to a
visual workbench. There is no second agent runtime and no `pi` CLI subprocess:

- **`pi` owns** the model registry, provider auth (`auth.json`), custom endpoints (`models.json`),
  MCP servers (`mcp.json`), skills, extensions, compaction, token/cost accounting, and session files.
- **ThinkRail owns** isolated git workspaces, the workbench UI (editor, diffs, review, terminals,
  panels), the spec graph tools, shared TODO plans, artifacts, and versioned contracts between host
  and UI.
- **Two launchers, one app:** a native desktop app (macOS, Windows, Linux) and the self-contained
  `thinkrail` CLI that launches the same host and opens the UI in your browser. Both share state in
  `~/.thinkrail` (or `$THINKRAIL_DATA_DIR`).
- **Your own tools & accounts:** ThinkRail has no ThinkRail account or login. Git, GitHub, and AI
  providers go through your own `git`, `gh`, `central` (JetBrains AI), and `pi` provider auth.

## Projects & isolated workspaces

- **Project:** any local git repository you open, create (**Start a new project**), or clone
  (**Add project → Clone repository…**). New projects and clones default to your projects folder
  (`~/thinkrail`, configurable in **Settings › Workspaces**).
- **Workspace:** a `git worktree` with its own branch and working directory, so multiple agents can
  work in parallel without colliding with each other or your main checkout. You can also attach
  existing git worktrees or explicitly open the **Default workspace** (the project folder itself).
- **Settled workspaces:** finished or dormant workspaces move to the Settled shelf when their PR
  merges/closes or after a quiet period (configurable in **Settings › Workspaces**), and wake back
  up whenever you work in them again.
- **Workspaces from chat:** ask the agent to do something "in a side workspace" (or run independent
  tasks in parallel) and it can open/clone a repository (cloning requires your approval), create
  workspaces with their own chats, and check their progress, diffs, and PRs.
- **Chats without a project:** ask, plan, or draft with no repository. Each gets a scratch folder
  under **Chats** (files, terminal, plan — no git, review, or PR). Use **Continue in workspace**
  when a scratch chat turns into real repo work: the agent summarizes the conversation into a new
  workspace's first message.

## Spec-driven development (the spec graph)

- Projects can keep living `SPEC.md` files alongside code (goal & requirements, architecture,
  module/submodule designs).
- The agent reads, searches, validates, and updates specs through dedicated `spec_*` tools so
  decisions survive across sessions.
- The read-only **Specs** panel renders the graph as a tree. In the command palette (`⌘K` /
  `Ctrl+K`), type `#` plus a question to search spec sections by words; press `↵` to open the
  section or `⌥↵` to ask the agent in a new chat.

## Chats, plans, subagents & background commands

- **Concurrent chats:** open multiple independent `pi` sessions per workspace, each with its own
  model and reasoning effort. Steer an active run or queue a follow-up mid-turn.
- **Attachments:** attach images (sent to the model) or other files like PDFs, videos, and text
  (copied into `.thinkrail/context/attachments/` for the agent to read) via paperclip, paste, or
  drag-and-drop (paperclip/paste on Linux).
- **Shared TODO plan (`TODO List` panel):** the agent maintains a step-by-step plan you can edit at
  any time. Completed code steps can be committed individually and automatically reviewed by an
  independent review subagent (configure in **Settings › Chat** and **Settings › Models**).
- **Subagents & background commands:** the agent can delegate tasks to isolated child sessions
  (built-in roles like `scout`, `planner`, `worker`, `reviewer`, plus personal and trusted project
  roles) and run non-blocking background commands. Inspect or stop them in the chat's Resources view;
  configure roles and concurrency in **Settings › Subagents**.
- **Interactive agent tools:** structured multiple-choice questions (`ask_user_question`) with
  comparable full-screen HTML mockups, inline Mermaid diagrams and before/after visual diffs
  (`visualize`), and one-click next-step chips above the composer (`⌥1`–`⌥9` to send, `⇧⌥1`–`⇧⌥9`
  to edit first).

## Artifacts & Outputs

- Non-code outputs the agent creates for you (task-specs, mockups, diagrams, reports, screenshots)
  live in the workspace's git-ignored `.thinkrail/context/` folder rather than `/tmp`.
- The **Artifacts** panel defaults to **Outputs** — the finished files the agent published via
  `present_files` (also shown as clickable cards in chat). Switch to **Smart**, **List**, or
  **Tree** to browse working files too. Files deleted behind your back remain restorable.

## Review & pull requests

- **Local diff & file review:** leave anchored comments on exact lines of diffs, files, rendered
  Markdown blocks, images, or mockups without starting the agent, then send the collected review
  package to a chat; the agent resolves comments as it addresses them.
- **Topbar Remote / PR controls:** publish branches, push, sync, or open a GitHub PR (described
  from the plan, commits, PR template, or an agent draft; GitLab opens a prefilled new-MR page).
  Once open on GitHub, see CI checks and review status, mark ready, merge, fix failing checks with
  the agent, reopen, or delete the remote branch.
- **Pull-request review (`/skill:reviewing-a-pr`):** type `/skill:reviewing-a-pr` in New Workspace
  or a project chat (or run **Review a pull request…** from the palette) to pick an open GitHub PR,
  inspect it in an isolated workspace, refute false positives, decide on findings in a one-page
  brief, and post a GitHub review via `gh` only after your confirmation.

## Bundled workflows

ThinkRail ships built-in workflow skills invoked automatically or via `/skill:<name>`:

- `setting-up-a-project` — onboard an empty repo (`starting-a-new-project`) or an existing codebase
  (`importing-a-codebase`) into a spec graph.
- `brainstorming` — interview product and technical decisions before building a feature or fix,
  record a task-spec, build, and update durable specs.
- `shipping-a-pr` — sync, verify, open/update a PR, watch CI, and address review comments.
- `reviewing-a-pr` — review someone else's GitHub PR with evidence and confirmation before posting.
- `about-thinkrail` & `configuring-thinkrail` — learn ThinkRail and tune your machine setup.
- `managing-mcp-servers` & `making-thinkrail-extensions` — configure MCP servers and build
  ThinkRail extensions.

## Session insights

Open **Session insights** from the chart icon at the bottom of the left sidebar (`⌃⌥I` /
`Ctrl+Alt+I`), from the command palette, or via **Session analysis** next to a chat's token/cost
line. Inspect per-session timelines, token/cost origins (including subagent spend), context & cache
diffs, cross-session findings (unused skills, failing commands, file hotspots), A/B slice
comparisons, and event search. Everything runs locally on your session files; nothing leaves your
machine.

## Extensions, `pi` packages & skills

- **Existing skills reused:** ThinkRail loads your `pi` skills (`~/.pi/agent/skills`,
  `~/.agents/skills`, project `.pi/skills` / `.agents/skills`) and can import skills from Claude
  Code (including installed Claude plugins), Codex, Copilot, and Gemini via **Settings › Extensions
  & skills** ("Skills from other agents"). Large catalogs stay inside a small prompt budget while
  the agent discovers unlisted skills via `skill_search`.
- **`pi` packages:** install npm, git, or local `pi` packages (user-wide or per-repo) and toggle
  individual extensions, skills, prompts, or `pi` built-ins in **Settings › Extensions & skills**.
- **ThinkRail extensions:** add agent tools, skills, boolean settings, and custom chat cards.
  Install from **Settings › Extensions & skills** (Browse community catalog or paste npm/git/local
  source), or ask the agent to build and install one (`making-thinkrail-extensions`).

## Voice input

Local speech-to-text dictation into almost every text field (including the chat composer's mic
button, or `⌘⇧Space` / `Ctrl+Shift+Space`). Text lands at the cursor and is never auto-sent. Runs
locally using NVIDIA's Nemotron streaming model after a one-time download in **Settings › Voice
input**.
