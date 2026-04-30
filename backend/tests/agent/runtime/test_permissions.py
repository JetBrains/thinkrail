"""Tests for runtime-neutral permission types."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.agent.runtime.permissions import (
    ToolPermissionRequest,
    ToolPermissionResponse,
)


class TestToolPermissionRequest:
    def test_minimal_construction(self):
        req = ToolPermissionRequest(tool_name="Read")
        assert req.tool_name == "Read"
        assert req.input == {}
        assert req.tool_use_id is None
        assert req.session_id is None
        assert req.permission_mode == "default"
        assert req.context == {}

    def test_full_construction(self):
        req = ToolPermissionRequest(
            tool_name="Bash",
            input={"command": "ls"},
            tool_use_id="tu-1",
            session_id="sess-9",
            permission_mode="acceptEdits",
            context={"sandbox": "off"},
        )
        assert req.tool_name == "Bash"
        assert req.input == {"command": "ls"}
        assert req.tool_use_id == "tu-1"
        assert req.session_id == "sess-9"
        assert req.permission_mode == "acceptEdits"
        assert req.context == {"sandbox": "off"}

    def test_tool_name_required(self):
        with pytest.raises(ValidationError):
            ToolPermissionRequest()  # type: ignore[call-arg]

    def test_extra_fields_rejected(self):
        with pytest.raises(ValidationError):
            ToolPermissionRequest.model_validate(
                {"tool_name": "Read", "unexpected": True}
            )

    def test_round_trip(self):
        req = ToolPermissionRequest(
            tool_name="Edit",
            input={"file_path": "a.py", "old_string": "x", "new_string": "y"},
            tool_use_id="tu-7",
            permission_mode="plan",
        )
        dumped = req.model_dump()
        restored = ToolPermissionRequest.model_validate(dumped)
        assert restored == req

    def test_no_claude_sdk_imports(self):
        # The whole runtime/ package must not import the Claude SDK
        # (the point of being "neutral"). Walk every module's AST so a
        # future ``from claude_agent_sdk import X`` snuck into any file
        # under runtime/ — not just permissions.py — still trips this.
        import ast
        import pathlib

        import app.agent.runtime as runtime_pkg

        pkg_dir = pathlib.Path(runtime_pkg.__file__).parent
        sources = list(pkg_dir.glob("*.py"))
        assert sources, "runtime package has no python files"
        for path in sources:
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        assert "claude" not in alias.name.lower(), (
                            f"{path.name}: claude SDK import found"
                        )
                elif isinstance(node, ast.ImportFrom):
                    assert (
                        node.module is None
                        or "claude" not in node.module.lower()
                    ), f"{path.name}: claude SDK import found"


class TestToolPermissionResponse:
    def test_allow_minimal(self):
        resp = ToolPermissionResponse(behavior="allow")
        assert resp.behavior == "allow"
        assert resp.updated_input is None
        assert resp.message is None
        assert resp.interrupt is False

    def test_allow_with_updated_input(self):
        resp = ToolPermissionResponse(
            behavior="allow",
            updated_input={"command": "ls -la"},
        )
        assert resp.behavior == "allow"
        assert resp.updated_input == {"command": "ls -la"}

    def test_deny_with_message(self):
        resp = ToolPermissionResponse(
            behavior="deny",
            message="Not allowed in plan mode",
        )
        assert resp.behavior == "deny"
        assert resp.message == "Not allowed in plan mode"
        assert resp.interrupt is False

    def test_deny_with_interrupt(self):
        resp = ToolPermissionResponse(
            behavior="deny",
            message="User stopped",
            interrupt=True,
        )
        assert resp.interrupt is True

    def test_behavior_required(self):
        with pytest.raises(ValidationError):
            ToolPermissionResponse()  # type: ignore[call-arg]

    def test_behavior_must_be_allow_or_deny(self):
        with pytest.raises(ValidationError):
            ToolPermissionResponse(behavior="maybe")  # type: ignore[arg-type]

    def test_extra_fields_rejected(self):
        with pytest.raises(ValidationError):
            ToolPermissionResponse.model_validate(
                {"behavior": "allow", "unexpected": 1}
            )

    def test_round_trip_allow(self):
        resp = ToolPermissionResponse(
            behavior="allow",
            updated_input={"x": 1},
        )
        restored = ToolPermissionResponse.model_validate(resp.model_dump())
        assert restored == resp

    def test_round_trip_deny(self):
        resp = ToolPermissionResponse(
            behavior="deny",
            message="nope",
            interrupt=True,
        )
        restored = ToolPermissionResponse.model_validate(resp.model_dump())
        assert restored == resp


class TestPackageReexports:
    def test_runtime_package_reexports_neutral_types(self):
        from app.agent.runtime import (
            ToolPermissionRequest as ReqExport,
            ToolPermissionResponse as RespExport,
        )

        assert ReqExport is ToolPermissionRequest
        assert RespExport is ToolPermissionResponse
