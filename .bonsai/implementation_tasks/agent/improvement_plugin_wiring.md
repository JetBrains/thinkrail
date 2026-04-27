---
id: task-plugin-wiring
type: task-spec
status: done
title: Wire claude-plugin into SDK client via ClaudeAgentOptions.plugins
implements:
- module-agent
covers:
- backend/app/agent/runner.py
- backend/app/agent/service.py
tags:
- medium
- improvement
---
# Wire claude-plugin into SDK client via ClaudeAgentOptions.plugins

The Bonsai `claude-plugin/` is currently only used for context assembly — `context.py` reads SKILL.md files and injects them into the system prompt. The SDK client itself doesn't know the plugin exists, so native plugin features (hooks, custom commands, namespaced skill invocation) are unavailable at runtime.

Wire the plugin directory into the SDK client by passing it as a local plugin via `ClaudeAgentOptions.plugins`. This enables the full SDK plugin lifecycle alongside the existing context assembly.

## Plan

1. **`runner.py`** — Add `plugin_dir: Path | None` parameter to `run()`. Build the `plugins` list conditionally:
   ```python
   from claude_agent_sdk import SdkPluginConfig

   plugins: list[SdkPluginConfig] = []
   if plugin_dir and plugin_dir.is_dir():
       plugins.append({"type": "local", "path": str(plugin_dir)})

   options = ClaudeAgentOptions(
       ...
       plugins=plugins,
   )
   ```

2. **`service.py`** — Pass `self._config.plugin_dir` to `runner.run()`:
   ```python
   await runner.run(
       task=task,
       spec_context=context,
       notify=notify,
       tracker=self._tracker,
       cwd=self._config.project_root,
       plugin_dir=self._config.plugin_dir,
   )
   ```

3. **Tests** — Update existing runner tests to account for the new `plugin_dir` parameter. Add a test that verifies `ClaudeAgentOptions.plugins` is populated when `plugin_dir` is a valid directory, and empty when `None`.

## Files to modify

- `backend/app/agent/runner.py` (add `plugin_dir` param, build plugins list, pass to options)
- `backend/app/agent/service.py` (pass `plugin_dir` through to runner)

## Definition of done

- Existing tests pass with the new parameter
- New test verifies plugin config is wired into `ClaudeAgentOptions` when `plugin_dir` exists
- New test verifies empty plugins list when `plugin_dir` is `None`

**Priority:** Medium
**Type:** Improvement
**Started:** 2026-03-05
