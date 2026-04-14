# Subsession Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add branched "subsessions" that inherit parent conversation context and return summaries/refined content back to the parent session.

**Architecture:** Thin wrapper — subsession = regular `AgentTask` + 5 new fields (`parent_bonsai_sid`, `subsession_type`, `subsession_context`, `return_status`, `return_summary`). Context injected via system prompt. Return flow uses an agent-propose → user-review loop. No new entity types or services.

**Tech Stack:** Python/FastAPI (backend), TypeScript/React/Zustand (frontend), pytest, vitest

**Design Doc:** `.bonsai/design_docs/SUBSESSION_DESIGN.md`

---

## File Structure

### Backend (create/modify)

| File | Responsibility |
|------|---------------|
| `backend/app/agent/models.py` | **Modify** — Add `SubsessionType` enum + 5 fields to `AgentTask` |
| `backend/app/agent/persistence.py` | **Modify** — Add `list_children()` helper |
| `backend/app/agent/context.py` | **Modify** — Add `build_parent_context()` + new system prompt section |
| `backend/app/agent/service.py` | **Modify** — Add `create_subsession()`, summary flow methods |
| `backend/app/rpc/methods/subsessions.py` | **Create** — RPC handlers for `subsession/*` namespace |
| `backend/app/rpc/server.py` | **Modify** — Register subsession RPC methods in METHODS dict + _bind_methods |
| `backend/tests/agent/test_subsession.py` | **Create** — Tests for subsession model, context, service, persistence |
| `backend/tests/rpc/test_methods_subsessions.py` | **Create** — Tests for subsession RPC handlers |

### Frontend (create/modify)

| File | Responsibility |
|------|---------------|
| `frontend/src/types/session.ts` | **Modify** — Add 5 fields to `Session` interface |
| `frontend/src/api/methods/subsessions.ts` | **Create** — RPC wrappers for `subsession/*` |
| `frontend/src/store/sessionStore.ts` | **Modify** — Add subsession actions + parent pause logic |
| `frontend/src/components/SessionPanel/SessionTabBar.tsx` | **Modify** — Tree ordering, `↳` prefix, type icons, dim paused |
| `frontend/src/components/ChatStream/ReturnFlowCard.tsx` | **Create** — Summary review card (approve/edit/revise/dismiss) |
| `frontend/src/components/ChatStream/SubsessionResultCard.tsx` | **Create** — Returned summary display in parent |
| `frontend/src/components/ChatStream/SubsessionContextMenu.tsx` | **Create** — Right-click text selection menu |
| `frontend/src/components/ChatStream/ChatStream.tsx` | **Modify** — Render new card types |
| `frontend/src/components/ChatStream/QuestionCard.tsx` | **Modify** — Add "Discuss first" button |
| `frontend/src/components/ChatStream/InputArea.tsx` | **Modify** — `/discuss` command + voice "Revise" button |

---

## Task 1: Backend Data Model

**Files:**
- Modify: `backend/app/agent/models.py`
- Test: `backend/tests/agent/test_subsession.py`

- [ ] **Step 1: Create test file with model tests**

Create `backend/tests/agent/test_subsession.py`:

```python
from __future__ import annotations

import pytest
from app.agent.models import AgentTask, SubsessionType


class TestSubsessionType:
    def test_enum_values(self) -> None:
        assert SubsessionType.discussion == "discussion"
        assert SubsessionType.refinement == "refinement"

    def test_enum_from_string(self) -> None:
        assert SubsessionType("discussion") is SubsessionType.discussion
        assert SubsessionType("refinement") is SubsessionType.refinement


class TestAgentTaskSubsessionFields:
    def test_defaults_are_none(self) -> None:
        task = AgentTask()
        assert task.parent_bonsai_sid is None
        assert task.subsession_type is None
        assert task.subsession_context is None
        assert task.return_status is None
        assert task.return_summary is None

    def test_set_subsession_fields(self) -> None:
        task = AgentTask(
            parent_bonsai_sid="parent-123",
            subsession_type=SubsessionType.discussion,
            subsession_context="selected text here",
        )
        assert task.parent_bonsai_sid == "parent-123"
        assert task.subsession_type == SubsessionType.discussion
        assert task.subsession_context == "selected text here"

    def test_camel_case_serialization(self) -> None:
        task = AgentTask(
            parent_bonsai_sid="p-1",
            subsession_type=SubsessionType.refinement,
            subsession_context="voice transcript",
            return_status="pending",
            return_summary="cleaned up text",
        )
        data = task.model_dump(by_alias=True)
        assert data["parentBonsaiSid"] == "p-1"
        assert data["subsessionType"] == "refinement"
        assert data["subsessionContext"] == "voice transcript"
        assert data["returnStatus"] == "pending"
        assert data["returnSummary"] == "cleaned up text"

    def test_is_subsession_property(self) -> None:
        regular = AgentTask()
        assert regular.parent_bonsai_sid is None

        sub = AgentTask(parent_bonsai_sid="p-1", subsession_type=SubsessionType.discussion)
        assert sub.parent_bonsai_sid is not None
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend && uv run pytest tests/agent/test_subsession.py -v
```

Expected: FAIL — `SubsessionType` not found.

- [ ] **Step 3: Add SubsessionType enum and fields to AgentTask**

In `backend/app/agent/models.py`, add after the `TaskStatus` literal:

```python
class SubsessionType(str, Enum):
    """Type of subsession — determines return flow behavior."""
    discussion = "discussion"
    refinement = "refinement"
```

Add import `from enum import Enum` at the top.

Then add these fields to the `AgentTask` class (after `updated`):

```python
    parent_bonsai_sid: str | None = None
    subsession_type: SubsessionType | None = None
    subsession_context: str | None = None
    return_status: str | None = None
    return_summary: str | None = None
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && uv run pytest tests/agent/test_subsession.py -v
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd backend && uv run pytest -x -q
```

Expected: All existing tests PASS (new fields have `None` defaults).

- [ ] **Step 6: Commit**

```bash
git add backend/app/agent/models.py backend/tests/agent/test_subsession.py
git commit -m "feat(subsession): add SubsessionType enum and fields to AgentTask"
```

---

## Task 2: Backend Persistence — list_children helper

**Files:**
- Modify: `backend/app/agent/persistence.py`
- Test: `backend/tests/agent/test_subsession.py`

- [ ] **Step 1: Add persistence tests**

Append to `backend/tests/agent/test_subsession.py`:

