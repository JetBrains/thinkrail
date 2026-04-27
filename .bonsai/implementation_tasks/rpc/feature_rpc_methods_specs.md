---
id: task-rpc-methods-specs
type: task-spec
status: done
title: Implement RPC methods/specs.py
depends-on:
- task-rpc-notifications
implements:
- module-rpc
covers:
- backend/app/rpc/methods/specs.py
tags:
- high
- new-feature
---
# Implement RPC methods/specs.py

> JSON-RPC handlers for `spec/*` methods

**Status:** Done
**Priority:** High
**Started:** 2026-02-27
**Depends on:** `feature_rpc_notifications`
**Spec reference:** `backend/app/rpc/README.md` (lines 185-198, 82-96)

## Files to Modify

- `backend/app/rpc/methods/specs.py`

## Summary

`methods/specs.py` contains the jsonrpcserver handler functions for all `spec/*` JSON-RPC methods. Each handler delegates to `spec/service` and returns domain models directly (Pydantic models serialize to JSON automatically). Error mapping converts domain exceptions to JSON-RPC error codes per the spec.

## Handlers

| Handler | RPC Method | Params | Delegates to |
|---------|------------|--------|--------------|
| `list_specs` | `spec/list` | `{}` | `spec_service.list_specs()` |
| `get_spec` | `spec/get` | `{ id: str }` | `spec_service.get_spec(id)` |
| `create_spec` | `spec/create` | `{ type: str, path: str, content?: str }` | `spec_service.create_spec(type, path, content)` |
| `update_spec` | `spec/update` | `{ id: str, content: str }` | `spec_service.update_spec(id, content)` |
| `delete_spec` | `spec/delete` | `{ id: str }` | `spec_service.delete_spec(id)` |
| `get_graph` | `spec/graph` | `{}` | `spec_service.get_graph()` |

## Error Code Mapping

| Exception | Code | Message |
|-----------|------|---------|
| `SpecNotFoundError` | -32001 | "Spec not found" |
| `RegistryError` | -32002 | "Registry error" |
| `ValidationError` | -32003 | "Validation error" |
| `KeyError` | -32602 | "Invalid params" |
| Other exceptions | -32603 | "Internal error" |

## Plan

1. Create `methods/` package with `__init__.py`
2. Implement error-mapping decorator or try/except pattern converting domain exceptions to jsonrpcserver error responses
3. Implement each handler: extract params, call service, return result
4. Handlers receive `**params` from jsonrpcserver dispatch
5. Return Pydantic models directly (jsonrpcserver handles serialization)
6. Write unit tests — mock spec_service, verify each handler + error mapping

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/rpc/methods/__init__.py` | Create | Package init |
| `backend/app/rpc/methods/specs.py` | Create | Spec handlers |
| `backend/tests/rpc/test_methods_specs.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the interface in `backend/app/rpc/README.md`
- Error codes match the mapping table in the spec
