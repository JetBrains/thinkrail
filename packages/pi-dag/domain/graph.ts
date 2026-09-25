import { Check } from "typebox/value";
import { canonicalJson, fail } from "./errors.ts";
import {
	type DagConnection,
	type DagDefinition,
	DefinitionSchema,
	type GraphEdit,
	LIMITS,
} from "./schemas.ts";

export function endpoints(connection: DagConnection): { from: string | null; to: string } {
	if (connection.kind === "data") return { from: connection.from.nodeId, to: connection.to.nodeId };
	return { from: typeof connection.from === "string" ? connection.from : null, to: connection.to };
}

export function validateDefinition(value: unknown): DagDefinition {
	const json = canonicalJson(value);
	if (Buffer.byteLength(json, "utf8") > LIMITS.definitionBytes)
		fail("limit-exceeded", "DAG definition exceeds 1 MiB");
	if (!Check(DefinitionSchema, value))
		fail("invalid-graph", "Definition does not match the bounded DAG schema");
	const nodes = new Map(value.nodes.map((node) => [node.id, node]));
	if (nodes.size !== value.nodes.length) fail("invalid-graph", "Node ids must be unique");
	const connections = new Set<string>();
	const producers = new Set<string>();
	const forks = new Set<string>();
	const outgoing = new Map<string, Set<string>>();
	const indegrees = new Map(value.nodes.map((node) => [node.id, 0]));
	for (const connection of value.connections) {
		if (connections.has(connection.id))
			fail("invalid-graph", `Duplicate connection ${connection.id}`);
		connections.add(connection.id);
		const { from, to } = endpoints(connection);
		const destination = nodes.get(to);
		if (!destination || (from !== null && !nodes.has(from)))
			fail("invalid-graph", `Unknown endpoint on ${connection.id}`);
		if (connection.context === "fork") {
			if (forks.has(to))
				fail("invalid-graph", `Node ${to} has multiple inherited conversation bases`);
			forks.add(to);
			if (connection.kind === "control" && "allowSkipped" in connection && connection.allowSkipped)
				fail("invalid-graph", "A fork source cannot be skipped");
		}
		if (connection.kind === "data") {
			const output = nodes.get(connection.from.nodeId)?.outputs[connection.from.output];
			const input = destination.inputs?.[connection.to.input];
			if (!output || !input || output.kind !== input.kind)
				fail("invalid-graph", `Missing or incompatible ports on ${connection.id}`);
			const key = `${to}/${connection.to.input}`;
			if (producers.has(key)) fail("invalid-graph", `Input ${key} has multiple producers`);
			producers.add(key);
		}
		if (from !== null) {
			const successors = outgoing.get(from) ?? new Set<string>();
			if (!successors.has(to)) indegrees.set(to, (indegrees.get(to) ?? 0) + 1);
			successors.add(to);
			outgoing.set(from, successors);
		}
	}
	for (const node of value.nodes) {
		for (const input of Object.keys(node.inputs ?? {})) {
			if (!producers.has(`${node.id}/${input}`))
				fail("invalid-graph", `Required input ${node.id}/${input} has no producer`);
		}
	}
	const ready = [...indegrees].filter(([, count]) => count === 0).map(([id]) => id);
	let visited = 0;
	for (let index = 0; index < ready.length; index++) {
		const id = ready[index];
		if (id === undefined) break;
		visited++;
		for (const successor of outgoing.get(id) ?? []) {
			const remaining = (indegrees.get(successor) ?? 0) - 1;
			indegrees.set(successor, remaining);
			if (remaining === 0) ready.push(successor);
		}
	}
	if (visited !== nodes.size) fail("invalid-graph", "Connections contain a cycle");
	return structuredClone(value);
}

export function applyEdits(definition: DagDefinition, edits: GraphEdit[]): DagDefinition {
	const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
	const connections = new Map(
		definition.connections.map((connection) => [connection.id, connection]),
	);
	for (const edit of edits) {
		switch (edit.kind) {
			case "put-node":
				nodes.set(edit.node.id, edit.node);
				break;
			case "remove-node":
				if (!nodes.delete(edit.nodeId)) fail("not-found", `Unknown node ${edit.nodeId}`);
				break;
			case "put-connection":
				connections.set(edit.connection.id, edit.connection);
				break;
			case "remove-connection":
				if (!connections.delete(edit.connectionId))
					fail("not-found", `Unknown connection ${edit.connectionId}`);
				break;
		}
	}
	return validateDefinition({
		...definition,
		nodes: [...nodes.values()],
		connections: [...connections.values()],
	});
}

export function affectedNodes(before: DagDefinition, after: DagDefinition): Set<string> {
	const changed = new Set<string>();
	const oldNodes = new Map(before.nodes.map((node) => [node.id, node]));
	const newNodes = new Map(after.nodes.map((node) => [node.id, node]));
	for (const id of new Set([...oldNodes.keys(), ...newNodes.keys()])) {
		const oldNode = oldNodes.get(id);
		const newNode = newNodes.get(id);
		if (!oldNode || !newNode || canonicalJson(oldNode) !== canonicalJson(newNode)) changed.add(id);
	}
	const oldConnections = new Map(
		before.connections.map((connection) => [connection.id, connection]),
	);
	const newConnections = new Map(
		after.connections.map((connection) => [connection.id, connection]),
	);
	for (const id of new Set([...oldConnections.keys(), ...newConnections.keys()])) {
		const oldConnection = oldConnections.get(id);
		const newConnection = newConnections.get(id);
		if (
			oldConnection &&
			newConnection &&
			canonicalJson(oldConnection) === canonicalJson(newConnection)
		)
			continue;
		if (oldConnection) changed.add(endpoints(oldConnection).to);
		if (newConnection) changed.add(endpoints(newConnection).to);
	}
	let growing = true;
	while (growing) {
		growing = false;
		for (const connection of [...before.connections, ...after.connections]) {
			const { from, to } = endpoints(connection);
			if (from !== null && changed.has(from) && !changed.has(to)) {
				changed.add(to);
				growing = true;
			}
		}
	}
	return changed;
}
