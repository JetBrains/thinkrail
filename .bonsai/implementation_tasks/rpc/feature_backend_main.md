---
id: task-backend-main
type: task-spec
status: done
title: Implement Backend main.py
depends-on:
- task-rpc-server
implements:
- module-rpc
covers:
- backend/app/main.py
tags:
- critical
- new-feature
---
# Implement Backend main.py

> FastAPI app factory, lifespan, and application bootstrap

**Status:** Done
**Priority:** Critical
**Spec reference:** `DESIGN_DOC.md` (lines 168-206), `backend/app/rpc/README.md` (server.py section)

## Summary

`main.py` is the FastAPI application entry point. It creates the app, registers the WebSocket route via `rpc/server.register_routes()`, and manages the lifespan (starting/stopping the file watcher). Without this file, the backend cannot start and the frontend has nothing to connect to.

## Files to Create

- `backend/app/main.py`

## Implementation

### FastAPI App Factory

```python
def create_app() -> FastAPI:
    config = load_config(project_root=Path.cwd())
    app = FastAPI(title="Bonsai", lifespan=lifespan)
    register_routes(app, config)
    return app
```

### Lifespan (startup/shutdown)

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    handle = await start_watcher(config)
    yield
    # Shutdown
    await stop_watcher(handle)
```

### Entry Point

```python
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:create_app", factory=True, host="0.0.0.0", port=8000)
```

## Dependencies

- `core/config.load_config` — app configuration
- `rpc/server.register_routes` — WebSocket endpoint registration
- `rpc/server.start_watcher` / `stop_watcher` — file watcher lifecycle

## Definition of Done

- [ ] `backend/app/main.py` exists and creates a FastAPI app
- [ ] Lifespan starts/stops the file watcher
- [ ] `uvicorn backend.app.main:create_app --factory` starts the server
- [ ] WebSocket endpoint at `/ws` accepts connections
- [ ] All existing tests still pass