```python
import json
from pathlib import Path
from app.agent.persistence import list_children, save_session, load_session


class TestListChildren:
    def test_returns_empty_for_no_children(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        result = list_children(tmp_path, "parent-1")
        assert result == []

    def test_returns_matching_children(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)

        # Parent session
        save_session(tmp_path, {
            "bonsaiSid": "parent-1",
            "name": "Main",
            "status": "idle",
        })

        # Child session
        save_session(tmp_path, {
            "bonsaiSid": "child-1",
            "name": "Discuss auth",
            "status": "done",
            "parentBonsaiSid": "parent-1",
            "subsessionType": "discussion",
        })

        # Unrelated session
        save_session(tmp_path, {
            "bonsaiSid": "other-1",
            "name": "Other",
            "status": "done",
        })

        children = list_children(tmp_path, "parent-1")
        assert len(children) == 1
        assert children[0]["bonsaiSid"] == "child-1"

    def test_does_not_return_grandchildren(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)

        save_session(tmp_path, {
            "bonsaiSid": "child-1",
            "parentBonsaiSid": "parent-1",
            "name": "Child",
            "status": "done",
        })
        save_session(tmp_path, {
            "bonsaiSid": "grandchild-1",
            "parentBonsaiSid": "child-1",
            "name": "Grandchild",
            "status": "done",
        })

        children = list_children(tmp_path, "parent-1")
        assert len(children) == 1
        assert children[0]["bonsaiSid"] == "child-1"
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend && uv run pytest tests/agent/test_subsession.py::TestListChildren -v
```

Expected: FAIL — `list_children` not found.

- [ ] **Step 3: Implement list_children**

Add to `backend/app/agent/persistence.py`:

```python
def list_children(project_root: Path, parent_bonsai_sid: str) -> list[dict[str, Any]]:
    """List direct child subsessions of a parent session (metadata only)."""
    sessions_dir = project_root / ".bonsai" / "sessions"
    if not sessions_dir.is_dir():
        return []
    children = []
    for fpath in sessions_dir.glob("*.json"):
        if fpath.name.endswith(".events.jsonl"):
            continue
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if data.get("parentBonsaiSid") == parent_bonsai_sid:
            children.append(data)
    return children
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && uv run pytest tests/agent/test_subsession.py::TestListChildren -v
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/persistence.py backend/tests/agent/test_subsession.py
git commit -m "feat(subsession): add list_children persistence helper"
```

---

## Task 3: Backend Context Injection

**Files:**
- Modify: `backend/app/agent/context.py`
- Test: `backend/tests/agent/test_subsession.py`

- [ ] **Step 1: Add context injection tests**

Append to `backend/tests/agent/test_subsession.py`:

```python
from app.agent.context import build_parent_context
from app.agent.persistence import save_session, append_event


class TestBuildParentContext:
    def test_builds_context_from_parent_events(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)

        save_session(tmp_path, {
            "bonsaiSid": "parent-1",
            "name": "Main",
            "status": "idle",
        })
        append_event(tmp_path, "parent-1", {
            "eventType": "userMessage",
            "payload": {"text": "What auth should we use?"},
        })
        append_event(tmp_path, "parent-1", {
            "eventType": "textDelta",
            "payload": {"text": "I recommend JWT tokens."},
        })
        append_event(tmp_path, "parent-1", {
            "eventType": "turnComplete",
            "payload": {},
        })

        result = build_parent_context(
            parent_sid="parent-1",
            subsession_type=SubsessionType.discussion,
            subsession_context="JWT tokens",
            project_root=tmp_path,
        )

        assert "Parent Session Context" in result
        assert "What auth should we use?" in result
        assert "I recommend JWT tokens." in result
        assert "JWT tokens" in result
        assert "discussion" in result.lower() or "discuss" in result.lower()

    def test_context_for_refinement_type(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)

        save_session(tmp_path, {
            "bonsaiSid": "parent-1",
            "name": "Main",
            "status": "idle",
        })

        result = build_parent_context(
            parent_sid="parent-1",
            subsession_type=SubsessionType.refinement,
            subsession_context="so basically i want the thing to handle auth",
            project_root=tmp_path,
        )

        assert "refine" in result.lower()
        assert "so basically i want the thing to handle auth" in result

    def test_truncates_long_conversations(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)

        save_session(tmp_path, {
            "bonsaiSid": "parent-1",
            "name": "Main",
            "status": "idle",
        })

        # Add many events to exceed 4000 char limit
        for i in range(50):
            append_event(tmp_path, "parent-1", {
                "eventType": "userMessage",
                "payload": {"text": f"Message {i}: " + "x" * 100},
            })
            append_event(tmp_path, "parent-1", {
                "eventType": "textDelta",
                "payload": {"text": f"Response {i}: " + "y" * 100},
            })
            append_event(tmp_path, "parent-1", {
                "eventType": "turnComplete",
                "payload": {},
            })

        result = build_parent_context(
            parent_sid="parent-1",
            subsession_type=SubsessionType.discussion,
            subsession_context=None,
            project_root=tmp_path,
        )

        # Should be truncated but contain recent messages
        assert len(result) < 8000
        assert "Message 49" in result  # Most recent should be kept

    def test_no_parent_events_returns_minimal_context(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)

        save_session(tmp_path, {
            "bonsaiSid": "parent-1",
            "name": "Main",
            "status": "idle",
        })

        result = build_parent_context(
            parent_sid="parent-1",
            subsession_type=SubsessionType.discussion,
            subsession_context="some topic",
            project_root=tmp_path,
        )

        assert "Parent Session Context" in result
        assert "some topic" in result
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend && uv run pytest tests/agent/test_subsession.py::TestBuildParentContext -v
```

Expected: FAIL — `build_parent_context` not found.

- [ ] **Step 3: Implement build_parent_context**

Add to `backend/app/agent/context.py`:

```python
from app.agent.persistence import load_events


_MAX_CONTEXT_CHARS = 4000


def build_parent_context(
    parent_sid: str,
    subsession_type: "SubsessionType",
    subsession_context: str | None,
    project_root: Path,
) -> str:
    """Build system prompt section with parent conversation context.

    Summarizes parent events into a condensed transcript and wraps it
    with subsession-type-specific instructions. Truncates if the
    transcript exceeds _MAX_CONTEXT_CHARS, keeping the most recent turns.
    """
    from app.agent.models import SubsessionType  # avoid circular import

    events = load_events(project_root, parent_sid)
    transcript = _extract_transcript(events)

    if len(transcript) > _MAX_CONTEXT_CHARS:
        transcript = _truncate_transcript(transcript, _MAX_CONTEXT_CHARS)

    if subsession_type == SubsessionType.refinement:
        role_text = (
            "Help refine the provided content. When the user is satisfied, "
            "propose the final version to bring back to the parent session."
        )
        purpose = "refine content"
    else:
        role_text = (
            "Discuss the topic thoroughly. When the user is satisfied, "
            "propose a concise summary to bring back to the parent session."
        )
        purpose = "discuss a topic"

    sections = [f"## Parent Session Context\n\nYou are in a subsession branched from a parent conversation.\nThe user wants to {purpose} without polluting the main session."]

    if transcript.strip():
        sections.append(f"### Parent Conversation:\n{transcript}")

    if subsession_context:
        sections.append(f"### Focus:\n{subsession_context}")

    sections.append(f"### Your Role:\n{role_text}")

    return "\n\n".join(sections)


def _extract_transcript(events: list[dict]) -> str:
    """Extract user messages and assistant text from events into a transcript."""
    turns: list[str] = []
    current_assistant_text: list[str] = []

    for ev in events:
        event_type = ev.get("eventType", "")
        payload = ev.get("payload", {})

        if event_type == "userMessage":
            # Flush any accumulated assistant text
            if current_assistant_text:
                turns.append("**Assistant:** " + "".join(current_assistant_text))
                current_assistant_text = []
            turns.append("**User:** " + payload.get("text", ""))

        elif event_type == "textDelta":
            current_assistant_text.append(payload.get("text", ""))

        elif event_type == "turnComplete":
            if current_assistant_text:
                turns.append("**Assistant:** " + "".join(current_assistant_text))
                current_assistant_text = []

    # Flush trailing assistant text
    if current_assistant_text:
        turns.append("**Assistant:** " + "".join(current_assistant_text))

    return "\n\n".join(turns)


def _truncate_transcript(transcript: str, max_chars: int) -> str:
    """Keep the most recent turns that fit within max_chars."""
    parts = transcript.split("\n\n")
    result: list[str] = []
    total = 0
    for part in reversed(parts):
        if total + len(part) + 2 > max_chars and result:
            break
        result.append(part)
        total += len(part) + 2  # +2 for "\n\n" separator
    result.reverse()
    if len(result) < len(parts):
        return "[Earlier conversation truncated]\n\n" + "\n\n".join(result)
    return "\n\n".join(result)
```

