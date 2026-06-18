"""Operation reducer for the ticket stage DAG.

Every structural change is an op applied by ``apply_op``; the result is
validated before being returned. Top-level *structural* ops (addNode,
removeNode, setDependsOn, proposePipeline) act on the stage list. Run-tracking
ops (recordRunStart/Finish, reRunNode) locate their target node *anywhere* in
the tree — stages or an implementing node's ``children`` (the steps) — so the
nested implement-orchestrator can advance step status with the same ops.
See design §6–§8.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from app.board.work_node import NodeRun, NodeStatus, RunStatus, WorkNode, DagError, validate_dag


def _iter_nodes(nodes: list[WorkNode]) -> Iterator[WorkNode]:
    """Yield every node in the tree (stages + nested children)."""
    for n in nodes:
        yield n
        if n.children:
            yield from _iter_nodes(n.children)


def find_node(nodes: list[WorkNode], node_id: str) -> WorkNode | None:
    """Find a node by id anywhere in the tree (stages or children)."""
    for n in _iter_nodes(nodes):
        if n.id == node_id:
            return n
    return None


def _validate_recursive(nodes: list[WorkNode]) -> None:
    """Validate the top-level DAG and every node's children sub-DAG."""
    validate_dag(nodes)
    for n in nodes:
        if n.children:
            _validate_recursive(n.children)


def apply_op(stages: list[WorkNode], op: dict[str, Any]) -> list[WorkNode]:
    """Return a new validated stage list with *op* applied. Raises DagError."""
    kind = op.get("op")
    nodes = [n.model_copy(deep=True) for n in stages]
    by_id = {n.id: n for n in nodes}

    if kind == "addNode":
        node = WorkNode.model_validate(op["node"])
        if node.id in by_id:
            raise DagError(f"node {node.id!r} already exists")
        nodes.append(node)

    elif kind == "removeNode":
        target = by_id.get(op["id"])
        if target is None:
            raise DagError(f"unknown node {op['id']!r}")
        if target.status in (NodeStatus.DONE, NodeStatus.RUNNING):
            raise DagError(f"cannot remove {target.status} node {target.id!r}")
        nodes = [n for n in nodes if n.id != op["id"]]
        for n in nodes:
            n.depends_on = [d for d in n.depends_on if d != op["id"]]

    elif kind == "setDependsOn":
        target = by_id.get(op["id"])
        if target is None:
            raise DagError(f"unknown node {op['id']!r}")
        target.depends_on = list(op["dependsOn"])

    elif kind == "proposePipeline":
        nodes = [WorkNode.model_validate(n) for n in op["nodes"]]

    elif kind == "proposeChildren":
        parent = find_node(nodes, op["parentId"])
        if parent is None:
            raise DagError(f"unknown node {op['parentId']!r}")
        parent.children = [WorkNode.model_validate(n) for n in op["nodes"]]

    elif kind == "reRunNode":
        target = find_node(nodes, op["id"])
        if target is None:
            raise DagError(f"unknown node {op['id']!r}")
        target.status = NodeStatus.PENDING   # history in .runs / .completed_at preserved

    elif kind == "recordRunStart":
        target = find_node(nodes, op["id"])
        if target is None:
            raise DagError(f"unknown node {op['id']!r}")
        target.runs.append(NodeRun.model_validate(op["run"]))
        target.status = NodeStatus.RUNNING

    elif kind == "recordRunFinish":
        target = find_node(nodes, op["id"])
        if target is None or not target.runs:
            raise DagError(f"no open run for node {op['id']!r}")
        run = target.runs[-1]
        run.status = RunStatus.FAILED if op.get("isError") else RunStatus.DONE
        run.summary = op.get("summary")
        target.status = NodeStatus(run.status)
        target.summary = run.summary
        if run.status == RunStatus.DONE:
            target.completed_at = op["completedAt"]

    else:
        raise DagError(f"unknown op {kind!r}")

    _validate_recursive(nodes)
    return nodes
