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
        monkeypatch.setattr(sys, "argv", ["thinkrail-cli", "export-schema"])
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
        monkeypatch.setattr(sys, "argv", ["thinkrail-cli", "export-ws-schema"])
        cli.main()
        captured = capsys.readouterr()
        payload = json.loads(captured.out)
        # AgentEvent JSON Schema is a discriminated union — top-level
        # keys vary, but at minimum the top-level must be a dict.
        assert isinstance(payload, dict)


class TestExportRpcSchema:
    def test_export_rpc_schema_outputs_curated_models(
        self, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(sys, "argv", ["thinkrail-cli", "export-rpc-schema"])
        cli.main()
        captured = capsys.readouterr()
        payload = json.loads(captured.out)
        # Top-level anyOf references each curated model under $defs so
        # json2ts emits one interface per model.
        assert "anyOf" in payload
        defs = payload["$defs"]
        for name in ("LabeledOption", "RuntimeCapabilities", "RuntimeIdentity"):
            assert name in defs
        # camelCase aliases drive the generated field names.
        assert "permissionModes" in defs["RuntimeCapabilities"]["properties"]


class TestRemovedSubcommands:
    """Ensure the auth subcommands are unrecognised and exit non-zero."""

    @pytest.mark.parametrize(
        "argv",
        [
            ["thinkrail-cli", "create-user", "--id", "x", "--name", "y"],
            ["thinkrail-cli", "list-users"],
            ["thinkrail-cli", "set-admin", "--id", "x"],
            ["thinkrail-cli", "delete-user", "--id", "x"],
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
