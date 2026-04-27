---
id: task-spec-graph
type: task-spec
status: done
title: Implement Spec graph.py
depends-on:
- task-spec-models
implements:
- module-spec
covers:
- backend/app/spec/graph.py
tags:
- critical
- new-feature
---
# Implement Spec graph.py

> Build in-memory hierarchy graph from registry

**Status:** Done
**Priority:** Critical
**Started:** 2026-02-27
**Depends on:** `feature_spec_models`
**Spec reference:** `backend/app/spec/README.md`

## Files to Modify

- `backend/app/spec/graph.py`

## Summary

`graph.py` constructs a `SpecGraph` from registry entries and links. The graph represents the full spec hierarchy (parent-child, depends-on, implements relationships) and is served to the frontend for visualization.

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `build_graph` | `(entries: list[RegistryEntry], links: list[Link]) → SpecGraph` | Construct SpecGraph from entries and links. Rebuilt on every change (no caching in v1). |
| `get_children` | `(graph: SpecGraph, parent_id: str) → list[RegistryEntry]` | Return direct children of a node (entries linked via "parent" type). |
| `get_dependencies` | `(graph: SpecGraph, id: str) → list[RegistryEntry]` | Return specs that the given spec depends on. |
| `get_dependents` | `(graph: SpecGraph, id: str) → list[RegistryEntry]` | Return specs that depend on the given spec. |

### Dependencies

- `spec/models.py` (RegistryEntry, Link, SpecGraph)

## Plan

1. Implement `build_graph` — assemble SpecGraph from entries + links
2. Implement `get_children` — filter links by `type="parent"` where `to_id` matches
3. Implement `get_dependencies` — filter links by `type="depends-on"` where `from_id` matches
4. Implement `get_dependents` — reverse lookup of depends-on links
5. Write unit tests: graph construction, traversal queries, empty graph edge case

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/spec/graph.py` | Create | Graph building + queries |
| `tests/spec/test_graph.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the public interface defined in the module spec
