---
id: submodule-server-containers
type: submodule-design
status: active
title: containers — workspaces grouped across projects
parent: module-server
depends-on: [module-contracts, submodule-server-persistence, submodule-server-trash]
references: [submodule-server-workspaces, submodule-server-host]
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
- **Home folder:** `.thinkrail/context/` (shared artifacts, seeded by `shared`'s `seedArtifactsDir`
  with its self-ignoring `.gitignore`) and `workspaces/`, one link per member named
  `<project slug>-<branch>` (one plain `[A-Za-z0-9._-]` segment, never a dot name or a Windows device
  name; a name taken by an earlier member or by an entry that is not a link gets `-2`, `-3`…; compared
  case-insensitively) pointing at the member's `worktreePath` — a directory symlink, a junction on
  Windows. The links are re-derived on every change and on every `updated` event of a member
  (`syncContainerMemberLinks`), so a branch move relinks. A sync failure is logged, never fails the
  change. Path safety: a container id is one plain segment (`persistence.isContainerId`, checked on
  read and before any path is built); every folder from the containers root down is `lstat`ed and must
  be a real directory, so a home, `.thinkrail` or `workspaces/` swapped for a link is refused, never
  followed; inside `workspaces/` only links are ever removed (`unlink`, never followed into a worktree),
  and an entry that is not a link is left alone.
- **Dissolve:** the home's links are unlinked first, so the trash never receives a path into a
  worktree; an untouched scaffold (only the `.gitignore`) is removed with `rmdir` when `.thinkrail` is a
  real directory (a `.thinkrail` swapped for a link is left, never emptied through it), and a home that
  still holds shared artifacts or such a link goes to the OS trash whole (`trash.trashFile`). A failed
  retirement is logged
  and leaves the folder under the containers root; the record is already gone.
- **Public surface (barrel):** `listContainers`, `createContainer`, `renameContainer`,
  `addContainerWorkspace`, `removeContainerWorkspace`, `removeContainer`, `forgetContainerMember`,
  `syncContainerMemberLinks`, `setContainerPublisher`, `ContainerEvent`.
- **Allowed deps:** `persistence` (`containers.json`, `dataDir`, `isContainerId`, the project and
  workspace records it reads), `trash` (a dissolved home with artifacts), `log`; `contracts`;
  `@thinkrail/shared/artifactsDir`, `@thinkrail/shared/paths`, `@thinkrail/shared/codedError`; Node.
- **Forbidden:** `host`; `workspaces` (it learns of an archive or a branch move only from `host`, which
  routes the workspace lifecycle here); `agent` and any git work — a container is never a repository.

## Later

The orchestrator session (`orchestratorSessionId`, its cwd in the home), wake-ups, `startedBy` and the
Projects/topbar UI are later steps. Until the orchestrator exists no
process runs in the home, so `GIT_CEILING_DIRECTORIES` does not yet cover the containers root.
