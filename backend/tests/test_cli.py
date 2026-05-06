"""Smoke tests for the trimmed-down ``app.cli`` module."""

from __future__ import annotations

import json
import sys

import pytest

from app import cli


class TestExportSchema:
    def test_export_schema_outputs_valid_json(
        self, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(sys, "argv", ["bonsai-cli", "export-schema"])
        cli.main()
        captured = capsys.readouterr()
        payload = json.loads(captured.out)
        assert "paths" in payload
        # OpenAPI documents always carry an info block too — sanity check.
        assert "info" in payload


class TestExportWsSchema:
    def test_export_ws_schema_outputs_valid_json(
        self, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(sys, "argv", ["bonsai-cli", "export-ws-schema"])
        cli.main()
        captured = capsys.readouterr()
        payload = json.loads(captured.out)
        # AgentEvent JSON Schema is a discriminated union — top-level
        # keys vary, but at minimum the top-level must be a dict.
        assert isinstance(payload, dict)


class TestRemovedSubcommands:
    """Ensure the auth subcommands are unrecognised and exit non-zero."""

    @pytest.mark.parametrize(
        "argv",
        [
            ["bonsai-cli", "create-user", "--id", "x", "--name", "y"],
            ["bonsai-cli", "list-users"],
            ["bonsai-cli", "set-admin", "--id", "x"],
            ["bonsai-cli", "delete-user", "--id", "x"],
        ],
    )
    def test_subcommand_rejected(
        self, argv: list[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(sys, "argv", argv)
        with pytest.raises(SystemExit) as excinfo:
            cli.main()
        # argparse exits with status 2 on "invalid choice".
        assert excinfo.value.code != 0
