from __future__ import annotations

from pathlib import Path

import pytest

from app.board.service import BoardService
from app.core.config import AppConfig


@pytest.fixture(autouse=True)
def _isolate_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_dir = tmp_path / ".thinkrail_server"
    data_dir.mkdir()
    monkeypatch.setattr("app.core.config.get_data_dir", lambda: data_dir)


def _config(tmp_path: Path) -> AppConfig:
    thinkrail_dir = tmp_path / ".tr"
    thinkrail_dir.mkdir(exist_ok=True)
    return AppConfig(project_root=tmp_path, thinkrail_dir=thinkrail_dir, plugin_dir=tmp_path)


class TestSyncArtifactBookkeeping:
    def test_sync_sets_path_and_body_after_external_edit(self, tmp_path: Path) -> None:
        svc = BoardService(_config(tmp_path))
        ticket = svc.create_ticket(title="T")
        p = tmp_path / ".tr" / "tickets" / ticket.id / "product-design.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("# PD\n\nThe product solves X.\n")

        svc.sync_artifact_bookkeeping(ticket.id, "product_design")

        refreshed = svc.get_ticket(ticket.id)
        assert refreshed.product_design_path == f".tr/tickets/{ticket.id}/product-design.md"
        assert refreshed.body == "The product solves X."

    def test_sync_is_noop_when_file_absent(self, tmp_path: Path) -> None:
        svc = BoardService(_config(tmp_path))
        ticket = svc.create_ticket(title="T")
        svc.sync_artifact_bookkeeping(ticket.id, "technical_design")
        assert svc.get_ticket(ticket.id).technical_design_path is None
