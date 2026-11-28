---
name: about-thinkrail
description: "Use when the user asks what ThinkRail is, how ThinkRail or its features work (workspaces, worktrees, specs, artifacts, plans, review, PR review, session insights, subagents, voice input, extensions, pi packages, themes, fonts, languages), where a setting or UI control lives, keyboard shortcuts, where ThinkRail stores data, troubleshooting ThinkRail itself, or official links, docs, blog, releases, and Discord. Not for questions about the user's own repository, not for running an interactive ThinkRail setup (use configuring-thinkrail), managing MCP servers (use managing-mcp-servers), building extensions (use making-thinkrail-extensions), or onboarding a project's specs (use setting-up-a-project)."
---

# About ThinkRail

ThinkRail is an agentic IDE built around the `pi` coding agent (run in-process — there is no `pi`
CLI executable inside ThinkRail). It isolates agent work into `git worktree` workspaces, pairs the
agent with an IDE workbench (editor, diffs, review, terminals, artifacts, plans), and preserves
project intent in a living spec graph (`SPEC.md` files).

## If the user opened this with no specific question

When invoked bare (for example via `/skill:about-thinkrail` from the Welcome screen or command
palette), do not dump every reference file. Give a crisp two-sentence overview of what ThinkRail is,
then offer a short list of topics they can ask about:

- **Core concepts** — how ThinkRail works with `pi`, isolated workspaces, specs, artifacts, plans, and review
- **Interface & shortcuts** — panels, command palette (`⌘K` / `Ctrl+K`), keyboard navigation, hint mode
- **Settings & data** — where every setting lives, `~/.thinkrail` vs `~/.pi/agent`, trust, providers
- **Troubleshooting & workflows** — fixing common issues, or starting a guided tune-up (`/skill:configuring-thinkrail`)
- **Docs, blog & releases** — website, changelog, Discord, updating, and filing issues

Invite them to ask anything in plain language.

## Topic reference files

Read only the reference file(s) under `<this skill's directory>/reference/` that match the user's
question before answering — never guess UI labels, paths, or shortcuts:

| Question topic | Read |
| --- | --- |
| What ThinkRail is, `pi` relationship, workspaces/worktrees, chats without a project, specs, artifacts, plans, diff & PR review, subagents, session insights, workflows, extensions, pi packages, voice | `reference/concepts.md` |
| Panels, layout, topbar, command palette, search (`#` specs, find in files), keyboard shortcuts, hint mode, themes, fonts, languages | `reference/ui-and-shortcuts.md` |
| Where a setting lives (**Settings › …**), `~/.thinkrail` vs `~/.pi/agent` vs repo `.pi/`, project trust, providers & custom servers, privacy/analytics | `reference/settings-and-data.md` |
| Something is missing or broken (no models, `gh` not connected, JetBrains Central, skills not loading, MCP errors, extension issues, voice download, Dock `PATH`, version check) | `reference/troubleshooting.md` |
| Website, docs, blog posts, extensions catalog, GitHub repo, releases, Discord, updating desktop/CLI, filing issues | `reference/links-and-community.md` |

## Hand off to action skills when the user wants work done

If the user is asking to *do* one of these rather than just learn about it, follow the owning skill:

- Guided initial setup or machine health check → `configuring-thinkrail`
- Add, change, remove, or debug an MCP server → `managing-mcp-servers`
- Build, rebuild, or install a custom ThinkRail extension → `making-thinkrail-extensions`
- Create a new project's spec graph or import an existing codebase's specs → `setting-up-a-project`
- Review someone else's GitHub pull request → `reviewing-a-pr`

## Keeping answers grounded and fresh

- **Match the installed version first.** The bundled reference files describe the version of ThinkRail
  that shipped them. Prefer them for how this install behaves.
- **Check live sources when needed.** For release notes, recent announcements, blog posts, or
  anything not answered in the reference files, fetch live pages when web tools are available
  (`web_enable` if not yet enabled, then `fetch_content` / `web_search` against `thinkrail.ai` or
  `github.com/JetBrains/thinkrail`).
- **Label live answers clearly.** Whenever a fact came from the website, blog, or GitHub rather than
  the bundled reference, say so explicitly and note that it may describe a newer release than the
  user's installed version.
- **Never fabricate UI controls or commands.** ThinkRail runs `pi` in-process, so never tell users
  to run `pi mcp add`, `pi login`, or other `pi` CLI commands inside ThinkRail unless they
  specifically asked about standalone `pi`.
