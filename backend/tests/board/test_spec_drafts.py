from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

from app.board.service import BoardService
from app.board.spec_drafts import SpecDraftService
from app.core.config import load_config
from app.trash.service import TrashService


def _setup(tmp_path: Path) -> tuple[BoardService, SpecDraftService]:
    bonsai_dir = tmp_path / ".bonsai"
    bonsai_dir.mkdir()
    config = load_config(tmp_path)
    board_svc = BoardService(config)
    return board_svc, board_svc.spec_drafts


class TestPatchGeneration:
    async def test_apply_draft_creates_patch_file(self, tmp_path: Path) -> None:
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

        await draft_svc.apply_draft(ticket.id, 0, board_service=board_svc)

        patches_dir = tmp_path / ".bonsai" / "spec-patches" / ticket.id
        patch_files = list(patches_dir.glob("*.patch"))
        assert len(patch_files) == 1
        patch_content = patch_files[0].read_text()
        assert "+# Foo Module" in patch_content

    async def test_apply_draft_records_spec_patch_on_ticket(self, tmp_path: Path) -> None:
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

        await draft_svc.apply_draft(ticket.id, 0, board_service=board_svc)

        updated = board_svc.get_ticket(ticket.id)
        assert len(updated.spec_patches) == 1
        assert updated.spec_patches[0].spec_id == "mod-foo"
        assert updated.spec_patches[0].operation == "created"

    async def test_apply_draft_auto_links_spec(self, tmp_path: Path) -> None:
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

        await draft_svc.apply_draft(ticket.id, 0, board_service=board_svc)

        updated = board_svc.get_ticket(ticket.id)
        assert "mod-foo" in updated.linked_spec_ids
        assert updated.status == "specified"

    async def test_apply_all_generates_patches(self, tmp_path: Path) -> None:
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

        await draft_svc.apply_all(ticket.id, board_service=board_svc)

        updated = board_svc.get_ticket(ticket.id)
        assert len(updated.spec_patches) == 2


class TestDiscardDraftTrash:
    def test_discard_draft_uses_trash(self, tmp_path: Path) -> None:
        _, draft_svc = _setup(tmp_path)
        trash_svc = TrashService(project_root=tmp_path)
        draft_svc.trash_service = trash_svc

        draft_svc.write_draft(
            ticket_id="t1",
            real_path="spec.md",
            content="# Spec\n",
            operation="create",
        )

        draft_svc.discard_draft("t1", 0)

        # Draft file removed from drafts dir
        draft_file = tmp_path / ".bonsai" / "spec-drafts" / "t1" / "spec.md"
        assert not draft_file.exists()

        # Draft should be in trash
        trashed = trash_svc.list_trashed(item_type="drafts")
        assert len(trashed) == 1
        assert trashed[0]["id"] == "t1--0"

    def test_discard_draft_hard_deletes_without_trash(self, tmp_path: Path) -> None:
        _, draft_svc = _setup(tmp_path)
        # No trash_service injected

        draft_svc.write_draft(
            ticket_id="t2",
            real_path="spec.md",
            content="# Spec\n",
            operation="create",
        )

        draft_svc.discard_draft("t2", 0)

        draft_file = tmp_path / ".bonsai" / "spec-drafts" / "t2" / "spec.md"
        assert not draft_file.exists()


class TestDiscardAllTrash:
    def test_discard_all_uses_trash(self, tmp_path: Path) -> None:
        _, draft_svc = _setup(tmp_path)
        trash_svc = TrashService(project_root=tmp_path)
        draft_svc.trash_service = trash_svc

        draft_svc.write_draft(
            ticket_id="t3",
            real_path="a.md",
            content="# A\n",
            operation="create",
        )
        draft_svc.write_draft(
            ticket_id="t3",
            real_path="b.md",
            content="# B\n",
            operation="create",
        )

        draft_svc.discard_all("t3")

        trashed = trash_svc.list_trashed(item_type="drafts")
        assert len(trashed) == 2
        ids = {t["id"] for t in trashed}
        assert "t3--0" in ids
        assert "t3--1" in ids
