import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.trash.service import TrashService


def _make_trash_service(tmp_path: Path) -> TrashService:
    return TrashService(project_root=tmp_path)


class TestTrashSession:
    def test_moves_session_files(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "s1.json").write_text('{"bonsaiSid": "s1", "name": "test"}')
        (sessions_dir / "s1.events.jsonl").write_text('{"e": 1}\n')

        svc = _make_trash_service(tmp_path)
        svc.trash_session("s1")

        assert not (sessions_dir / "s1.json").exists()
        assert not (sessions_dir / "s1.events.jsonl").exists()
        assert (tmp_path / ".bonsai" / "trash" / "sessions" / "s1" / "s1.json").exists()

    def test_trash_missing_session_is_noop(self, tmp_path: Path) -> None:
        svc = _make_trash_service(tmp_path)
        svc.trash_session("nonexistent")


class TestTrashTicket:
    def test_moves_ticket_file(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / ".bonsai" / "meta-tickets"
        tickets_dir.mkdir(parents=True)
        (tickets_dir / "t1.json").write_text('{"id": "t1", "title": "bug"}')

        svc = _make_trash_service(tmp_path)
        svc.trash_ticket("t1")

        assert not (tickets_dir / "t1.json").exists()
        assert (tmp_path / ".bonsai" / "trash" / "tickets" / "t1" / "t1.json").exists()


class TestRestoreSession:
    def test_restores_session(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "s2.json").write_text('{"name": "hi"}')

        svc = _make_trash_service(tmp_path)
        svc.trash_session("s2")
        svc.restore_session("s2")

        assert (sessions_dir / "s2.json").exists()

    def test_restore_missing_raises(self, tmp_path: Path) -> None:
        svc = _make_trash_service(tmp_path)
        with pytest.raises(FileNotFoundError):
            svc.restore_session("nope")


class TestRestoreTicket:
    def test_restores_ticket(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / ".bonsai" / "meta-tickets"
        tickets_dir.mkdir(parents=True)
        (tickets_dir / "t2.json").write_text('{"id": "t2"}')

        svc = _make_trash_service(tmp_path)
        svc.trash_ticket("t2")
        svc.restore_ticket("t2")

        assert (tickets_dir / "t2.json").exists()


class TestListAndPurge:
    def test_list_all(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "x.json").write_text("{}")
        tickets_dir = tmp_path / ".bonsai" / "meta-tickets"
        tickets_dir.mkdir(parents=True)
        (tickets_dir / "y.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("x")
        svc.trash_ticket("y")

        items = svc.list_trashed()
        assert len(items) == 2
        types = {i["type"] for i in items}
        assert types == {"sessions", "tickets"}

    def test_purge(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "p.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("p")
        svc.purge("sessions", "p")

        assert svc.list_trashed() == []

    def test_empty_trash(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        for sid in ["a", "b"]:
            (sessions_dir / f"{sid}.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("a")
        svc.trash_session("b")
        svc.empty_trash()
        assert svc.list_trashed() == []


class TestTrashSpec:
    def test_moves_spec_file_with_context(self, tmp_path: Path) -> None:
        spec_dir = tmp_path / "mod_a"
        spec_dir.mkdir(parents=True)
        spec_file = spec_dir / "README.md"
        spec_file.write_text("# Module A\n\nContent.")

        registry_entry = {"id": "mod-a", "type": "module-design", "path": "mod_a/README.md"}
        links = [{"from": "mod-a", "to": "design-doc", "type": "parent"}]

        svc = _make_trash_service(tmp_path)
        svc.trash_spec("mod-a", spec_file, registry_entry, links)

        assert not spec_file.exists()
        trash_item = tmp_path / ".bonsai" / "trash" / "specs" / "mod-a"
        assert (trash_item / "README.md").exists()

        sidecar = trash_item / "_trash.json"
        info = json.loads(sidecar.read_text())
        assert info["context"]["registryEntry"] == registry_entry
        assert info["context"]["links"] == links

    def test_restore_returns_context(self, tmp_path: Path) -> None:
        spec_dir = tmp_path / "mod_b"
        spec_dir.mkdir(parents=True)
        spec_file = spec_dir / "README.md"
        spec_file.write_text("# Module B")

        registry_entry = {"id": "mod-b", "type": "module-design"}
        links = [{"from": "mod-b", "to": "x", "type": "child"}]

        svc = _make_trash_service(tmp_path)
        svc.trash_spec("mod-b", spec_file, registry_entry, links)
        entry, restored_links = svc.restore_spec("mod-b")

        assert spec_file.exists()
        assert entry == registry_entry
        assert restored_links == links

    def test_trash_missing_spec_is_noop(self, tmp_path: Path) -> None:
        svc = _make_trash_service(tmp_path)
        missing = tmp_path / "nonexistent" / "README.md"
        svc.trash_spec("ghost", missing, {}, [])
        # No crash, no trashed items
        assert svc.list_trashed(item_type="specs") == []


class TestTrashPlan:
    def test_moves_plan_file(self, tmp_path: Path) -> None:
        plans_dir = tmp_path / ".bonsai" / "plans"
        plans_dir.mkdir(parents=True)
        plan_file = plans_dir / "t1.md"
        plan_file.write_text("# Plan for t1\n\nSteps here.")

        svc = _make_trash_service(tmp_path)
        svc.trash_plan("t1")

        assert not plan_file.exists()
        trash_item = tmp_path / ".bonsai" / "trash" / "plans" / "t1"
        assert (trash_item / "t1.md").exists()

    def test_restore_plan(self, tmp_path: Path) -> None:
        plans_dir = tmp_path / ".bonsai" / "plans"
        plans_dir.mkdir(parents=True)
        plan_file = plans_dir / "t2.md"
        plan_file.write_text("# Plan for t2")

        svc = _make_trash_service(tmp_path)
        svc.trash_plan("t2")
        assert not plan_file.exists()

        svc.restore_plan("t2")
        assert plan_file.exists()
        assert "# Plan for t2" in plan_file.read_text()

    def test_trash_missing_plan_is_noop(self, tmp_path: Path) -> None:
        svc = _make_trash_service(tmp_path)
        svc.trash_plan("nonexistent")
        assert svc.list_trashed(item_type="plans") == []


class TestTrashDraft:
    def test_moves_draft_with_manifest_context(self, tmp_path: Path) -> None:
        drafts_dir = tmp_path / ".bonsai" / "spec-drafts" / "t1"
        drafts_dir.mkdir(parents=True)
        draft_file = drafts_dir / "spec.md"
        draft_file.write_text("# Draft spec")

        manifest_entry = {
            "operation": "create",
            "realPath": "backend/spec.md",
            "draftPath": "spec.md",
        }

        svc = _make_trash_service(tmp_path)
        svc.trash_draft("t1", 0, manifest_entry=manifest_entry, draft_file=draft_file)

        assert not draft_file.exists()
        trash_item = tmp_path / ".bonsai" / "trash" / "drafts" / "t1--0"
        assert (trash_item / "_trash.json").exists()

        info = json.loads((trash_item / "_trash.json").read_text())
        assert info["context"]["manifestEntry"] == manifest_entry
        assert info["context"]["ticketId"] == "t1"

    def test_restore_draft_returns_manifest_entry(self, tmp_path: Path) -> None:
        drafts_dir = tmp_path / ".bonsai" / "spec-drafts" / "t2"
        drafts_dir.mkdir(parents=True)
        draft_file = drafts_dir / "spec.md"
        draft_file.write_text("# Draft")

        manifest_entry = {"operation": "update", "realPath": "mod/README.md"}

        svc = _make_trash_service(tmp_path)
        svc.trash_draft("t2", 0, manifest_entry=manifest_entry, draft_file=draft_file)
        result = svc.restore_draft("t2--0")

        assert result == manifest_entry

    def test_trash_draft_without_file(self, tmp_path: Path) -> None:
        """Delete-operation drafts may have no file on disk."""
        manifest_entry = {"operation": "delete", "realPath": "old/spec.md"}

        svc = _make_trash_service(tmp_path)
        svc.trash_draft("t3", 2, manifest_entry=manifest_entry, draft_file=None)

        trash_item = tmp_path / ".bonsai" / "trash" / "drafts" / "t3--2"
        assert (trash_item / "_trash.json").exists()
        info = json.loads((trash_item / "_trash.json").read_text())
        assert info["context"]["manifestEntry"] == manifest_entry


class TestTrashPatches:
    def test_moves_all_patch_files(self, tmp_path: Path) -> None:
        patches_dir = tmp_path / ".bonsai" / "spec-patches" / "t1"
        patches_dir.mkdir(parents=True)
        (patches_dir / "mod-a-20260101.patch").write_text("diff content 1")
        (patches_dir / "mod-b-20260102.patch").write_text("diff content 2")

        svc = _make_trash_service(tmp_path)
        svc.trash_patches("t1")

        assert not patches_dir.exists()
        trash_item = tmp_path / ".bonsai" / "trash" / "patches" / "t1"
        assert (trash_item / "mod-a-20260101.patch").exists()
        assert (trash_item / "mod-b-20260102.patch").exists()

    def test_restore_patches(self, tmp_path: Path) -> None:
        patches_dir = tmp_path / ".bonsai" / "spec-patches" / "t2"
        patches_dir.mkdir(parents=True)
        (patches_dir / "a.patch").write_text("diff a")

        svc = _make_trash_service(tmp_path)
        svc.trash_patches("t2")
        assert not patches_dir.exists()

        svc.restore_patches("t2")
        assert (patches_dir / "a.patch").exists()
        assert (patches_dir / "a.patch").read_text() == "diff a"

    def test_trash_missing_patches_is_noop(self, tmp_path: Path) -> None:
        svc = _make_trash_service(tmp_path)
        svc.trash_patches("nonexistent")
        assert svc.list_trashed(item_type="patches") == []


class TestCascadeTicket:
    def test_cascade_trashes_all_related(self, tmp_path: Path) -> None:
        # Create ticket
        tickets_dir = tmp_path / ".bonsai" / "meta-tickets"
        tickets_dir.mkdir(parents=True)
        (tickets_dir / "t1.json").write_text('{"id": "t1", "title": "bug"}')

        # Create plan
        plans_dir = tmp_path / ".bonsai" / "plans"
        plans_dir.mkdir(parents=True)
        (plans_dir / "t1.md").write_text("# Plan")

        # Create drafts with manifest
        drafts_dir = tmp_path / ".bonsai" / "spec-drafts" / "t1"
        drafts_dir.mkdir(parents=True)
        draft_file = drafts_dir / "mod_a" / "README.md"
        draft_file.parent.mkdir(parents=True)
        draft_file.write_text("# Draft A")
        manifest = {
            "ticketId": "t1",
            "sessionId": "",
            "created": "2026-01-01",
            "entries": [
                {
                    "operation": "create",
                    "realPath": "mod_a/README.md",
                    "draftPath": "mod_a/README.md",
                    "registryId": "",
                    "registryType": "",
                    "registryTitle": "",
                    "registryCovers": [],
                    "registryTags": [],
                    "created": "2026-01-01",
                }
            ],
        }
        (drafts_dir / "manifest.json").write_text(json.dumps(manifest))

        # Create patches
        patches_dir = tmp_path / ".bonsai" / "spec-patches" / "t1"
        patches_dir.mkdir(parents=True)
        (patches_dir / "a.patch").write_text("diff")

        svc = _make_trash_service(tmp_path)
        svc.trash_ticket("t1", cascade=True)

        # Ticket file moved
        assert not (tickets_dir / "t1.json").exists()
        # Plan moved
        assert not (plans_dir / "t1.md").exists()
        # Patches moved
        assert not patches_dir.exists()

        # Verify ticket context has cascaded list
        trash_ticket = tmp_path / ".bonsai" / "trash" / "tickets" / "t1" / "_trash.json"
        info = json.loads(trash_ticket.read_text())
        cascaded = info["context"]["cascaded"]
        assert "plans/t1" in cascaded
        assert any("patches/t1" in c for c in cascaded)
        assert any("drafts/t1" in c for c in cascaded)

    def test_no_cascade_only_trashes_ticket(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / ".bonsai" / "meta-tickets"
        tickets_dir.mkdir(parents=True)
        (tickets_dir / "t2.json").write_text('{"id": "t2"}')

        plans_dir = tmp_path / ".bonsai" / "plans"
        plans_dir.mkdir(parents=True)
        (plans_dir / "t2.md").write_text("# Plan")

        svc = _make_trash_service(tmp_path)
        svc.trash_ticket("t2", cascade=False)

        assert not (tickets_dir / "t2.json").exists()
        # Plan should still be there
        assert (plans_dir / "t2.md").exists()


class TestAutoPurge:
    def _set_trashed_at(self, trash_dir: Path, item_type: str, item_id: str, dt: datetime) -> None:
        """Overwrite the trashedAt timestamp in _trash.json."""
        sidecar = trash_dir / item_type / item_id / "_trash.json"
        info = json.loads(sidecar.read_text())
        info["trashedAt"] = dt.isoformat()
        sidecar.write_text(json.dumps(info))

    def test_purges_old_items(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "old.json").write_text("{}")
        (sessions_dir / "new.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("old")
        svc.trash_session("new")

        trash_dir = tmp_path / ".bonsai" / "trash"
        old_date = datetime.now(UTC) - timedelta(days=31)
        self._set_trashed_at(trash_dir, "sessions", "old", old_date)

        purged = svc.auto_purge(30)

        assert purged == 1
        # Old item is gone
        assert not (trash_dir / "sessions" / "old").exists()
        # New item retained
        assert (trash_dir / "sessions" / "new").exists()

    def test_retains_recent_items(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "recent.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("recent")

        purged = svc.auto_purge(30)
        assert purged == 0
        assert (tmp_path / ".bonsai" / "trash" / "sessions" / "recent").exists()

    def test_zero_retention_skips(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "x.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("x")

        trash_dir = tmp_path / ".bonsai" / "trash"
        old_date = datetime.now(UTC) - timedelta(days=999)
        self._set_trashed_at(trash_dir, "sessions", "x", old_date)

        purged = svc.auto_purge(0)
        assert purged == 0
        # Item still there despite being very old
        assert (trash_dir / "sessions" / "x").exists()
