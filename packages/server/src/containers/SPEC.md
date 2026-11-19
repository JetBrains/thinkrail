---
id: submodule-server-containers
type: submodule-design
status: active
title: containers — workspaces grouped across projects
parent: module-server
depends-on: [module-contracts, submodule-server-persistence, submodule-server-trash]
references: [submodule-server-workspaces, submodule-server-host, submodule-server-agent]
tags: [public-surface-checked]
---

## Responsibility

The host record that groups workspaces, possibly of several projects, and the container's home folder.
Composition, not redefinition: a member stays one `Workspace` (one worktree on its own branch) and every
workspace-keyed path is untouched. A workspace that belongs to no container has no record; nothing is
derived for it.

## Boundary

- **Owns:** `containers.json` under the data dir (`persistence.loadContainers` / `saveContainers`,
  versioned, atomic; an unreadable or invalid file is set aside and loads empty, a newer version is left
  untouched, loads empty and refuses every change with `CONTAINERS_STORE_UNAVAILABLE`), the membership
  rules, the home folder `<dataDir>/containers/<id>/`, and the `ContainerEvent` publisher seam
  (`updated` with the full record, `removed` with the id; the host maps them to `container.updated` /
  `container.removed`).
- **Rules:**
  - A workspace belongs to at most one container (`CONTAINER_MEMBER_TAKEN`). Members may be managed
    worktrees and attached external ones, from any project. A project's Default workspace and a chat
    without a project never join (`CONTAINER_MEMBER_REFUSED`); an unknown workspace is a plain error.
  - A create needs at least one member (`CONTAINER_EMPTY`): every way a container comes about starts
    from a workspace. Without a name it takes its first member's display name. An unknown container is
    `CONTAINER_UNKNOWN`; adding a member twice, removing a non-member and removing a gone container are
    no-ops.
  - Leaving (`removeContainerWorkspace`, or `forgetContainerMember` when the workspace is archived or
    removed) makes the workspace standalone; a container left without members is dissolved.
    Dissolving (`removeContainer`) drops the record only and never touches a member: deciding to
    archive each one is the caller's, through the workspace methods.
  - Every change is saved, then the home is synced, then published, all before the first await, so the
    record and its push move with the workspace event that caused them.
  - `orchestratorSessionId` is written only through `setContainerOrchestrator` (an unknown container is
    `CONTAINER_UNKNOWN`) and cleared by `forgetContainerOrchestrator` (a gone container, or one without
    an orchestrator, is a no-op).
