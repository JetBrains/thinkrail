---
id: task-run-script-port-preflight-recovery
type: task-spec
status: done
title: "Bugfix: run.sh port preflight should recover, not fail"
implements:
  - run-script
covers:
  - run.sh
tags:
  - high
  - bug-fix
  - run-script
---
# Bugfix: `run.sh` port preflight should recover, not fail

> When the requested backend (8000) or frontend (3000) port is already in use, `run.sh` currently exits with a hard error. The corrected intent (per [`run-script`](../../RUN_SCRIPT.md)) is to probe up to `+10` from the requested port, pick the first free one, warn the user, and continue. Only exit non-zero when the entire range is exhausted.

**Status:** Done
**Priority:** High
**Started:** 2026-04-28
**Spec reference:** [`.bonsai/RUN_SCRIPT.md`](../../RUN_SCRIPT.md) (id `run-script`)

## Problem

`run.sh:80-85` currently does:

```bash
for PORT in $BACKEND_PORT $FRONTEND_PORT; do
    if port_in_use "$PORT"; then
        echo "Error: port $PORT is already in use."
        exit 1
    fi
done
```

If anything is listening on `BACKEND_PORT` (default 8000) or `FRONTEND_PORT` (default 3000) the script aborts before either dev server is started. The spec for `run.sh` says the script must instead pick the next free port within `+10` of the requested value, warn the user, and continue.

## Plan

1. Add a `find_free_port` bash helper (just below `port_in_use` at `run.sh:71-79`) that probes `start..start+10` and echoes the first port for which `port_in_use` returns false; returns non-zero on exhaustion.
2. Replace the existing `for PORT in $BACKEND_PORT $FRONTEND_PORT` loop (lines 80-85) with one that, for each of the named variables `BACKEND_PORT` / `FRONTEND_PORT`:
   - Calls `port_in_use` on its current value.
   - On collision, calls `find_free_port` and **reassigns the variable** to the substitute (so downstream `echo`s and child processes use it). Print a warning of the form `"port 8000 is in use; using 8001 instead"`.
   - If `find_free_port` fails, print `"Error: ports <start>..<start+10> are all in use."` to stderr and exit 1.
3. Verify the existing startup banners (`run.sh:105`, `run.sh:110`, `run.sh:116-118`) and child launches still read `$BACKEND_PORT` / `$FRONTEND_PORT` at expansion time (they do — no shadowing — so reassigning the variable is sufficient).
4. Manually verify: occupy port 8000 (e.g., `nc -l 8000 &`), run `./run.sh`, confirm it logs the substitution and the backend actually binds to the chosen port.

### Out of scope

- Changing the defaults (8000 / 3000) or the `+10` window size.
- Auto-killing whatever holds the port.
- Persisting the substituted port back into `.env`.
- Frontend/backend code changes — this is a shell-script-only fix.

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `run.sh` (lines 71-85) | Edit | Add `find_free_port` helper; replace fail-hard loop with recovery loop that reassigns `BACKEND_PORT` / `FRONTEND_PORT`. |

## Definition of Done

- `./run.sh` no longer aborts when the requested port is busy; it picks the next free port within +10 and logs the substitution.
- The actually-bound backend/frontend ports match what the script reports (manually verified by occupying port 8000 with `nc -l 8000 &`).
- When all 11 candidate ports are busy, the script exits non-zero with a clear range message.
- No behaviour change when the requested ports are free (no warning, default ports used).
- `run.sh` still passes whatever shellcheck / formatting the project applies (none enforced today, but keep style consistent with the surrounding script).
