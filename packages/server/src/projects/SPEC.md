---
id: submodule-server-projects
type: submodule-design
status: active
title: projects — git repos as projects
parent: module-server
depends-on: [module-contracts]
tags: [public-surface-checked]
---

## Responsibility

Keep one stable registry of known git repositories, expose its open and recent views, and open/close a
project without breaking its workspace identity. For a folder that is not a repo yet, classify it and
bootstrap it into one so it can be opened.

## Boundary

- **Owns:** resolve every external project-folder input against the **host filesystem** before inspecting
  or mutating it: host-absolute paths pass, exact `~` and `~/…` expand against the host account, and every
  other relative path is rejected rather than interpreted against the host process cwd. The same resolved
  path feeds `openProject`, `inspectProjectPath`, and `initProject`, so their classifications and actions
  cannot disagree. It then validates a path is a repo (`git rev-parse --show-toplevel`; a non-repo rejects
  with the named `NOT_GIT` code), dedupes by root,
  and assigns a stable unique readable `slug`; `getProjects` returns all known records with slug backfill,
  `listProjects` returns open records by `lastOpened`, and `listRecentProjects` returns open + closed records
  by `lastOpened`. A persisted
  optional **`Project.closed: true`** is the entire membership state: absence means open, so existing
  records migrate as open. **`openProject`** finds a known root even when closed, clears `closed`, bumps
  `lastOpened`, preserves its id, persists, and publishes the full snapshot; **`closeProject`** marks that
  same record closed and publishes it without deleting the project, repository, workspace records, or
  live runtimes. **One cwd, one ThinkRail identity:** `openProject` rejects (named `ALREADY_OPEN`) a root already held as some
  workspace's `worktreePath` — pi keys chat transcripts by *directory*, so a second identity on an owned
  folder would serve that workspace's chats as its own and have them purged when either side is archived.
  Compared **canonically** (a managed worktree's stored path is composed, `--show-toplevel` answers
  symlink-resolved) and only **after** the reopen above, whose own Default workspace legitimately holds the
  project folder. The workspace-side half of the same door is `openExistingWorktree`
  ([[submodule-server-workspaces]]); reading the workspace records for it stays within the `persistence`
  dep — this module still never imports its sibling. `setProjectPublisher` is the host-injected push seam; this module never imports `host`.
  It also owns **`inspectProjectPath`** (classify a path — `repo` / `initable` / `missing` /
  `notDirectory` — so the UI picks between opening, an init offer, or an error) and **`initProject`**
  (bootstrap a plain directory: `git init` + `git add -A` + an **allow-empty** initial commit — committing
  the folder's contents, or an empty commit when it is empty, so the repo gets a HEAD and `git worktree
  add` works; an already-a-repo path short-circuits to `openProject`; a missing / non-dir path throws).
  The commit supplies a **fallback `user.name`/`user.email` only for a field git has none configured for**,
  so a real global identity is never overridden. ("Does the project have specs?" is **not** computed here
  — `host` answers the lazy `project.hasSpecs` query via `spec.projectHasSpecs`, keeping this module free
  of any spec dependency.) Project records also own the persisted project-level skill-admission state:
  trust is granted explicitly and revocably; the grant snapshots the currently discovered project aliases
  as acknowledged so later arrivals remain pending; and disabled skill/group sets form the project baseline
  beneath any workspace override. The host composes discovery with these mutation operations; this module
  stores no skill catalog and imports no agent code. Project records also carry the pi-level trust state
  `piResourceTrust` (trust for the project's native `.pi/` resources — settings, extensions, skills,
  prompts, themes, `SYSTEM.md`, subagent definitions — distinct from the alias-skill grant; seeded
  once for records that predate the field, with an explicit denial in pi's `trust.json` winning
  and never enabling MCP; a record whose decision could not be read — the store unreadable or
  malformed — is left without the field, reads as untrusted meanwhile, and is seeded on a later load,
  so a read failure never becomes a grant), plus `mcpApprovals` (repo-defined MCP server name →
  fingerprint of the whole original project-file entry) and `mcpOverrides` (per-project
  enablement/exposure of user-level servers, kept out of the tracked `.pi/mcp.json`). The migration is
  idempotent without a marker: a record created since the field exists carries an explicit value
  (`untrusted`, or `granted` when pi's trust store already trusts the path), so an absent field only ever
  means "legacy". pi's decision arrives through the host-injected `setPiTrustSeed` (this module imports no
  pi code); until a seed is configured no migration runs. `setProjectTrust(id, trusted, acknowledged?,
  { resources? })` keeps the two grants separate because they consent to different things: pi-level
  resources include code (extensions, settings packages), so only a surface that names them asks for them.
  `trusted: true` sets the alias grant and sets `piResourceTrust: "granted"` only with `resources: true`,
  leaving it untouched otherwise; `trusted: false` revokes both.
- **Public surface (barrel):** `openProject`, `listProjects`, `listRecentProjects`, `closeProject`,
  `getProjects`, `setProjectPublisher`, `inspectProjectPath`, `initProject`, `setProjectTrust`,
  `setProjectSkillEnabled`, `setProjectGroupEnabled`, `acknowledgeProjectSkills`,
  `approveProjectMcpServer`, `setProjectMcpOverride`, `setPiTrustSeed`.
- **Allowed deps:** `persistence`; the `git` sub-module (shared `git()` runner, which now owns the
  environment its children spawn under — this module passes none); `contracts` (`Project`, `ProjectPathStatus`);
  `shared/codedError` (the two named open failures); Node/Bun.
- **Forbidden:** `host`; sibling features other than `git` (`workspaces` depends on `projects`, never the
  reverse).
