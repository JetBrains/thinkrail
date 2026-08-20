---
id: submodule-web-shell-layout-sync
type: submodule-design
status: active
title: shell/layoutSync — layout hydration and commit synchronization
parent: submodule-web-shell
tags: [layout, synchronization, optimistic]
---

## Responsibility

The browser side of the host-synchronized layout protocol: hydrate the accepted workspace snapshot,
serialize optimistic full-document commits, settle accepted broadcasts/responses, and reconcile device-local
attention when the structural document changes.

## Boundary

- **Owns:** per-workspace hydration and commit single-flights; captured expected revisions for queued
  replacements; conflict handling; lost-response settlement from a matching broadcast; connected-generation
  and workspace-removal guards; attention load/persist/reconciliation; and the React lifecycle that starts
  hydration for the mounted workspace.
- **Public surface (`index.ts`):** the mounted synchronization hook, `commitWorkspaceLayout`, attention
  persistence, and deterministic test seams for commit/hydration ordering. Conflict-specific commit errors
  and internal attention/hydration classifiers remain implementation details of returned promises and hooks.
- **External deps:** contracts layout types/results; store layout state/actions; transport requests/errors;
  shell-neutral `lib` attention/id helpers; React.
- **Forbidden:** feature panels, chat/session or terminal lifetime, resource placement policy beyond calling
  the pure layout preset/attention surface, server/shared/pi imports, or automatic retry/rebase of a stale
  full document.

A conflict is expected synchronization: install the returned current snapshot (including `null`) unless a
newer accepted broadcast already overtook that response, cancel the conflicting optimistic mutation and its
dependents, and reject with a conflict-specific local error without the generic save-failure toast. A queued
dependent removed by rollback never reaches the host. A matching broadcast that already settled the mutation
remains proof of success when the response is lost.
