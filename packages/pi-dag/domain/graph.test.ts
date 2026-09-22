import { describe, expect, test } from "bun:test";
import {
	affectedNodes,
	applyEdits,
	canonicalJson,
	type DagDefinition,
	validateDefinition,
} from "./index.ts";

const graph = (): DagDefinition => ({
	title: "Explore then build",
	defaults: { tools: [] },
	nodes: [
		{ id: "explore", task: "Explore", outputs: { findings: { kind: "text" } } },
		{ id: "build", task: "Build", inputs: { plan: { kind: "text" } }, outputs: {} },
	],
	connections: [
		{
			id: "research",
			kind: "data",
			from: { nodeId: "explore", output: "findings" },
			to: { nodeId: "build", input: "plan" },
			context: "fork",
		},
	],
});

describe("DAG definitions", () => {
	test("accepts an explicit fork on an existing typed dependency", () => {
		const input = graph();
		const accepted = validateDefinition(input);
		expect(accepted).toEqual(input);
		expect(accepted).not.toBe(input);
	});

	test("rejects cycles in the same data/control graph", () => {
		const input = graph();
		expect(() =>
			validateDefinition({
				...input,
				connections: [
					...input.connections,
					{ id: "back", kind: "control", from: "build", to: "explore", allowSkipped: false },
				],
			}),
		).toThrow("cycle");
	});

	test("rejects a second inherited base without inventing a history merge", () => {
		const input = graph();
		expect(() =>
			validateDefinition({
				...input,
				connections: [
					...input.connections,
					{ id: "main", kind: "control", from: { kind: "main" }, to: "build", context: "fork" },
				],
			}),
		).toThrow("multiple inherited");
	});

	test("required ports need one compatible producer", () => {
		const input = graph();
		expect(() => validateDefinition({ ...input, connections: [] })).toThrow("no producer");
		expect(() =>
			validateDefinition({
				...input,
				connections: [
					...input.connections,
					{
						id: "duplicate",
						kind: "data",
						from: { nodeId: "explore", output: "findings" },
						to: { nodeId: "build", input: "plan" },
					},
				],
			}),
		).toThrow("multiple producers");
		expect(() =>
			validateDefinition({
				...input,
				nodes: [
					input.nodes[0],
					{ id: "build", task: "Build", inputs: { plan: { kind: "json" } }, outputs: {} },
				],
			}),
		).toThrow("incompatible");
	});

	test("skipping cannot manufacture a conversation", () => {
		expect(() =>
			validateDefinition({
				title: "Skip",
				defaults: { tools: [] },
				nodes: [
					{ id: "a", task: "a", outputs: {} },
					{ id: "b", task: "b", outputs: {} },
				],
				connections: [
					{ id: "ab", kind: "control", from: "a", to: "b", allowSkipped: true, context: "fork" },
				],
			}),
		).toThrow("cannot be skipped");
	});

	test("ordinary dependencies do not infer context inheritance", () => {
		const input = graph();
		const connection = input.connections[0];
		if (!connection) throw new Error("Missing fixture connection");
		const { context: _context, ...ordinary } = connection;
		const accepted = validateDefinition({ ...input, connections: [ordinary] });
		expect(accepted.connections[0]?.context).toBeUndefined();
	});

	test("edits are atomic and invalidation includes descendants", () => {
		const before = validateDefinition(graph());
		const explorer = before.nodes[0];
		if (!explorer) throw new Error("Missing fixture node");
		const after = applyEdits(before, [
			{ kind: "put-node", node: { ...explorer, task: "Changed exploration" } },
		]);
		expect([...affectedNodes(before, after)].sort()).toEqual(["build", "explore"]);
		expect(before.nodes[0]?.task).toBe("Explore");
		expect(() => applyEdits(before, [{ kind: "remove-node", nodeId: "explore" }])).toThrow(
			"Unknown endpoint",
		);
	});

	test("enforces admission and safe identifier bounds", () => {
		const input = graph();
		expect(() =>
			validateDefinition({
				...input,
				nodes: Array.from({ length: 129 }, (_, n) => ({ id: `n${n}`, task: "t", outputs: {} })),
			}),
		).toThrow("schema");
		expect(() =>
			validateDefinition({ ...input, nodes: [{ id: "../outside", task: "t", outputs: {} }] }),
		).toThrow("schema");
		expect(() =>
			validateDefinition({ ...input, nodes: [{ id: "constructor", task: "t", outputs: {} }] }),
		).toThrow("schema");
		expect(() => validateDefinition({ ...input, title: "x".repeat(1024 * 1024 + 1) })).toThrow(
			"1 MiB",
		);
	});

	test("rejects undeclared prototype ports and malformed port names", () => {
		expect(() =>
			validateDefinition({
				title: "Invalid ports",
				defaults: { tools: [] },
				nodes: [
					{ id: "a", task: "a", outputs: {} },
					{ id: "b", task: "b", inputs: {}, outputs: {} },
				],
				connections: [
					{
						id: "ab",
						kind: "data",
						from: { nodeId: "a", output: "toString" },
						to: { nodeId: "b", input: "toString" },
					},
				],
			}),
		).toThrow();
		expect(() =>
			validateDefinition({
				title: "Invalid name",
				defaults: { tools: [] },
				nodes: [{ id: "a", task: "a", outputs: { "bad/name": { kind: "text" } } }],
				connections: [],
			}),
		).toThrow();
	});

	test("replay fingerprints ignore object key order but reject non-JSON data", () => {
		expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
			canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
		);
		expect(() => canonicalJson({ n: Number.NaN })).toThrow("finite JSON");
		expect(() => canonicalJson({ ignored: undefined })).toThrow("finite JSON");
		const cyclic: { self?: object } = {};
		cyclic.self = cyclic;
		expect(() => canonicalJson(cyclic)).toThrow("64 levels");
	});
});