Also add `load_events` to persistence if it doesn't exist. Check if it exists first — if `load_session` already returns events, we can extract from there. The function should be:

```python
def load_events(project_root: Path, bonsai_sid: str) -> list[dict[str, Any]]:
    """Load events from a session's .events.jsonl file."""
    events_path = project_root / ".bonsai" / "sessions" / f"{bonsai_sid}.events.jsonl"
    if not events_path.exists():
        return []
    events = []
    for line in events_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events
```

Check if this already exists in `persistence.py` — it may be inlined in `load_session()`. If it exists, import and reuse it. If not, add it.

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && uv run pytest tests/agent/test_subsession.py::TestBuildParentContext -v
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/context.py backend/app/agent/persistence.py backend/tests/agent/test_subsession.py
git commit -m "feat(subsession): add build_parent_context for system prompt injection"
```

---

## Task 4: Backend Service — create_subsession

**Files:**
- Modify: `backend/app/agent/service.py`
- Test: `backend/tests/agent/test_subsession.py`

- [ ] **Step 1: Add service tests**

Append to `backend/tests/agent/test_subsession.py`:

```python
from unittest.mock import MagicMock, patch, AsyncMock
from app.agent.service import AgentService
from app.agent.models import AgentConfig
from app.core.config import AppConfig


def _make_service(tmp_path: Path) -> tuple[AgentService, MagicMock]:
    config = MagicMock(spec=AppConfig)
    config.project_root = tmp_path
    config.get_registry_path.return_value = tmp_path / ".bonsai" / "registry.json"
    config.plugin_dir = None
    spec_service = MagicMock()
    spec_service.get_spec.return_value = None

    # Create sessions dir
    (tmp_path / ".bonsai" / "sessions").mkdir(parents=True, exist_ok=True)

    service = AgentService(config, spec_service)
    return service, spec_service


class TestCreateSubsession:
    def test_creates_subsession_with_parent_link(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)

        # Create parent task first
        parent = service.prepare_task([], AgentConfig(), name="Main session")

        sub = service.create_subsession(
            parent_bonsai_sid=parent.bonsai_sid,
            subsession_type=SubsessionType.discussion,
            context="JWT vs sessions",
            name="Discuss auth",
        )

        assert sub.parent_bonsai_sid == parent.bonsai_sid
        assert sub.subsession_type == SubsessionType.discussion
        assert sub.subsession_context == "JWT vs sessions"
        assert sub.name == "Discuss auth"
        assert sub.status == "draft"

    def test_inherits_parent_specs_and_config(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)

        parent = service.prepare_task(
            ["spec-1", "spec-2"],
            AgentConfig(model="claude-opus-4-6"),
            name="Main",
        )

        sub = service.create_subsession(
            parent_bonsai_sid=parent.bonsai_sid,
            subsession_type=SubsessionType.discussion,
        )

        assert sub.spec_ids == parent.spec_ids
        assert sub.config.model == parent.config.model

    def test_raises_for_nonexistent_parent(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)

        with pytest.raises(ValueError, match="not found"):
            service.create_subsession(
                parent_bonsai_sid="nonexistent",
                subsession_type=SubsessionType.discussion,
            )
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend && uv run pytest tests/agent/test_subsession.py::TestCreateSubsession -v
```

Expected: FAIL — `create_subsession` not found.

- [ ] **Step 3: Implement create_subsession on AgentService**

Add to `backend/app/agent/service.py`:

```python
from app.agent.models import SubsessionType
from app.agent.context import build_parent_context

def create_subsession(
    self,
    parent_bonsai_sid: str,
    subsession_type: SubsessionType,
    context: str | None = None,
    name: str = "",
) -> AgentTask:
    """Create a draft subsession linked to a parent session.

    Inherits specs and config from the parent. Injects parent conversation
    context into the system prompt.
    """
    # Validate parent exists
    parent = self._tracker.get_task(parent_bonsai_sid)
    if parent is None:
        # Try loading from disk
        from app.agent.persistence import load_session
        parent_data = load_session(self._config.project_root, parent_bonsai_sid)
        if parent_data is None:
            raise ValueError(f"Parent session {parent_bonsai_sid!r} not found")
        parent_spec_ids = parent_data.get("specIds", [])
        parent_config = AgentConfig(**parent_data.get("config", {}))
    else:
        parent_spec_ids = parent.spec_ids
        parent_config = parent.config

    # Create subsession task
    task = self._tracker.create_task(
        spec_ids=parent_spec_ids,
        config=AgentConfig(**parent_config.model_dump()),
        name=name,
    )
    task.parent_bonsai_sid = parent_bonsai_sid
    task.subsession_type = subsession_type
    task.subsession_context = context
    task.status = "draft"

    # Build system prompt with parent context
    parent_context = build_parent_context(
        parent_sid=parent_bonsai_sid,
        subsession_type=subsession_type,
        subsession_context=context,
        project_root=self._config.project_root,
    )
    task.session_prompt = parent_context
    task.system_prompt = self._build_context_for(task)

    self._save_task(task)
    return task
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && uv run pytest tests/agent/test_subsession.py::TestCreateSubsession -v
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/service.py backend/tests/agent/test_subsession.py
git commit -m "feat(subsession): add create_subsession to AgentService"
```

---

## Task 5: Backend Service — Return Flow Methods

**Files:**
- Modify: `backend/app/agent/service.py`
- Test: `backend/tests/agent/test_subsession.py`

- [ ] **Step 1: Add return flow tests**

Append to `backend/tests/agent/test_subsession.py`:

```python
class TestReturnFlow:
    def test_request_summary_sends_message(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)
        parent = service.prepare_task([], AgentConfig(), name="Main")
        sub = service.create_subsession(
            parent_bonsai_sid=parent.bonsai_sid,
            subsession_type=SubsessionType.discussion,
        )
        # Mark as idle so we can send messages
        service._tracker.set_status(sub.bonsai_sid, "initializing")
        service._tracker.set_status(sub.bonsai_sid, "idle")

        service.request_summary(sub.bonsai_sid)

        assert sub.return_status == "pending"

    def test_approve_summary_stores_text(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)
        parent = service.prepare_task([], AgentConfig(), name="Main")
        sub = service.create_subsession(
            parent_bonsai_sid=parent.bonsai_sid,
            subsession_type=SubsessionType.discussion,
        )

        service.approve_summary(sub.bonsai_sid, "Decision: use JWT")

        assert sub.return_status == "approved"
        assert sub.return_summary == "Decision: use JWT"

    def test_dismiss_summary_sets_dismissed(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)
        parent = service.prepare_task([], AgentConfig(), name="Main")
        sub = service.create_subsession(
            parent_bonsai_sid=parent.bonsai_sid,
            subsession_type=SubsessionType.discussion,
        )

        service.dismiss_summary(sub.bonsai_sid)

        assert sub.return_status == "dismissed"
        assert sub.return_summary is None

    def test_approve_for_nonexistent_raises(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)
        with pytest.raises(Exception):
            service.approve_summary("nonexistent", "text")
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend && uv run pytest tests/agent/test_subsession.py::TestReturnFlow -v
```

Expected: FAIL — `request_summary`, `approve_summary`, `dismiss_summary` not found.

- [ ] **Step 3: Implement return flow methods**

Add to `backend/app/agent/service.py`:

```python
def request_summary(self, bonsai_sid: str) -> None:
    """Ask the subsession agent to propose a return summary.

    Enqueues a system message prompting the agent to summarize.
    """
    task = self._tracker.get_task(bonsai_sid)
    task.return_status = "pending"
    task.updated = datetime.now(UTC).isoformat()
    self._save_task(task)

    if task.status in ("initializing", "idle"):
        summary_prompt = (
            "Please summarize the key conclusions from our discussion. "
            "Write a concise summary that captures the decision, rationale, "
            "and any action items. This will be sent back to the parent session."
        )
        self._tracker.enqueue_message(bonsai_sid, summary_prompt)

