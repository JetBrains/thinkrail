from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from jsonrpcserver import JsonRpcError

from app.spec.models import SpecDetail, SpecGraph, SpecSummary
from app.spec.service import SpecNotFoundError
from app.rpc.methods.specs import (
    list_specs,
    get_spec,
    create_spec,
    update_spec,
    delete_spec,
    get_graph,
)


def _unwrap(result: Any) -> Any:
    """Extract the payload from a jsonrpcserver Success(value)."""
    return result._value.result


@pytest.fixture
def svc() -> AsyncMock:
    return AsyncMock()


class TestListSpecs:
    async def test_returns_list(self, svc: AsyncMock) -> None:
        svc.list_specs.return_value = [
            SpecSummary(id="a", type="module-design", path="a/README.md", status="active", title="A"),
        ]
        result = _unwrap(await list_specs(svc))
        assert len(result) == 1
        assert result[0]["id"] == "a"

    async def test_empty(self, svc: AsyncMock) -> None:
        svc.list_specs.return_value = []
        result = _unwrap(await list_specs(svc))
        assert result == []


class TestGetSpec:
    async def test_returns_detail(self, svc: AsyncMock) -> None:
        svc.get_spec.return_value = SpecDetail(
            id="a", type="module-design", path="a/README.md",
            status="active", title="A", content="# A",
        )
        result = _unwrap(await get_spec(svc, id="a"))
        assert result["id"] == "a"
        assert result["content"] == "# A"

    async def test_not_found(self, svc: AsyncMock) -> None:
        svc.get_spec.side_effect = SpecNotFoundError("nope")
        with pytest.raises(JsonRpcError) as exc_info:
            await get_spec(svc, id="missing")
        assert exc_info.value.code == -32001

    async def test_missing_id_param(self, svc: AsyncMock) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            await get_spec(svc)
        assert exc_info.value.code == -32602


class TestCreateSpec:
    async def test_creates(self, svc: AsyncMock) -> None:
        svc.create_spec.return_value = SpecDetail(
            id="new", type="task-spec", path="t.md",
            status="draft", title="New",
        )
        result = _unwrap(await create_spec(svc, type="task-spec", path="t.md", content="# New"))
        assert result["id"] == "new"
        svc.create_spec.assert_called_once_with(type="task-spec", path="t.md", content="# New", id=None)

    async def test_validation_error(self, svc: AsyncMock) -> None:
        svc.create_spec.side_effect = ValueError("bad type")
        with pytest.raises(JsonRpcError) as exc_info:
            await create_spec(svc, type="bad", path="x.md")
        assert exc_info.value.code == -32003


class TestUpdateSpec:
    async def test_updates(self, svc: AsyncMock) -> None:
        svc.update_spec.return_value = SpecDetail(
            id="a", type="module-design", path="a/README.md",
            status="active", title="A", content="updated",
        )
        result = _unwrap(await update_spec(svc, id="a", content="updated"))
        assert result["content"] == "updated"

    async def test_not_found(self, svc: AsyncMock) -> None:
        svc.update_spec.side_effect = SpecNotFoundError("nope")
        with pytest.raises(JsonRpcError) as exc_info:
            await update_spec(svc, id="ghost", content="x")
        assert exc_info.value.code == -32001


class TestDeleteSpec:
    async def test_deletes(self, svc: AsyncMock) -> None:
        await delete_spec(svc, id="a")
        svc.delete_spec.assert_called_once_with("a")

    async def test_not_found(self, svc: AsyncMock) -> None:
        svc.delete_spec.side_effect = SpecNotFoundError("nope")
        with pytest.raises(JsonRpcError) as exc_info:
            await delete_spec(svc, id="ghost")
        assert exc_info.value.code == -32001


class TestGetGraph:
    async def test_returns_graph(self, svc: AsyncMock) -> None:
        svc.get_graph.return_value = SpecGraph(nodes=[], edges=[])
        result = _unwrap(await get_graph(svc))
        assert result["nodes"] == []
        assert result["edges"] == []

    async def test_internal_error(self, svc: AsyncMock) -> None:
        svc.get_graph.side_effect = RuntimeError("boom")
        with pytest.raises(JsonRpcError) as exc_info:
            await get_graph(svc)
        assert exc_info.value.code == -32603