- **Home folder:** `.thinkrail/context/` (shared artifacts, seeded by `shared`'s `seedArtifactsDir`
  with its self-ignoring `.gitignore`) and `workspaces/`, one link per member named
  `<project slug>-<branch>` (one plain `[A-Za-z0-9._-]` segment, never a dot name or a Windows device
  name; a name taken by an earlier member or by an entry that is not a link gets `-2`, `-3`…; compared
  case-insensitively) pointing at the member's `worktreePath` — a directory symlink, a junction on
  Windows. The links are re-derived on every change and on every `updated` event of a member
  (`syncContainerMemberLinks`), so a branch move relinks. A sync failure is logged, never fails the
  change; `prepareContainerHome` (the orchestrator's start) syncs now, throws instead, and returns the
  home's path. `containersRoot` is the folder every home lives in, for the host's git ceiling. Path safety: a container id is one plain segment (`persistence.isContainerId`, checked on
  read and before any path is built); every folder from the containers root down is `lstat`ed and must
  be a real directory, so a home, `.thinkrail` or `workspaces/` swapped for a link is refused, never
  followed; inside `workspaces/` only links are ever removed (`unlink`, never followed into a worktree),
  and an entry that is not a link is left alone.
- **Dissolve:** after the record is saved away and `removed` is published, the injected dissolve hook
  (`setContainerDissolveHook`; the host disposes the orchestrator there) is awaited, a failure logged, so no
  orchestrator still runs in a home being retired. Then the home's links are unlinked, so the trash never
  receives a path into a worktree; an untouched scaffold (only the `.gitignore`) is removed with `rmdir`
  when `.thinkrail` is a real directory (a `.thinkrail` swapped for a link is left, never emptied through
  it), and a home that still holds shared artifacts or such a link goes to the OS trash whole
  (`trash.trashFile`). A failed retirement is logged
  and leaves the folder under the containers root; the record is already gone.
- **Public surface (barrel):** `listContainers`, `createContainer`, `renameContainer`,
  `addContainerWorkspace`, `removeContainerWorkspace`, `removeContainer`, `forgetContainerMember`,
  `syncContainerMemberLinks`, `setContainerPublisher`, `ContainerEvent`, `setContainerOrchestrator`,
  `forgetContainerOrchestrator`, `setContainerDissolveHook`, `prepareContainerHome`, `containersRoot`.
- **Allowed deps:** `persistence` (`containers.json`, `dataDir`, `isContainerId`, the project and
  workspace records it reads), `trash` (a dissolved home with artifacts), `log`; `contracts`;
  `@thinkrail/shared/artifactsDir`, `@thinkrail/shared/paths`, `@thinkrail/shared/codedError`; Node.
- **Forbidden:** `host`; `workspaces` (it learns of an archive or a branch move only from `host`, which
  routes the workspace lifecycle here); `agent` and any git work — a container is never a repository.

## Orchestrator

One per container, composed by the host (`host/orchestrator.ts`, [[submodule-server-host]]) because it
joins this module, `workspaces` and `agent`; this module only stores the link.

- **A chat without a project in the home.** The orchestrator is a `kind: "chat"` record in the Chats
  project whose `worktreePath` is the home and whose `orchestratorOf` names the container
  ([[submodule-server-workspaces]]); `orchestratorSessionId` is the other direction. Reusing the chat
  record gives it every chat rule for free: never git (each repository door refuses a chat), no spec
  tools, the untrusted Chats project's resource policy, one session, deletion through the chat delete
  path. A home holds at most one chat record.
- **Git never walks into or out of the home.** `<dataDir>/containers` joins `GIT_CEILING_DIRECTORIES`
  beside the chats root (the host's `applyGitCeiling`, inherited by git, `gh`, PTYs and pi's bash), so
  git started anywhere in a home — the home, `.thinkrail/`, `workspaces/` — finds no repository rather
  than one enclosing the data dir. Discovery only walks up, so git in the home never descends into a link;
  a command run *inside* `workspaces/<link>/` resolves to the member's real worktree and operates on that
  repository — the policy below forbids writing there, and the shell cannot be fenced.
- **Created on demand, never with a turn.** `container.create` with two or more members, or the
  `container.addWorkspace` that brings a container to two, starts one when the container has none;
  `container.startOrchestrator` starts one for any container, joins a start in flight, answers an
  existing one as it is, and gives a session-less orchestrator chat a fresh session. A new session is
  named `Orchestrator · <container name>` (the chat record carries the same name), then gets a
  `container-brief` card — each member's project, name, branch, PR state and chats with their
  `chatState` — appended without triggering a turn, then the link is written. A start whose container
  went meanwhile deletes the chat it made.
- **Feed, don't assemble.** The orchestrator's sessions carry a role rule and a file-tool guard
  ([[submodule-server-agent]]): coordinate only, read members through `workspaces/`, write only under
  `.thinkrail/context/`, delegate code changes to the member's chat, merge only after the human approves
  in this chat. pi's `write`/`edit` into member code are refused (lexically under `workspaces/` or, by
  real path, inside a linked worktree); bash cannot be guarded, so the rule asks.
- **Goes with its container.** Dissolving (`container.remove`, or the last member leaving) deletes the
  orchestrator chat through the chat delete path — sessions closed, transcripts and delegated
  conversations to the Trash, record dropped — before the home is retired; no member is touched.
  Deleting the orchestrator chat on its own clears the link and keeps the container and its home.

## Later

Wake-ups, `message_chat` / `stop_chat`, `start_workspace into:` and merge gating, then the
Projects/topbar UI (until then the orchestrator is reachable as a chat in Chats).