def approve_summary(self, bonsai_sid: str, text: str) -> None:
    """Approve a return summary for the subsession."""
    task = self._tracker.get_task(bonsai_sid)
    task.return_status = "approved"
    task.return_summary = text
    task.updated = datetime.now(UTC).isoformat()
    self._save_task(task)

def dismiss_summary(self, bonsai_sid: str) -> None:
    """Dismiss the return flow — close subsession without returning anything."""
    task = self._tracker.get_task(bonsai_sid)
    task.return_status = "dismissed"
    task.return_summary = None
    task.updated = datetime.now(UTC).isoformat()
    self._save_task(task)

def revise_summary(self, bonsai_sid: str, feedback: str) -> None:
    """Ask the subsession agent to rewrite the summary with feedback."""
    task = self._tracker.get_task(bonsai_sid)
    task.return_status = "pending"
    task.updated = datetime.now(UTC).isoformat()
    self._save_task(task)

    if task.status in ("initializing", "idle"):
        revision_prompt = (
            f"Please revise the summary based on this feedback:\n\n{feedback}"
        )
        self._tracker.enqueue_message(bonsai_sid, revision_prompt)
```

Add `from datetime import UTC, datetime` import if not already present.

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && uv run pytest tests/agent/test_subsession.py::TestReturnFlow -v
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/service.py backend/tests/agent/test_subsession.py
git commit -m "feat(subsession): add return flow methods (request/approve/dismiss/revise summary)"
```

---

## Task 6: Backend RPC Handlers

**Files:**
- Create: `backend/app/rpc/methods/subsessions.py`
- Modify: `backend/app/rpc/server.py`
- Test: `backend/tests/rpc/test_methods_subsessions.py`

- [ ] **Step 1: Create RPC handler tests**

Create `backend/tests/rpc/test_methods_subsessions.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agent.models import AgentTask, SubsessionType
from app.rpc.methods.subsessions import (
    create_subsession,
    approve_summary,
    dismiss_summary,
    list_children,
    request_summary,
    revise_summary,
)


def _unwrap(result):
    """Extract value from jsonrpcserver Success result."""
    return result._value.result


class TestCreateSubsession:
    async def test_creates_and_returns_bonsai_sid(self) -> None:
        svc = MagicMock()
        task = AgentTask(
            parent_bonsai_sid="parent-1",
            subsession_type=SubsessionType.discussion,
            name="Discuss auth",
        )
        svc.create_subsession.return_value = task

        result = await create_subsession(
            svc,
            parentBonsaiSid="parent-1",
            type="discussion",
            name="Discuss auth",
        )

        data = _unwrap(result)
        assert data["bonsaiSid"] == task.bonsai_sid
        svc.create_subsession.assert_called_once_with(
            parent_bonsai_sid="parent-1",
            subsession_type=SubsessionType.discussion,
            context=None,
            name="Discuss auth",
        )


class TestApproveSummary:
    async def test_calls_service(self) -> None:
        svc = MagicMock()
        result = await approve_summary(svc, bonsaiSid="sub-1", text="Summary text")
        data = _unwrap(result)
        assert data == {"ok": True}
        svc.approve_summary.assert_called_once_with("sub-1", "Summary text")


class TestDismissSummary:
    async def test_calls_service(self) -> None:
        svc = MagicMock()
        result = await dismiss_summary(svc, bonsaiSid="sub-1")
        data = _unwrap(result)
        assert data == {"ok": True}
        svc.dismiss_summary.assert_called_once_with("sub-1")
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend && uv run pytest tests/rpc/test_methods_subsessions.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the RPC handler module**

Create `backend/app/rpc/methods/subsessions.py`:

```python
"""RPC handlers for subsession/* methods."""
from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

from app.agent.models import SubsessionType
from app.agent.service import AgentService

_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603


def _handle_errors(func):  # type: ignore[type-arg]
    async def wrapper(service: AgentService, **params: Any) -> Result:
        try:
            return Success(await func(service, **params))
        except (KeyError, TypeError) as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Invalid params", str(exc))
        except ValueError as exc:
            raise JsonRpcError(_INTERNAL_ERROR, str(exc))
        except JsonRpcError:
            raise
        except Exception as exc:
            raise JsonRpcError(_INTERNAL_ERROR, "Internal error", str(exc))

    wrapper.__name__ = func.__name__
    wrapper.__qualname__ = func.__qualname__
    return wrapper


@_handle_errors
async def create_subsession(service: AgentService, **params: Any) -> dict:
    """Create a subsession linked to a parent session."""
    task = service.create_subsession(
        parent_bonsai_sid=params["parentBonsaiSid"],
        subsession_type=SubsessionType(params["type"]),
        context=params.get("context"),
        name=params.get("name", ""),
    )
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def request_summary(service: AgentService, **params: Any) -> dict:
    """Ask subsession agent to propose a return summary."""
    service.request_summary(params["bonsaiSid"])
    return {"ok": True}


@_handle_errors
async def approve_summary(service: AgentService, **params: Any) -> dict:
    """Approve a return summary."""
    service.approve_summary(params["bonsaiSid"], params["text"])
    return {"ok": True}


