# Core Module — Design Specification

> Parent: [DESIGN_DOC.md](../../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-02-25

## Purpose

The Core module provides shared infrastructure for all backend modules. It handles application configuration (project root discovery, directory paths, settings) and async file system watching. It is a dependency of every domain module and has no dependencies on other app modules.

## Internal Architecture

**Pattern:** Single responsibility — two independent utilities with no interaction between them.

```
  ┌──────────────┐    ┌──────────────┐
  │  config.py   │    │  watcher.py  │
  │              │    │              │
  │  project     │    │  async file  │
  │  root,       │    │  change      │
  │  paths,      │    │  detection   │
  │  settings    │    │              │
  └──────────────┘    └──────────────┘
         ▲                    ▲
         │                    │
    Used by all          Used by rpc/ and spec/
    modules              (notifications)
```

## File Organization

| File | Responsibility | Depends On |
|------|---------------|------------|
| `config.py` | App configuration: project root discovery, directory paths, settings | pydantic |
| `watcher.py` | Async file change watching: detect spec file and registry changes | watchfiles / watchdog |

## Public Interface

### config.py

| Function | Signature | Description |
|----------|-----------|-------------|
| `get_project_root` | `() → Path` | Discover and return the project root directory |
| `get_spec_dir` | `() → Path` | Path to the `.specs/` directory |
| `get_registry_path` | `() → Path` | Path to `.specs/registry.json` |
| `load_config` | `() → AppConfig` | Load application settings (Pydantic model) |

### watcher.py

| Function | Signature | Description |
|----------|-----------|-------------|
| `watch` | `(paths: list[Path], callback: Callable) → WatchHandle` | Start watching paths for file changes |
| `stop` | `(handle: WatchHandle) → None` | Stop a file watch |

### Models

| Model | Fields | Description |
|-------|--------|-------------|
| `AppConfig` | project_root, spec_dir, host, port | Application configuration (Pydantic) |
| `WatchHandle` | (opaque) | Handle to a running file watch |

### Output Contracts

| Function | Returns | Error Cases |
|----------|---------|-------------|
| `get_project_root` | `Path` (absolute) | Project root not found |
| `load_config` | `AppConfig` | Invalid config values |
| `watch` | `WatchHandle` | Invalid paths |
| `stop` | `None` | — |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| No fileio abstraction | Domain modules use pathlib/json directly | Simplicity — one-line wrappers add indirection without value |
| Registry handling in spec/, not core/ | spec/ owns the registry as domain state | Separation of concerns — registry is spec domain logic, not shared infrastructure |
| Watcher as separate file from config | Async watching is a distinct infrastructure concern | Separation of concerns — config is synchronous project setup, watcher is async runtime |
| No logging/error utilities | Use Python stdlib logging directly | Simplicity — add shared utilities only when a real pattern emerges |

## Dependencies

| Dependency | Usage |
|------------|-------|
| `pydantic` | AppConfig model validation |
| `watchfiles` or `watchdog` | File system change detection |

## Known Limitations

None — the module is intentionally minimal.

## Sub-modules

None.

## Related Specs

- **Parent:** [Architecture Design](../../../DESIGN_DOC.md)
- **Consumers:** [Spec Module](../spec/README.md), Agent Module (TBD), RPC Module (TBD)
