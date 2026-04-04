from __future__ import annotations

import json
from pathlib import Path

from app.board.service import BoardService
from app.board.spec_drafts import SpecDraftService
from app.core.config import load_config


def _setup(tmp_path: Path) -> tuple[BoardService, SpecDraftService]:
    specs_dir = tmp_path / ".specs"
    specs_dir.mkdir()
    reg = {"version": "2.0", "project": "test", "specs": [], "links": []}
    (specs_dir / "registry.json").write_text(json.dumps(reg), encoding="utf-8")
    config = load_config(tmp_path)
    board_svc = BoardService(config)
    return board_svc, board_svc.spec_drafts


class TestPatchGeneration:
    def test_apply_draft_creates_patch_file(self, tmp_path: Path) -> None:
        board_svc, draft_svc = _setup(tmp_path)
        ticket = board_svc.create_ticket("Test")

        draft_svc.write_draft(
            ticket_id=ticket.id,
            real_path="backend/app/foo/README.md",
            content="# Foo Module\n\nNew spec content.\n",
            operation="create",
            registry_id="mod-foo",
            registry_type="module-design",
            registry_title="Foo Module",
        )

        draft_svc.apply_draft(ticket.id, 0, board_service=board_svc)

        patches_dir = tmp_path / ".bonsai" / "spec-patches" / ticket.id
        patch_files = list(patches_dir.glob("*.patch"))
        assert len(patch_files) == 1
        patch_content = patch_files[0].read_text()
        assert "+# Foo Module" in patch_content

    def test_apply_draft_records_spec_patch_on_ticket(self, tmp_path: Path) -> None:
        board_svc, draft_svc = _setup(tmp_path)
        ticket = board_svc.create_ticket("Test")

        draft_svc.write_draft(
            ticket_id=ticket.id,
            real_path="backend/app/foo/README.md",
            content="# Foo\n",
            operation="create",
            registry_id="mod-foo",
            registry_type="module-design",
            registry_title="Foo",
        )

        draft_svc.apply_draft(ticket.id, 0, board_service=board_svc)

        updated = board_svc.get_ticket(ticket.id)
        assert len(updated.spec_patches) == 1
        assert updated.spec_patches[0].spec_id == "mod-foo"
        assert updated.spec_patches[0].operation == "created"

    def test_apply_draft_auto_links_spec(self, tmp_path: Path) -> None:
        board_svc, draft_svc = _setup(tmp_path)
        ticket = board_svc.create_ticket("Test")
        board_svc.update_ticket(ticket.id, status="described")

        draft_svc.write_draft(
            ticket_id=ticket.id,
            real_path="backend/app/foo/README.md",
            content="# Foo\n",
            operation="create",
            registry_id="mod-foo",
            registry_type="module-design",
            registry_title="Foo",
        )

        draft_svc.apply_draft(ticket.id, 0, board_service=board_svc)

        updated = board_svc.get_ticket(ticket.id)
        assert "mod-foo" in updated.linked_spec_ids
        assert updated.status == "specified"

    def test_apply_all_generates_patches(self, tmp_path: Path) -> None:
        board_svc, draft_svc = _setup(tmp_path)
        ticket = board_svc.create_ticket("Test")

        draft_svc.write_draft(
            ticket_id=ticket.id, real_path="a.md", content="# A\n",
            operation="create", registry_id="a", registry_type="module-design",
            registry_title="A",
        )
        draft_svc.write_draft(
            ticket_id=ticket.id, real_path="b.md", content="# B\n",
            operation="create", registry_id="b", registry_type="module-design",
            registry_title="B",
        )

        draft_svc.apply_all(ticket.id, board_service=board_svc)

        updated = board_svc.get_ticket(ticket.id)
        assert len(updated.spec_patches) == 2