@_handle_errors
async def dismiss_summary(service: AgentService, **params: Any) -> dict:
    """Dismiss the return flow without returning anything."""
    service.dismiss_summary(params["bonsaiSid"])
    return {"ok": True}


@_handle_errors
async def revise_summary(service: AgentService, **params: Any) -> dict:
    """Ask agent to rewrite summary with feedback."""
    service.revise_summary(params["bonsaiSid"], params["feedback"])
    return {"ok": True}


@_handle_errors
async def list_children(service: AgentService, **params: Any) -> dict:
    """List direct child subsessions of a parent."""
    from app.agent.persistence import list_children as _list_children

    children = _list_children(
        service._config.project_root,
        params["parentBonsaiSid"],
    )
    return {"children": children}
```

- [ ] **Step 4: Register in server.py**

In `backend/app/rpc/server.py`, add imports:

```python
from app.rpc.methods.subsessions import (
    approve_summary as subsession_approve_summary,
    create_subsession as subsession_create,
    dismiss_summary as subsession_dismiss_summary,
    list_children as subsession_list_children,
    request_summary as subsession_request_summary,
    revise_summary as subsession_revise_summary,
)
```

Add to the `METHODS` dict:

```python
    "subsession/create": subsession_create,
    "subsession/requestSummary": subsession_request_summary,
    "subsession/approveSummary": subsession_approve_summary,
    "subsession/dismissSummary": subsession_dismiss_summary,
    "subsession/reviseSummary": subsession_revise_summary,
    "subsession/listChildren": subsession_list_children,
```

No changes needed to `_bind_methods` — the `else` clause at line 252-253 already binds unmatched prefixes to `agent_service`.

- [ ] **Step 5: Run tests — expect pass**

```bash
cd backend && uv run pytest tests/rpc/test_methods_subsessions.py -v
```

Expected: All 3 tests PASS.

- [ ] **Step 6: Run full backend test suite**

```bash
cd backend && uv run pytest -x -q
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/rpc/methods/subsessions.py backend/app/rpc/server.py backend/tests/rpc/test_methods_subsessions.py
git commit -m "feat(subsession): add subsession/* RPC handlers and register in server"
```

---

## Task 7: Frontend Types + RPC Wrappers

**Files:**
- Modify: `frontend/src/types/session.ts`
- Create: `frontend/src/api/methods/subsessions.ts`

- [ ] **Step 1: Add subsession fields to Session type**

In `frontend/src/types/session.ts`, add to the `Session` interface:

```typescript
  parentBonsaiSid: string | null;
  subsessionType: "discussion" | "refinement" | null;
  subsessionContext: string | null;
  returnStatus: "pending" | "approved" | "dismissed" | null;
  returnSummary: string | null;
```

- [ ] **Step 2: Create RPC wrapper**

Create `frontend/src/api/methods/subsessions.ts`:

```typescript
import type { RpcClient } from "../client.ts";

export function createSubsessionApi(client: RpcClient) {
  return {
    create: (params: {
      parentBonsaiSid: string;
      type: "discussion" | "refinement";
      context?: string;
      name?: string;
    }) => client.request<{ bonsaiSid: string }>("subsession/create", params),

    requestSummary: (bonsaiSid: string) =>
      client.request<{ ok: true }>("subsession/requestSummary", { bonsaiSid }),

    approveSummary: (bonsaiSid: string, text: string) =>
      client.request<{ ok: true }>("subsession/approveSummary", { bonsaiSid, text }),

    dismissSummary: (bonsaiSid: string) =>
      client.request<{ ok: true }>("subsession/dismissSummary", { bonsaiSid }),

    reviseSummary: (bonsaiSid: string, feedback: string) =>
      client.request<{ ok: true }>("subsession/reviseSummary", { bonsaiSid, feedback }),

    listChildren: (parentBonsaiSid: string) =>
      client.request<{ children: unknown[] }>("subsession/listChildren", { parentBonsaiSid }),
  };
}

export type SubsessionApi = ReturnType<typeof createSubsessionApi>;
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS (may need to add default values where Session is constructed in the store).

- [ ] **Step 4: Fix any Session construction sites in sessionStore.ts**

Wherever a `Session` object is constructed (search for `status:` + `events:` together), add the new fields with defaults:

```typescript
parentBonsaiSid: null,
subsessionType: null,
subsessionContext: null,
returnStatus: null,
returnSummary: null,
```

Also check `loadActiveSessions` and `restoreSession` where sessions are loaded from the backend — map the new camelCase fields from the response.

- [ ] **Step 5: Run TypeScript check again**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/api/methods/subsessions.ts frontend/src/store/sessionStore.ts
git commit -m "feat(subsession): add frontend types and RPC wrappers"
```

---

## Task 8: Frontend Store — Subsession Actions

**Files:**
- Modify: `frontend/src/store/sessionStore.ts`

- [ ] **Step 1: Add createSubsession action**

Add to the store interface and implementation:

```typescript
createSubsession: async (parentBonsaiSid: string, type: "discussion" | "refinement", context?: string, name?: string) => {
  const { createSubsessionApi } = await import("@/api/methods/subsessions.ts");
  const client = getClient();
  const api = createSubsessionApi(client);
  const { bonsaiSid } = await api.create({
    parentBonsaiSid,
    type,
    context,
    name: name ?? (type === "discussion" ? "Discussion" : "Refinement"),
  });

  // Load the created subsession
  const { createSessionApi } = await import("@/api/methods/sessions.ts");
  const sessionApi = createSessionApi(client);
  const data = await sessionApi.get(bonsaiSid);
  if (data) {
    set((s) => {
      const next = new Map(s.sessions);
      const session: Session = {
        bonsaiSid,
        name: data.name ?? "",
        skillId: data.skillId ?? null,
        specIds: data.specIds ?? [],
        filePaths: data.filePaths ?? [],
        status: (data.status as SessionStatus) ?? "draft",
        model: data.config?.model ?? DEFAULT_MODEL,
        permissionMode: data.config?.permissionMode ?? "default",
        betas: data.config?.betas ?? [],
        effort: data.config?.effort ?? null,
        maxTurns: data.config?.maxTurns ?? 50,
        startedAt: Date.now(),
        events: [],
        metrics: defaultMetrics(),
        pendingRequest: null,
        answeredRequests: new Map(),
        parentBonsaiSid: data.parentBonsaiSid ?? null,
        subsessionType: data.subsessionType ?? null,
        subsessionContext: data.subsessionContext ?? null,
        returnStatus: data.returnStatus ?? null,
        returnSummary: data.returnSummary ?? null,
        systemPrompt: data.systemPrompt,
      };
      next.set(bonsaiSid, session);
      const tabs = new Set(s.openTabs);
      tabs.add(bonsaiSid);
      return { sessions: next, openTabs: tabs, activeSessionId: bonsaiSid };
    });
  }
  return bonsaiSid;
},
```

- [ ] **Step 2: Add return flow actions**

```typescript
approveReturn: async (bonsaiSid: string, text: string) => {
  const { createSubsessionApi } = await import("@/api/methods/subsessions.ts");
  const api = createSubsessionApi(getClient());
  await api.approveSummary(bonsaiSid, text);
  set((s) => {
    const session = s.sessions.get(bonsaiSid);
    if (!session) return s;
    const next = new Map(s.sessions);
    next.set(bonsaiSid, { ...session, returnStatus: "approved", returnSummary: text });
    return { sessions: next };
  });
},

