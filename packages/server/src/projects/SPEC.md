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
  or mutating it: host-absolute paths pass, exact `~` and `~/…` (on Windows also `~\…`) expand against the host account, and every
  other relative path is rejected rather than interpreted against the host process cwd. The same resolved
  path feeds `openProject`, `inspectProjectPath`, `initProject`, and `createProject`, so their classifications and actions
  cannot disagree. It then validates a path is a repo (`git rev-parse --show-toplevel`; a non-repo rejects
  with the named `NOT_GIT` code), records the root in the host's resolved spelling (git prints `C:/…` on
  Windows; architecture Decision 22), dedupes by root,
  and assigns a stable unique readable `slug`; `getProjects` returns all known records with slug backfill,
  `listProjects` returns open records by `lastOpened`, and `listRecentProjects` returns open + closed records
  by `lastOpened`, synchronously dropping only *closed* records whose folder the last completed check
  found definitively gone (missing, or no longer a directory). Open records are never checked, so a
  temporarily unmounted drive loses nothing; other filesystem errors do not prove deletion, and a record
  not yet checked stays listed. **`refreshRecentProjectFolders(budgetMs)`** re-stats closed records'
  folders asynchronously and resolves once they finish or the budget elapses; a still-pending check
  keeps running, and later refreshes join it instead of piling a second stat onto a hung mount. The
  filter is display-only: stored records are untouched. A persisted
  optional **`Project.closed: true`** is the entire membership state: absence means open, so existing
  records migrate as open. **`openProject`** finds a known root even when closed, clears `closed`, bumps
  `lastOpened`, preserves its id, persists, and publishes the full snapshot; **`closeProject`** marks that
  same record closed and publishes it without deleting the project, repository, workspace records, or
  live runtimes. **`renameProject`** replaces only the display `name` (whitespace-collapsed, trimmed,
  1–100 chars) and publishes the record; the folder-derived `slug`, `path`, and id never change, so
  workspace paths and identity are unaffected and a reopen keeps the chosen name. **One cwd, one ThinkRail identity:** `openProject` rejects (named `ALREADY_OPEN`) a root already held as some
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
  add` works; an already-a-repo path short-circuits to `openProject`; a missing / non-dir path throws; a
  timed-out top-level probe throws `GIT_TIMEOUT` rather than classifying a slow repo as `initable`, and a
  failed add/commit removes `.git` only when this call created it).
  **`createProject(parentPath, name)`** is the start-from-nothing path: `name` must be one plain folder
  name (no separators, not `.`/`..`), the resolved parent is created when missing, the target folder is
  made — an existing **empty** folder is reused, a non-empty one or a file rejects — and then gets the same
  bootstrap as `initProject`, run in that folder even when it sits inside an enclosing repository (a
  dotfiles repo in `~` must not swallow the new project); a failed bootstrap or open removes the folder
  this call made only while it is still empty (anything written into it meanwhile survives), and always the
  `.git` it added. An optional display name — what the user typed, before slugging — is passed through to
  `openProject` and becomes the project name (whitespace-collapsed, trimmed) in the one record it publishes,
  so creation emits a single project event rather than a folder-named one followed by a rename.
  The commit supplies a **fallback `user.name`/`user.email` only for a field git has none configured for**,
  so a real global identity is never overridden. ("Does the project have specs?" is **not** computed here
  — `host` answers the lazy `project.hasSpecs` query via `spec.projectHasSpecs`, keeping this module free
  of any spec dependency.) Project records also own the persisted project-level skill-admission state:
  trust is granted explicitly and revocably; the grant snapshots the currently discovered project aliases
  as acknowledged so later arrivals remain pending; and disabled skill/group sets form the project baseline
  beneath any workspace override. The host composes discovery with these mutation operations; this module
  stores no skill catalog and imports no agent code. Project records also carry the pi-level trust state
  `piResourceTrust` (trust for the project's native `.pi/` resources — settings, extensions, skills,
  prompts, themes, `SYSTEM.md`, subagent definitions — distinct from the alias-skill grant). A newly added
  project starts `untrusted`, or `granted` when pi itself already trusts its path; that answer arrives
  through the host-injected `setPiTrustSeed` (this module imports no pi code). There is **no
  grandfathering**: a record that predates the field is left as stored and reads as untrusted, so a project
  added before pi-level trust existed asks once through the trust notice instead of keeping code-running
  resources nobody consented to (user decision, PR #690 review). pi-level trust never enables MCP by itself:
  the record also carries `mcpApprovals` (repo-defined MCP server name → fingerprint of the whole original
  project-file entry), `mcpOverrides` (per-project enablement/exposure of user-level servers, kept out of
  the tracked `.pi/mcp.json`) and `mcpToolGrants` (per server, the "Always allow" tools and the `target` of
  the entry they were granted for — out of the repository so it can never ship pre-granted).
  `grantProjectMcpTool(id, name, target, tool)` appends a tool, starting the list over when `target`
  changed; `revokeProjectMcpTool` drops one and removes the server, then the field, once empty. Both store
  server names as own properties, so a server named `__proto__` is just a name. `setProjectMcpOverride` synchronously merges only supplied fields into the
  latest stored override, so overlapping enablement and exposure patches do not lose each other. An empty
  patch is a no-op; `null` clears the override. It rejects non-boolean enablement and exposure outside
  `deferred`, `direct`, `hidden` before persistence. `setProjectTrust(id, trusted, acknowledged?,
  { resources? })` keeps the two grants separate because they consent to different things: pi-level
  resources include code (extensions, settings packages), so only a surface that names them asks for them.
  `trusted: true` sets the alias grant and sets `piResourceTrust: "granted"` only with `resources: true`,
  leaving it untouched otherwise; `trusted: false` revokes both. A trust change persists and publishes the
  record, so every client shows the persisted trust even when the host request that made it then fails
  (an open chat could not reload).
## Repository cloning

`inspectCloneDestination` returns the validated absolute destination for the UI preview without reserving
it; clone repeats that check before claiming the folder. `cloneProject` accepts a repository URL, host parent path, one folder name and optional positive integer
history depth. HTTP(S), SSH, Git, SCP-style SSH and local `file:` URLs are accepted; remote helpers,
embedded passwords, HTTP userinfo, query strings, fragments and backslashes are rejected. Backslashes
are ambiguous between the web URL parser and Git, so validation never accepts one spelling while Git
executes another. Git uses the host's existing
credential helpers and SSH configuration; no credentials are collected by ThinkRail. The parent must
already be a directory. Every existing destination (including an empty directory or symlink) rejects.
An exclusive mkdir reserves the destination before Git starts. Failures and cancellation clean only that
reservation, checking its filesystem identity before deletion; a replacement entry is never removed.
Clone is asynchronous, has a 30-minute deadline, and cancellation waits for process teardown before
cleanup. Successful cloning is followed by `openProject`; an opening failure preserves the checkout for
recovery. No agent starts and no trust is granted implicitly.

`startProjectClone` / `cancelProjectClone` pair a client-owned operation id with an AbortController only
while the request is active. Cancellation is owner-scoped and idempotent, and the original clone response
reports cancellation only after cleanup. Socket reconnect uses host request replay, not a new operation.
Git diagnostics are redacted before truncation: user-configured URL rewrites can introduce credentials,
and truncating first can separate a secret suffix from the URL prefix needed to recognize it.

- **Public surface (barrel):** `cloneProject`, `inspectCloneDestination`, `startProjectClone`, `cancelProjectClone`, `openProject`, `listProjects`, `listRecentProjects`,
  `refreshRecentProjectFolders`, `closeProject`, `renameProject`,
  `getProjects`, `setProjectPublisher`, `inspectProjectPath`, `initProject`, `createProject`, `setProjectTrust`,
  `setProjectSkillEnabled`, `setProjectGroupEnabled`, `acknowledgeProjectSkills`,
  `approveProjectMcpServer`, `setProjectMcpOverride`, `grantProjectMcpTool`, `revokeProjectMcpTool`,
  `setPiTrustSeed`.
- **Allowed deps:** `persistence`; the `git` sub-module (shared `git()` runner, which now owns the
  environment its children spawn under — this module passes none); `contracts` (`Project`, `ProjectPathStatus`);
  `shared/codedError` (the two named open failures); Node/Bun.
- **Forbidden:** `host`; sibling features other than `git` (`workspaces` depends on `projects`, never the
  reverse).
