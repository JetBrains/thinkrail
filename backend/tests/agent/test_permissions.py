"""Tests for permissions._await_user_response and can_use_tool routing."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from claude_agent_sdk import (
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
)

from app.agent.models import AgentConfig, AgentTask
from app.agent.permissions import (
    _TOOL_CATEGORIES,
    _await_user_response,
    can_use_tool,
    categorize,
    claude_can_use_tool_adapter,
    evaluate_mode,
)
from app.agent.runtime.permissions import (
    ToolPermissionRequest,
    ToolPermissionResponse,
)
from app.agent.tools import INTERCEPTORS
from app.agent.tracker import Tracker
from app.core.config import AppConfig


def _make_task(tracker: Tracker) -> AgentTask:
    task = tracker.create_task(["s1"], AgentConfig())
    tracker.set_status(task.thinkrail_sid, "idle")
    tracker.set_status(task.thinkrail_sid, "running")
    return task


def _config() -> AppConfig:
    return AppConfig(
        project_root=Path("/tmp/test"),
        thinkrail_dir=Path("/tmp/test/.tr"),
        plugin_dir=Path("/tmp/test/plugins"),
    )


class TestAwaitUserResponse:
    """``_await_user_response`` waits indefinitely for the user's reply."""

    async def test_user_answers_immediately(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def answer_soon():
            await asyncio.sleep(0.05)
            futures = tracker._futures.get(task.thinkrail_sid, {})
            for rid, fut in futures.items():
                if not fut.done():
                    tracker.resolve_future(task.thinkrail_sid, rid, {"behavior": "allow", "answers": {"q": "a"}})
                    break

        asyncio.get_event_loop().create_task(answer_soon())
        response, request_id = await _await_user_response(
            tracker, notify, task, _config(),
            method="agent/askUserQuestion",
            params={"thinkrailSid": task.thinkrail_sid, "questions": []},
        )

        assert response["behavior"] == "allow"
        assert tracker.get_task(task.thinkrail_sid).status == "running"

    async def test_publishes_status_changed_on_both_transitions(self) -> None:
        # Without these notifies, the sidebar's sessionList cache stays
        # at the previous status (e.g. "running" pre-question) and never
        # learns the session is waiting on the user — and then never
        # learns it transitioned back to running after the answer. Only
        # the next unrelated statusChanged would update the panel.
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def answer_soon():
            await asyncio.sleep(0.05)
            futures = tracker._futures.get(task.thinkrail_sid, {})
            for rid, fut in futures.items():
                if not fut.done():
                    tracker.resolve_future(task.thinkrail_sid, rid, {"behavior": "allow"})
                    break

        asyncio.get_event_loop().create_task(answer_soon())
        await _await_user_response(
            tracker, notify, task, _config(),
            method="agent/askUserQuestion",
            params={"thinkrailSid": task.thinkrail_sid, "questions": []},
        )

        status_calls = [
            c for c in notify.call_args_list
            if c.args and c.args[0] == "agent/statusChanged"
        ]
        assert len(status_calls) == 2, status_calls
        assert status_calls[0].args[1] == {
            "thinkrailSid": task.thinkrail_sid, "status": "waiting",
        }
        assert status_calls[1].args[1] == {
            "thinkrailSid": task.thinkrail_sid, "status": "running",
        }

    async def test_skips_waiting_publish_when_already_waiting(self) -> None:
        # Nested permission requests (one question opens another) reuse
        # the existing waiting state — we should not double-publish.
        tracker = Tracker()
        task = _make_task(tracker)
        tracker.set_status(task.thinkrail_sid, "waiting")
        notify = AsyncMock()

        async def answer_soon():
            await asyncio.sleep(0.05)
            futures = tracker._futures.get(task.thinkrail_sid, {})
            for rid, fut in futures.items():
                if not fut.done():
                    tracker.resolve_future(task.thinkrail_sid, rid, {"behavior": "allow"})
                    break

        asyncio.get_event_loop().create_task(answer_soon())
        await _await_user_response(
            tracker, notify, task, _config(),
            method="agent/askUserQuestion",
            params={"thinkrailSid": task.thinkrail_sid, "questions": []},
        )

        status_calls = [
            c for c in notify.call_args_list
            if c.args and c.args[0] == "agent/statusChanged"
        ]
        # Only the running publish — waiting was already the entry state.
        assert len(status_calls) == 1
        assert status_calls[0].args[1]["status"] == "running"

    async def test_no_timeout_waits_indefinitely(self) -> None:
        """Even after a long wait, the future stays pending until resolved."""
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def answer_after_delay():
            await asyncio.sleep(0.2)
            futures = tracker._futures.get(task.thinkrail_sid, {})
            for rid, fut in futures.items():
                if not fut.done():
                    tracker.resolve_future(task.thinkrail_sid, rid, {"behavior": "allow"})
                    break

        asyncio.get_event_loop().create_task(answer_after_delay())
        response, _request_id = await _await_user_response(
            tracker, notify, task, _config(),
            method="agent/askUserQuestion",
            params={"thinkrailSid": task.thinkrail_sid, "questions": []},
        )
        assert response["behavior"] == "allow"


class TestCanUseToolNeutral:
    """The neutral can_use_tool entrypoint takes ToolPermissionRequest
    and returns ToolPermissionResponse — no Claude SDK types in either
    direction.
    """

    async def test_default_tool_user_allows(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def resolve_allow():
            await asyncio.sleep(0.02)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(
                    task.thinkrail_sid, req_id, {"behavior": "allow"},
                )
                break

        asyncio.get_event_loop().create_task(resolve_allow())
        req = ToolPermissionRequest(
            tool_name="Bash",
            input={"command": "ls"},
            tool_use_id="t-1",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert isinstance(response, ToolPermissionResponse)
        assert response.behavior == "allow"
        # Confirm prompt was emitted with the right method + tool_use_id
        confirm_calls = [
            c for c in notify.call_args_list if c[0][0] == "agent/confirmAction"
        ]
        assert len(confirm_calls) == 1
        params = confirm_calls[0][0][1]
        assert params["toolName"] == "Bash"
        assert params["toolUseId"] == "t-1"

    async def test_default_tool_user_denies(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def resolve_deny():
            await asyncio.sleep(0.02)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(
                    task.thinkrail_sid,
                    req_id,
                    {"behavior": "deny", "message": "nope", "interrupt": True},
                )
                break

        asyncio.get_event_loop().create_task(resolve_deny())
        req = ToolPermissionRequest(tool_name="Bash", input={"command": "rm -rf /"})
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "deny"
        assert response.message == "nope"
        assert response.interrupt is True

    async def test_ask_user_question_returns_answers(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def resolve_answer():
            await asyncio.sleep(0.02)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(
                    task.thinkrail_sid,
                    req_id,
                    {"questions": [{"question": "Q?"}], "answers": {"Q?": "A"}},
                )
                break

        asyncio.get_event_loop().create_task(resolve_answer())
        req = ToolPermissionRequest(
            tool_name="AskUserQuestion",
            input={"questions": [{"question": "Q?"}]},
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "allow"
        assert response.updated_input is not None
        assert response.updated_input["answers"] == {"Q?": "A"}

    async def test_interceptor_dispatch_returns_allow(self) -> None:
        """MCP interceptors return ``ToolPermissionResponse`` directly
        (Task 7 migration); ``can_use_tool`` returns it unchanged.
        """
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        req = ToolPermissionRequest(
            tool_name="mcp__thinkrail-specs__spec_search",
            input={},
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert isinstance(response, ToolPermissionResponse)
        assert response.behavior == "allow"


class TestClaudeCanUseToolAdapter:
    """The Claude SDK <-> neutral shim. The adapter must build a
    ``ToolPermissionRequest`` from Claude SDK args, call ``can_use_tool``,
    and translate the neutral response back to ``PermissionResultAllow``
    / ``PermissionResultDeny``.
    """

    async def test_allow_path_returns_permission_result_allow(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()
        captured: dict[str, ToolPermissionRequest] = {}

        async def fake_can_use_tool(req, **_kwargs):
            captured["req"] = req
            return ToolPermissionResponse(
                behavior="allow",
                updated_input={"command": "ls -la"},
            )

        ctx = ToolPermissionContext(tool_use_id="tu-1")
        with patch(
            "app.agent.permissions.can_use_tool", side_effect=fake_can_use_tool,
        ):
            result = await claude_can_use_tool_adapter(
                "Bash", {"command": "ls"}, ctx,
                tool_use_id="tu-1",
                tracker=tracker, notify=notify, task=task, config=_config(),
            )

        assert isinstance(result, PermissionResultAllow)
        assert result.behavior == "allow"
        assert result.updated_input == {"command": "ls -la"}

        # The neutral request was built correctly from the SDK args
        req = captured["req"]
        assert req.tool_name == "Bash"
        assert req.input == {"command": "ls"}
        assert req.tool_use_id == "tu-1"
        # SDK ToolPermissionContext has no session_id → falls back to task sid
        assert req.session_id == task.thinkrail_sid

    async def test_deny_path_returns_permission_result_deny(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def fake_can_use_tool(_req, **_kwargs):
            return ToolPermissionResponse(
                behavior="deny", message="nope", interrupt=True,
            )

        ctx = ToolPermissionContext()
        with patch(
            "app.agent.permissions.can_use_tool", side_effect=fake_can_use_tool,
        ):
            result = await claude_can_use_tool_adapter(
                "Write", {"file_path": "/etc/passwd"}, ctx,
                tool_use_id=None,
                tracker=tracker, notify=notify, task=task, config=_config(),
            )

        assert isinstance(result, PermissionResultDeny)
        assert result.behavior == "deny"
        assert result.message == "nope"
        assert result.interrupt is True

    async def test_deny_without_message_uses_default(self) -> None:
        """``can_use_tool`` may omit ``message`` on deny; the adapter
        must coerce ``None`` to a non-empty string for the SDK."""
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def fake_can_use_tool(_req, **_kwargs):
            return ToolPermissionResponse(behavior="deny")

        ctx = ToolPermissionContext()
        with patch(
            "app.agent.permissions.can_use_tool", side_effect=fake_can_use_tool,
        ):
            result = await claude_can_use_tool_adapter(
                "Bash", {}, ctx,
                tool_use_id=None,
                tracker=tracker, notify=notify, task=task, config=_config(),
            )

        assert isinstance(result, PermissionResultDeny)
        assert result.message == "Denied"
        assert result.interrupt is False

    async def test_permission_mode_forwarded_from_task_config(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(
            ["s1"], AgentConfig(permission_mode="bypassPermissions"),
        )
        tracker.set_status(task.thinkrail_sid, "idle")
        tracker.set_status(task.thinkrail_sid, "running")
        notify = AsyncMock()
        captured: dict[str, ToolPermissionRequest] = {}

        async def fake_can_use_tool(req, **_kwargs):
            captured["req"] = req
            return ToolPermissionResponse(behavior="allow")

        ctx = ToolPermissionContext()
        with patch(
            "app.agent.permissions.can_use_tool", side_effect=fake_can_use_tool,
        ):
            await claude_can_use_tool_adapter(
                "Read", {"file_path": "x"}, ctx,
                tool_use_id=None,
                tracker=tracker, notify=notify, task=task, config=_config(),
            )

        assert captured["req"].permission_mode == "bypassPermissions"

    async def test_session_id_taken_from_context_when_present(self) -> None:
        """If the SDK context carries a ``session_id`` attr, prefer it
        over the task's thinkrail_sid."""
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()
        captured: dict[str, ToolPermissionRequest] = {}

        async def fake_can_use_tool(req, **_kwargs):
            captured["req"] = req
            return ToolPermissionResponse(behavior="allow")

        # Build a context-like object with a session_id attribute
        class _Ctx:
            session_id = "claude-sdk-session-xyz"

        with patch(
            "app.agent.permissions.can_use_tool", side_effect=fake_can_use_tool,
        ):
            await claude_can_use_tool_adapter(
                "Read", {}, _Ctx(),  # type: ignore[arg-type]
                tool_use_id=None,
                tracker=tracker, notify=notify, task=task, config=_config(),
            )

        assert captured["req"].session_id == "claude-sdk-session-xyz"


class TestCategorize:
    """``categorize`` maps tool names to one of five permission categories."""

    @pytest.mark.parametrize(
        "tool_name, expected",
        [
            # read
            ("Read", "read"), ("Glob", "read"), ("Grep", "read"),
            ("LS", "read"), ("NotebookRead", "read"),
            # net
            ("WebFetch", "net"), ("WebSearch", "net"),
            # edit
            ("Edit", "edit"), ("Write", "edit"),
            ("MultiEdit", "edit"), ("NotebookEdit", "edit"),
            # bash
            ("Bash", "bash"), ("BashOutput", "bash"), ("KillShell", "bash"),
        ],
    )
    def test_explicit_table_entries(self, tool_name: str, expected: str) -> None:
        assert categorize(tool_name) == expected

    def test_unknown_mcp_prefix_routes_to_mcp(self) -> None:
        # MCP tools whose suffix is NOT in _INTERCEPTOR_CATEGORIES fall
        # back to the catch-all "mcp" bucket (denied in plan mode).
        assert categorize("mcp__some-other-server__unknown_tool") == "mcp"

    @pytest.mark.parametrize(
        "tool_name, expected",
        [
            # Read-only / display-only interceptors — safe in plan mode.
            ("mcp__thinkrail-specs__spec_search", "read"),
            ("mcp__thinkrail-specs__spec_links", "read"),
            ("mcp__thinkrail-vis__thinkrail_visualize", "read"),
            ("mcp__thinkrail-proactive__SuggestSession", "read"),
            ("mcp__thinkrail-orchestrator__suggest_step", "read"),
            # Mutating interceptors — must be denied in plan mode.
            ("mcp__thinkrail-specs__spec_delete", "edit"),
            ("mcp__thinkrail-ticket-status__ChangeTicketStatus", "edit"),
        ],
    )
    def test_mcp_interceptor_routes_to_proper_category(
        self, tool_name: str, expected: str,
    ) -> None:
        """ThinkRail's own MCP tools are categorized by their interceptor
        suffix so plan mode can allow read-only tools while denying
        mutating ones (instead of treating them all as opaque ``mcp``)."""
        assert categorize(tool_name) == expected

    def test_suggest_description_default_is_read(self) -> None:
        """``SuggestDescription`` without ``apply=true`` only renders an
        interactive card; the frontend's "Apply" button populates a
        local draft editor without writing the ticket body. So plan
        mode must let it through — classify as ``"read"``.
        """
        assert categorize(
            "mcp__thinkrail-describe__SuggestDescription",
        ) == "read"
        assert categorize(
            "mcp__thinkrail-describe__SuggestDescription", {},
        ) == "read"
        assert categorize(
            "mcp__thinkrail-describe__SuggestDescription",
            {"apply": False},
        ) == "read"

    def test_suggest_description_with_apply_is_edit(self) -> None:
        """``apply=true`` writes the ticket body directly — must be
        denied in plan mode, so classify as ``"edit"``.
        """
        assert categorize(
            "mcp__thinkrail-describe__SuggestDescription",
            {"apply": True},
        ) == "edit"

    def test_every_interceptor_has_explicit_category(self) -> None:
        """Sentinel: each registered INTERCEPTOR must be classifiable —
        either via an explicit ``_INTERCEPTOR_CATEGORIES`` entry or via
        the dynamic special cases inside ``categorize``. Otherwise the
        tool falls into the catch-all ``"mcp"`` bucket and plan mode
        would deny it whether or not the underlying handler mutates.
        """
        from app.agent.permissions import _INTERCEPTOR_CATEGORIES
        # SuggestDescription is classified dynamically (apply=true → "edit",
        # else "read"); it intentionally has no static entry.
        dynamic = {"SuggestDescription"}
        missing = set(INTERCEPTORS) - set(_INTERCEPTOR_CATEGORIES) - dynamic
        assert not missing, (
            f"INTERCEPTORS without classification: {missing}"
        )

    def test_unknown_tool_defaults_to_edit_fail_closed(self) -> None:
        assert categorize("WeirdNewTool") == "edit"
        assert categorize("RandomPlugin42") == "edit"

    def test_every_built_in_tool_classified(self) -> None:
        """Every tool name we expect to emit through the runner has an
        entry in ``_TOOL_CATEGORIES`` (or routes via the MCP-prefix /
        INTERCEPTOR keys branch). Sentinel test — guards against silent
        drift when new tools ship."""
        expected_built_ins = {
            "Read", "Glob", "Grep", "LS", "NotebookRead",
            "WebFetch", "WebSearch",
            "Edit", "Write", "MultiEdit", "NotebookEdit",
            "Bash", "BashOutput", "KillShell",
            "ExitPlanMode", "EnterPlanMode", "Agent", "TodoWrite",
            "TaskCreate", "TaskUpdate", "TaskGet", "TaskList",
        }
        missing = expected_built_ins - set(_TOOL_CATEGORIES)
        assert not missing, f"Expected built-in tools missing from _TOOL_CATEGORIES: {missing}"

    def test_runner_emitted_tool_names_are_classified(self) -> None:
        """Every tool name the Claude runtime recognizes by literal name
        must have an explicit entry in ``_TOOL_CATEGORIES``. Catches the
        regression where ``ExitPlanMode``/``Task`` were missing and
        fell through to the fail-closed ``"edit"`` default.
        """
        import re
        from pathlib import Path

        runtime_path = (
            Path(__file__).resolve().parents[2]
            / "app" / "agent" / "runtime" / "claude" / "runtime.py"
        )
        src = runtime_path.read_text(encoding="utf-8")
        emitted = set(re.findall(r'block\.name\s*==\s*"([^"]+)"', src))
        assert emitted, "runtime.py source did not yield any tool names"

        unclassified = {
            t for t in emitted
            if t not in _TOOL_CATEGORIES
            and not t.startswith("mcp__")
        }
        assert not unclassified, (
            f"runtime.py references tool names not in _TOOL_CATEGORIES: "
            f"{unclassified}. They would fall through to the fail-closed "
            f'"edit" default and be auto-denied in plan mode.'
        )


class TestEvaluateMode:
    """The ``(mode, category) -> decision`` table mirrors the reference's
    ``permissionPolicyEngine.ts:192-246``."""

    @pytest.mark.parametrize(
        "category", ["read", "net", "edit", "bash", "mcp"],
    )
    def test_bypass_permissions_allows_every_category(
        self, category: str,
    ) -> None:
        decision = evaluate_mode("bypassPermissions", category)  # type: ignore[arg-type]
        assert decision is not None
        assert decision.behavior == "allow"

    @pytest.mark.parametrize(
        "category, expected_behavior",
        [
            ("read", "allow"),
            ("net", "allow"),
            ("edit", "deny"),
            ("bash", "deny"),
            ("mcp", "deny"),
        ],
    )
    def test_plan_mode_table(
        self, category: str, expected_behavior: str,
    ) -> None:
        decision = evaluate_mode("plan", category)  # type: ignore[arg-type]
        assert decision is not None
        assert decision.behavior == expected_behavior
        if expected_behavior == "deny":
            assert decision.message  # non-empty rationale

    @pytest.mark.parametrize(
        "category, expected",
        [
            ("read", "allow"),
            ("net", "allow"),
            ("edit", "allow"),
            ("bash", None),
            ("mcp", None),
        ],
    )
    def test_accept_edits_table(
        self, category: str, expected: str | None,
    ) -> None:
        decision = evaluate_mode("acceptEdits", category)  # type: ignore[arg-type]
        if expected is None:
            assert decision is None
        else:
            assert decision is not None
            assert decision.behavior == expected

    @pytest.mark.parametrize(
        "category, expected",
        [
            ("read", "allow"),
            ("net", "allow"),
            ("edit", None),
            ("bash", None),
            ("mcp", None),
        ],
    )
    def test_default_mode_table(
        self, category: str, expected: str | None,
    ) -> None:
        decision = evaluate_mode("default", category)  # type: ignore[arg-type]
        if expected is None:
            assert decision is None
        else:
            assert decision is not None
            assert decision.behavior == expected

    def test_unknown_mode_returns_none(self) -> None:
        # Unknown modes shouldn't crash; they fall through so the
        # caller's interactive prompt path still runs.
        assert evaluate_mode("nonsense", "edit") is None
        assert evaluate_mode("", "bash") is None


class TestCanUseToolModeFiltering:
    """``can_use_tool`` integrates ``categorize`` + ``evaluate_mode``
    after the interactive transport primitives (``ConfirmStatement`` /
    ``AskUserQuestion``) and BEFORE INTERCEPTORS dispatch — so plan
    mode can deny mutating MCP tools that would otherwise auto-approve
    in their interceptor."""

    async def test_bypass_permissions_no_prompt_for_bash(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        req = ToolPermissionRequest(
            tool_name="Bash",
            input={"command": "ls"},
            permission_mode="bypassPermissions",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "allow"
        # Critical: no agent/confirmAction emitted in bypass mode.
        confirm_calls = [
            c for c in notify.call_args_list if c[0][0] == "agent/confirmAction"
        ]
        assert confirm_calls == []

    async def test_accept_edits_write_auto_approved_no_prompt(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        req = ToolPermissionRequest(
            tool_name="Write",
            input={"file_path": "x.txt", "content": "hi"},
            permission_mode="acceptEdits",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "allow"
        confirm_calls = [
            c for c in notify.call_args_list if c[0][0] == "agent/confirmAction"
        ]
        assert confirm_calls == []

    async def test_accept_edits_bash_still_prompts_user(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def resolve_allow() -> None:
            await asyncio.sleep(0.02)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(
                    task.thinkrail_sid, req_id, {"behavior": "allow"},
                )
                break

        asyncio.get_event_loop().create_task(resolve_allow())
        req = ToolPermissionRequest(
            tool_name="Bash",
            input={"command": "ls"},
            permission_mode="acceptEdits",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "allow"
        confirm_calls = [
            c for c in notify.call_args_list if c[0][0] == "agent/confirmAction"
        ]
        assert len(confirm_calls) == 1

    async def test_plan_mode_write_auto_denied_with_message(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        req = ToolPermissionRequest(
            tool_name="Write",
            input={"file_path": "x.txt", "content": "hi"},
            permission_mode="plan",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "deny"
        assert response.message
        assert "plan" in response.message.lower()
        # Auto-deny — no prompt.
        confirm_calls = [
            c for c in notify.call_args_list if c[0][0] == "agent/confirmAction"
        ]
        assert confirm_calls == []

    async def test_plan_mode_read_still_allowed(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        req = ToolPermissionRequest(
            tool_name="Read",
            input={"file_path": "x.txt"},
            permission_mode="plan",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "allow"

    @pytest.mark.parametrize(
        "tool_name",
        [
            "ExitPlanMode", "EnterPlanMode", "Agent", "TodoWrite",
            "TaskCreate", "TaskUpdate", "TaskGet", "TaskList",
        ],
    )
    async def test_plan_mode_allows_control_flow_tools(
        self, tool_name: str,
    ) -> None:
        """Regression: plan mode must NOT auto-deny SDK control-flow
        tools. ``ExitPlanMode`` is the SDK's mechanism for leaving
        plan mode — auto-denying it makes plan mode a one-way trap.
        """
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        req = ToolPermissionRequest(
            tool_name=tool_name,
            input={},
            permission_mode="plan",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "allow", (
            f"{tool_name} must not be auto-denied in plan mode"
        )

    async def test_default_mode_read_auto_allowed_no_prompt(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        req = ToolPermissionRequest(
            tool_name="Read",
            input={"file_path": "x.txt"},
            permission_mode="default",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "allow"
        confirm_calls = [
            c for c in notify.call_args_list if c[0][0] == "agent/confirmAction"
        ]
        assert confirm_calls == []

    async def test_default_mode_unknown_tool_falls_through_to_prompt(self) -> None:
        # Unknown tools categorize as "edit"; default mode "edit" cell is
        # None, so they fall through to the interactive prompt.
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def resolve_allow() -> None:
            await asyncio.sleep(0.02)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(
                    task.thinkrail_sid, req_id, {"behavior": "allow"},
                )
                break

        asyncio.get_event_loop().create_task(resolve_allow())
        req = ToolPermissionRequest(
            tool_name="UnknownNewTool",
            input={},
            permission_mode="default",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "allow"
        confirm_calls = [
            c for c in notify.call_args_list if c[0][0] == "agent/confirmAction"
        ]
        assert len(confirm_calls) == 1

    async def test_plan_mode_allows_read_only_mcp_interceptor(
        self,
    ) -> None:
        """Read-only ThinkRail MCP tools (``spec_search``, etc.) are
        categorized as ``"read"`` so plan mode allows them through to
        their interceptor handler."""
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        req = ToolPermissionRequest(
            tool_name="mcp__thinkrail-specs__spec_search",
            input={},
            permission_mode="plan",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "allow"

    @pytest.mark.parametrize(
        "tool_name, tool_input",
        [
            ("mcp__thinkrail-specs__spec_delete", {}),
            # SuggestDescription only mutates with apply=true.
            (
                "mcp__thinkrail-describe__SuggestDescription",
                {"apply": True},
            ),
            ("mcp__thinkrail-ticket-status__ChangeTicketStatus", {}),
        ],
    )
    async def test_plan_mode_denies_mutating_mcp_interceptor(
        self, tool_name: str, tool_input: dict,
    ) -> None:
        """Mutating ThinkRail MCP tools (``spec_delete``,
        ``SuggestDescription`` w/ ``apply=true``, ``ChangeTicketStatus``)
        are categorized as ``"edit"`` so plan mode auto-denies before
        the interceptor's auto-approve path can run. Otherwise plan
        mode could still delete spec files, write ticket descriptions,
        or transition ticket states — none of which have a second
        permission gate inside their handlers.
        """
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        req = ToolPermissionRequest(
            tool_name=tool_name,
            input=tool_input,
            permission_mode="plan",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        assert response.behavior == "deny"
        assert response.message
        assert "plan" in response.message.lower()
        # No interactive prompt fired — mode filter blocked it cleanly.
        confirm_calls = [
            c for c in notify.call_args_list if c[0][0] == "agent/confirmAction"
        ]
        assert confirm_calls == []

    async def test_plan_mode_allows_suggest_description_default_flow(
        self,
    ) -> None:
        """``SuggestDescription`` without ``apply=true`` only sends an
        interactive card to the frontend; the user's "Apply" button
        populates a local draft editor (no ticket write). It must
        reach its interceptor handler in plan mode — otherwise the
        documented ``ticket-describe`` flow is blocked.
        """
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        req = ToolPermissionRequest(
            tool_name="mcp__thinkrail-describe__SuggestDescription",
            input={"description": "draft"},  # no apply flag
            permission_mode="plan",
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        # The interceptor auto-approves; mode filter must not pre-empt.
        assert response.behavior == "allow"


class TestInteractiveBuiltinsBypassModeFilter:
    """``ConfirmStatement`` and ``AskUserQuestion`` are interactive
    transport primitives — they must always reach their card flow
    regardless of permission_mode. Otherwise plan mode would deny
    clarifying questions and acceptEdits would auto-allow without
    populating ``answers``, both of which break the agent loop.
    """

    @pytest.mark.parametrize("mode", ["plan", "acceptEdits", "bypassPermissions"])
    async def test_ask_user_question_reaches_handler_in_any_mode(
        self, mode: str,
    ) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        async def resolve_answer():
            await asyncio.sleep(0.02)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(
                    task.thinkrail_sid, req_id,
                    {"questions": [{"question": "Q?"}], "answers": {"Q?": "A"}},
                )
                break

        asyncio.get_event_loop().create_task(resolve_answer())
        req = ToolPermissionRequest(
            tool_name="AskUserQuestion",
            input={"questions": [{"question": "Q?"}]},
            permission_mode=mode,
        )
        response = await can_use_tool(
            req, tracker=tracker, notify=notify, task=task, config=_config(),
        )

        # Card was shown and answers came back populated — not silently
        # auto-allowed/auto-denied by the mode filter.
        ask_calls = [
            c for c in notify.call_args_list
            if c[0][0] == "agent/askUserQuestion"
        ]
        assert len(ask_calls) == 1
        assert response.behavior == "allow"
        assert response.updated_input is not None
        assert response.updated_input["answers"] == {"Q?": "A"}