dismissReturn: async (bonsaiSid: string) => {
  const { createSubsessionApi } = await import("@/api/methods/subsessions.ts");
  const api = createSubsessionApi(getClient());
  await api.dismissSummary(bonsaiSid);
  set((s) => {
    const session = s.sessions.get(bonsaiSid);
    if (!session) return s;
    const next = new Map(s.sessions);
    next.set(bonsaiSid, { ...session, returnStatus: "dismissed" });
    return { sessions: next };
  });
},

reviseReturn: async (bonsaiSid: string, feedback: string) => {
  const { createSubsessionApi } = await import("@/api/methods/subsessions.ts");
  const api = createSubsessionApi(getClient());
  await api.reviseSummary(bonsaiSid, feedback);
},
```

- [ ] **Step 3: Run lint**

```bash
cd frontend && npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/store/sessionStore.ts
git commit -m "feat(subsession): add store actions for subsession creation and return flow"
```

---

## Task 9: Frontend — Tab Bar Hierarchy

**Files:**
- Modify: `frontend/src/components/SessionPanel/SessionTabBar.tsx`

- [ ] **Step 1: Add tree-ordering and visual indicators**

Modify the tab rendering in `SessionTabBar.tsx`:

1. Sort sessions to place children after their parents:

```typescript
function orderSessionsWithHierarchy(sessions: Session[]): Session[] {
  const byParent = new Map<string, Session[]>();
  const roots: Session[] = [];

  for (const s of sessions) {
    if (s.parentBonsaiSid) {
      const children = byParent.get(s.parentBonsaiSid) ?? [];
      children.push(s);
      byParent.set(s.parentBonsaiSid, children);
    } else {
      roots.push(s);
    }
  }

  const result: Session[] = [];
  function addWithChildren(session: Session) {
    result.push(session);
    const children = byParent.get(session.bonsaiSid) ?? [];
    for (const child of children) {
      addWithChildren(child);
    }
  }

  for (const root of roots) {
    addWithChildren(root);
  }
  return result;
}
```

2. Compute nesting depth:

```typescript
function nestingDepth(session: Session, sessions: Session[]): number {
  let depth = 0;
  let current = session;
  while (current.parentBonsaiSid) {
    depth++;
    const parent = sessions.find((s) => s.bonsaiSid === current.parentBonsaiSid);
    if (!parent) break;
    current = parent;
  }
  return depth;
}
```

3. Update tab rendering to show prefix and icons:

```typescript
const depth = nestingDepth(s, sessions);
const prefix = "↳".repeat(depth);
const typeIcon = s.subsessionType === "refinement" ? "✏️" : s.subsessionType === "discussion" ? "💬" : "";
const isPausedParent = sessions.some(
  (child) => child.parentBonsaiSid === s.bonsaiSid && child.status !== "done" && child.status !== "error"
);

<div
  className={`session-tab ${isActive ? "session-tab-active" : ""}`}
  style={{ opacity: isPausedParent ? 0.5 : 1 }}
>
  <span className="session-tab-dot" style={{ background: statusDotColor(s.status) }} />
  <span className="session-tab-name">
    {prefix && <span className="session-tab-prefix">{prefix} </span>}
    {isPausedParent && "⏸ "}
    {typeIcon && `${typeIcon} `}
    {s.name || s.bonsaiSid.slice(0, 8)}
  </span>
</div>
```

- [ ] **Step 2: Run lint + dev server to verify**

```bash
cd frontend && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SessionPanel/SessionTabBar.tsx
git commit -m "feat(subsession): add tab bar hierarchy with nesting indicators"
```

---

## Task 10: Frontend — ReturnFlowCard Component

**Files:**
- Create: `frontend/src/components/ChatStream/ReturnFlowCard.tsx`
- Modify: `frontend/src/components/ChatStream/ChatStream.tsx`

- [ ] **Step 1: Create ReturnFlowCard**

Create `frontend/src/components/ChatStream/ReturnFlowCard.tsx`:

```tsx
import { useCallback, useState } from "react";

interface ReturnFlowCardProps {
  bonsaiSid: string;
  subsessionType: "discussion" | "refinement";
  proposedSummary: string;
  onApprove: (text: string) => void;
  onDismiss: () => void;
  onRevise: (feedback: string) => void;
  onPutInInput?: (text: string) => void;
  onSendAsMessage?: (text: string) => void;
}

