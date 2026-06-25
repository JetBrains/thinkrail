from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

import app.rpc.server as server


@pytest.mark.asyncio
async def test_broadcast_publishes_to_each_active_project():
    server._projects.clear()

    class _Ctx:  # minimal stand-in
        pass

    server._projects["/a"] = _Ctx()
    server._projects["/b"] = _Ctx()
    try:
        with patch.object(server.bus, "publish_to_project", AsyncMock()) as pub:
            await server.broadcast_capabilities_changed("claude")
        called = {c.args[0] for c in pub.await_args_list}
        assert called == {"/a", "/b"}
        for c in pub.await_args_list:
            assert c.args[1] == "runtimes/capabilitiesChanged"
            assert c.args[2] == {"runtimeType": "claude"}
    finally:
        server._projects.clear()