export function ReturnFlowCard({
  bonsaiSid,
  subsessionType,
  proposedSummary,
  onApprove,
  onDismiss,
  onRevise,
  onPutInInput,
  onSendAsMessage,
}: ReturnFlowCardProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(proposedSummary);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");

  const handleApprove = useCallback(() => {
    if (subsessionType === "refinement") {
      // For refinement, show choice dialog
      return;
    }
    onApprove(editing ? editText : proposedSummary);
  }, [editing, editText, proposedSummary, onApprove, subsessionType]);

  const handleRevise = useCallback(() => {
    if (feedback.trim()) {
      onRevise(feedback.trim());
      setFeedback("");
      setRevising(false);
    }
  }, [feedback, onRevise]);

  const isRefinement = subsessionType === "refinement";
  const displayText = editing ? editText : proposedSummary;

  return (
    <div className="return-flow-card">
      <div className="return-flow-header">
        <span className="return-flow-icon">{isRefinement ? "✏️" : "📋"}</span>
        <span className="return-flow-title">
          {isRefinement ? "Refined content" : "Summary for parent session"}
        </span>
        <span className="return-flow-badge">{subsessionType}</span>
      </div>

      {editing ? (
        <textarea
          className="return-flow-editor"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          rows={6}
        />
      ) : (
        <div className="return-flow-text">{displayText}</div>
      )}

      {revising ? (
        <div className="return-flow-revise">
          <textarea
            className="return-flow-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should be changed?"
            rows={3}
          />
          <div className="return-flow-revise-actions">
            <button onClick={handleRevise} disabled={!feedback.trim()}>
              Send feedback
            </button>
            <button onClick={() => setRevising(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="return-flow-actions">
          {isRefinement ? (
            <>
              <button className="btn-primary" onClick={() => onPutInInput?.(displayText)}>
                📝 Put in input box
              </button>
              <button className="btn-primary" onClick={() => onSendAsMessage?.(displayText)}>
                📨 Send as message
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={handleApprove}>
              ✓ Approve & return
            </button>
          )}
          <button onClick={() => setEditing(!editing)}>
            {editing ? "Preview" : "✏️ Edit"}
          </button>
          <button onClick={() => setRevising(true)}>🔄 Revise</button>
          <button className="btn-muted" onClick={onDismiss}>✕ Dismiss</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add CSS styles**

Add to the relevant CSS file (follow existing patterns in ChatStream.css):

```css
.return-flow-card {
  background: var(--bg-subsession, rgba(31, 111, 235, 0.08));
  border: 1px solid var(--blue);
  border-radius: 8px;
  padding: 16px;
  margin: 8px 0;
}

.return-flow-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.return-flow-title {
  font-weight: 600;
  color: var(--blue);
}

.return-flow-badge {
  background: rgba(31, 111, 235, 0.15);
  color: var(--blue);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}

.return-flow-text {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.return-flow-editor {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--blue);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
  color: var(--fg);
  font-family: inherit;
  font-size: inherit;
  line-height: 1.6;
  resize: vertical;
}

.return-flow-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.return-flow-revise {
  margin-bottom: 8px;
}

.return-flow-feedback {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
  color: var(--fg);
  font-family: inherit;
  resize: vertical;
}

.return-flow-revise-actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 3: Run lint**

```bash
cd frontend && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChatStream/ReturnFlowCard.tsx
git commit -m "feat(subsession): add ReturnFlowCard component for summary review"
```

---

## Task 11: Frontend — SubsessionResultCard Component

**Files:**
- Create: `frontend/src/components/ChatStream/SubsessionResultCard.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/ChatStream/SubsessionResultCard.tsx`:

```tsx
interface SubsessionResultCardProps {
  childName: string;
  subsessionType: "discussion" | "refinement";
  summary: string;
}

export function SubsessionResultCard({
  childName,
  subsessionType,
  summary,
}: SubsessionResultCardProps) {
  return (
    <div className="subsession-result-card">
      <div className="subsession-result-header">
        <span className="subsession-result-icon">
          {subsessionType === "refinement" ? "✏️" : "💬"}
        </span>
        <span className="subsession-result-label">
          Subsession result — "{childName}"
        </span>
      </div>
      <div className="subsession-result-text">{summary}</div>
    </div>
  );
}
```

Add CSS:

```css
.subsession-result-card {
  border-left: 3px solid var(--blue);
  border-radius: 0 8px 8px 0;
  background: rgba(31, 111, 235, 0.05);
  padding: 12px 16px;
  margin: 8px 0;
}

.subsession-result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.subsession-result-label {
  color: var(--blue);
  font-size: 12px;
  font-weight: 500;
}

.subsession-result-text {
  color: var(--fg);
  line-height: 1.5;
  font-size: 13px;
  white-space: pre-wrap;
}
```

- [ ] **Step 2: Run lint**

```bash
cd frontend && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChatStream/SubsessionResultCard.tsx
git commit -m "feat(subsession): add SubsessionResultCard for parent session display"
```

---

## Task 12: Frontend — Entry Point: /discuss Slash Command

**Files:**
- Modify: `frontend/src/components/ChatStream/InputArea.tsx`

- [ ] **Step 1: Add /discuss handling to input area**

In `InputArea.tsx`, modify the `handleSend` or `onSend` callback to intercept `/discuss`:

```typescript
const handleSend = useCallback(
  (text: string, isMarkdown?: boolean) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Handle /discuss slash command
    if (trimmed.startsWith("/discuss ") || trimmed === "/discuss") {
      const topic = trimmed.slice("/discuss ".length).trim();
      const store = useSessionStore.getState();
      store.createSubsession(sessionId, "discussion", topic || undefined, topic ? `Discuss: ${topic.slice(0, 40)}` : "Discussion");
      return;
    }

    onSend(trimmed, isMarkdown);
  },
  [sessionId, onSend],
);
```

Also add `/discuss` to the slash command suggestions if the skill autocomplete system supports dynamic additions. Otherwise, handle it purely in the send path.

- [ ] **Step 2: Run lint**

```bash
cd frontend && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChatStream/InputArea.tsx
git commit -m "feat(subsession): add /discuss slash command in input area"
```

---

## Task 13: Frontend — Entry Point: "Discuss First" on QuestionCard

**Files:**
- Modify: `frontend/src/components/ChatStream/QuestionCard.tsx`

- [ ] **Step 1: Add "Discuss first" button**

Add a button at the bottom of the question card:

```tsx
import { useSessionStore } from "@/store/sessionStore.ts";

// Inside the component, after the option buttons:
{!answered && !expired && (
  <div className="question-card-discuss">
    <button
      className="btn-discuss"
      onClick={() => {
        const questionText = questions.map((q) => q.question).join("\n");
        const store = useSessionStore.getState();
        const activeId = store.activeSessionId;
        if (activeId) {
          store.createSubsession(activeId, "discussion", questionText, "Discuss: " + (questions[0]?.question ?? "").slice(0, 40));
        }
      }}
    >
      💬 Discuss first
    </button>
  </div>
)}
```

Add CSS:

```css
.question-card-discuss {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  margin-top: 10px;
}

.btn-discuss {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  color: var(--blue);
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.btn-discuss:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 2: Run lint**

```bash
cd frontend && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChatStream/QuestionCard.tsx
git commit -m "feat(subsession): add 'Discuss first' button to QuestionCard"
```

---

## Task 14: Frontend — Entry Point: Voice Input "Revise" Button

**Files:**
- Modify: `frontend/src/components/ChatStream/InputArea.tsx`

- [ ] **Step 1: Add "Revise with agent" button after voice transcription**

In the voice input section of `InputArea.tsx`, after the transcript is placed in the textarea, show a "Revise with agent" button:

```tsx
{voice.lastTranscript && !voice.isRecording && (
  <button
    className="btn-revise-voice"
    onClick={() => {
      const store = useSessionStore.getState();
      store.createSubsession(sessionId, "refinement", voice.lastTranscript, "Revise voice input");
    }}
  >
    ✏️ Revise with agent
  </button>
)}
```

This requires tracking `lastTranscript` in the voice hook or in local state after transcription completes.

- [ ] **Step 2: Run lint**

```bash
cd frontend && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChatStream/InputArea.tsx
git commit -m "feat(subsession): add 'Revise with agent' button for voice transcripts"
```

---

## Task 15: Frontend — Entry Point: Text Selection Context Menu

**Files:**
- Create: `frontend/src/components/ChatStream/SubsessionContextMenu.tsx`
- Modify: `frontend/src/components/ChatStream/ChatStream.tsx`

- [ ] **Step 1: Create context menu component**

Create `frontend/src/components/ChatStream/SubsessionContextMenu.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";

interface Position {
  x: number;
  y: number;
}

interface SubsessionContextMenuProps {
  containerRef: React.RefObject<HTMLElement | null>;
  sessionId: string;
}

export function SubsessionContextMenu({ containerRef, sessionId }: SubsessionContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState("");

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text) return;

      e.preventDefault();
      setSelectedText(text);
      setPosition({ x: e.clientX, y: e.clientY });
      setVisible(true);
    },
    [],
  );

  const handleClick = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("click", handleClick);
    return () => {
      el.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("click", handleClick);
    };
  }, [containerRef, handleContextMenu, handleClick]);

  if (!visible) return null;

  const handleDiscuss = () => {
    const store = useSessionStore.getState();
    store.createSubsession(sessionId, "discussion", selectedText, "Discuss: " + selectedText.slice(0, 40));
    setVisible(false);
  };

  const handleRefine = () => {
    const store = useSessionStore.getState();
    store.createSubsession(sessionId, "refinement", selectedText, "Refine selection");
    setVisible(false);
  };

  return (
    <div
      className="subsession-context-menu"
      style={{ position: "fixed", left: position.x, top: position.y }}
    >
      <div className="context-menu-label">Selected text</div>
      <button className="context-menu-item" onClick={handleDiscuss}>
        💬 Discuss in subsession
      </button>
      <button className="context-menu-item" onClick={handleRefine}>
        ✏️ Refine in subsession
      </button>
    </div>
  );
}
```

Add CSS:

```css
.subsession-context-menu {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 0;
  min-width: 220px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  z-index: 1000;
}

.context-menu-label {
  padding: 6px 16px;
  color: var(--hint);
  font-size: 12px;
}

.context-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 16px;
  background: none;
  border: none;
  color: var(--blue);
  cursor: pointer;
  font-size: 14px;
}

.context-menu-item:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 2: Wire into ChatStream**

In `ChatStream.tsx`, add the context menu:

```tsx
import { SubsessionContextMenu } from "./SubsessionContextMenu.tsx";

// Inside the component:
const chatRef = useRef<HTMLDivElement>(null);

// In the JSX, wrap the chat content and add the menu:
<div ref={chatRef} className="chat-stream">
  {/* existing event rendering */}
  <SubsessionContextMenu containerRef={chatRef} sessionId={session?.bonsaiSid ?? ""} />
</div>
```

- [ ] **Step 3: Run lint**

```bash
cd frontend && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChatStream/SubsessionContextMenu.tsx frontend/src/components/ChatStream/ChatStream.tsx
git commit -m "feat(subsession): add right-click context menu for text selection"
```

---

## Task 16: Integration — Wire Event Rendering for New Cards

**Files:**
- Modify: `frontend/src/components/ChatStream/ChatStream.tsx` or renderer registry

- [ ] **Step 1: Add event types for subsession return**

The backend will emit events like `subsession/summaryProposed` and `subsession/returned`. Wire these into the ChatStream event rendering to show `ReturnFlowCard` and `SubsessionResultCard`.

Add to the event wiring in `sessionStore.ts`:

```typescript
// In the event handler setup (where onSuggestSession etc. are wired):
client.on("subsession/summaryProposed", (params) => {
  // Show ReturnFlowCard in the subsession's chat
  const p = params as Record<string, unknown>;
  const bonsaiSid = p.bonsaiSid as string;
  set((s) => {
    const session = s.sessions.get(bonsaiSid);
    if (!session) return s;
    const next = new Map(s.sessions);
    next.set(bonsaiSid, {
      ...session,
      returnStatus: "pending",
      returnSummary: p.summary as string,
    });
    return { sessions: next };
  });
});

client.on("subsession/returned", (params) => {
  // Inject SubsessionResultCard into parent's chat
  const p = params as Record<string, unknown>;
  const parentSid = p.parentBonsaiSid as string;
  const session = get().sessions.get(parentSid);
  if (!session) return;
  const event: AgentEvent = {
    bonsaiSid: parentSid,
    sessionId: "",
    eventType: "notification" as const,
    payload: {
      type: "subsessionResult",
      childBonsaiSid: p.childBonsaiSid,
      childName: p.childName ?? "Subsession",
      subsessionType: p.type,
      summary: p.summary,
    },
  };
  set((s) => {
    const next = new Map(s.sessions);
    const parent = next.get(parentSid);
    if (!parent) return s;
    next.set(parentSid, { ...parent, events: [...parent.events, event] });
    return { sessions: next };
  });
});
```

- [ ] **Step 2: Render in ChatStream**

Add rendering for the `subsessionResult` notification type in the event renderer:

```tsx
// In the event rendering logic:
if (ev.eventType === "notification" && ev.payload.type === "subsessionResult") {
  return (
    <SubsessionResultCard
      key={k}
      childName={ev.payload.childName as string}
      subsessionType={ev.payload.subsessionType as "discussion" | "refinement"}
      summary={ev.payload.summary as string}
    />
  );
}
```

Also render `ReturnFlowCard` when the current session has `returnStatus === "pending"`:

```tsx
// At the end of the event list, if this is a subsession with pending return:
{session?.returnStatus === "pending" && session?.returnSummary && (
  <ReturnFlowCard
    bonsaiSid={session.bonsaiSid}
    subsessionType={session.subsessionType ?? "discussion"}
    proposedSummary={session.returnSummary}
    onApprove={(text) => store.approveReturn(session.bonsaiSid, text)}
    onDismiss={() => store.dismissReturn(session.bonsaiSid)}
    onRevise={(feedback) => store.reviseReturn(session.bonsaiSid, feedback)}
  />
)}
```

- [ ] **Step 3: Run full frontend lint**

```bash
cd frontend && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/store/sessionStore.ts frontend/src/components/ChatStream/ChatStream.tsx
git commit -m "feat(subsession): wire subsession event rendering and return flow cards"
```

---

## Task 17: Backend — Emit Notifications

**Files:**
- Modify: `backend/app/agent/service.py`
- Modify: `backend/app/rpc/methods/subsessions.py`

- [ ] **Step 1: Emit subsession/returned on approve**

In the `approve_summary` RPC handler, after calling `service.approve_summary()`, publish a notification to the parent session:

```python
@_handle_errors
async def approve_summary(service: AgentService, **params: Any) -> dict:
    """Approve a return summary."""
    bonsai_sid = params["bonsaiSid"]
    text = params["text"]
    service.approve_summary(bonsai_sid, text)

    # Notify parent session about the returned summary
    task = service._tracker.get_task(bonsai_sid)
    if task.parent_bonsai_sid:
        await bus.publish_to_session(
            task.parent_bonsai_sid,
            "subsession/returned",
            {
                "parentBonsaiSid": task.parent_bonsai_sid,
                "childBonsaiSid": bonsai_sid,
                "childName": task.name,
                "type": task.subsession_type.value if task.subsession_type else "discussion",
                "summary": text,
            },
        )
    return {"ok": True}
```

Add the bus import at the top of `subsessions.py`:

```python
from app.rpc.connections import bus
```

- [ ] **Step 2: Run backend tests**

```bash
cd backend && uv run pytest -x -q
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/rpc/methods/subsessions.py
git commit -m "feat(subsession): emit subsession/returned notification on approve"
```

---

## Task 18: Final Integration Test + Cleanup

- [ ] **Step 1: Run full backend test suite**

```bash
cd backend && uv run pytest -v
```

- [ ] **Step 2: Run full frontend lint**

```bash
cd frontend && npm run lint
```

- [ ] **Step 3: Manual smoke test**

1. Start the app: `./run.sh`
2. Create a session and have a conversation
3. Type `/discuss Can we talk about the database schema?` → verify subsession tab opens with `↳` prefix
4. Have a discussion in the subsession
5. End the subsession → verify ReturnFlowCard appears
6. Approve the summary → verify SubsessionResultCard appears in parent
7. Verify parent agent can reference the summary on next turn

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(subsession): complete subsession feature with all entry points and return flow"
```
