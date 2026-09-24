import { expect, test } from "bun:test";
import {
	type Activation,
	type DagState,
	decodeBirth,
	decodeState,
	type NodeRecord,
	prepareEdit,
	type StoredFile,
	successful,
} from "./index.ts";

const file: StoredFile = { artifactId: "a".repeat(64), sha256: "a".repeat(64), sizeBytes: 10 };
const actor = { kind: "human", operatorId: "operator" } as const;
function fixture() {
	const activation: Activation = {
		number: 1,
		phase: "settled",
		createdAt: "now",
		payload: file,
		outcome: {
			status: "completed",
			stopReason: "toolUse",
			historyEntryId: "cut",
			details: {
				childSessionId: "worker",
				status: "completed",
				durationMs: 1,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					cost: 0,
					turns: 1,
					contextTokens: 0,
				},
			},
		},
	};
	const node: NodeRecord = {
		id: "worker",
		taskFile: file,
		held: false,
		cancelled: false,
		attempts: [
			{
				number: 1,
				graphRevision: 1,
				configuration: file,
				inputs: [],
				stale: false,
				activations: [activation],
			},
		],
	};
	const state: DagState = {
		schemaVersion: 1,
		scope: "test",
		dagId: "dag-test",
		title: "Test",
		version: 1,
		graphRevision: 1,
		mode: "paused",
		lifecycle: "active",
		createdAt: "now",
		updatedAt: "now",
		definitionValue: {
			title: "Test",
			defaults: { tools: [] },
			nodes: [{ id: "worker", task: "Work", outputs: {} }],
			connections: [],
		},
		definitionFile: file,
		profile: { cwd: "/tmp" },
		nodes: { worker: node },
		proposals: {},
		gates: {},
		captures: {},
		receipts: {},
		interventions: [],
		history: [],
		notices: [],
		attachments: [],
	};
	return { state, node, activation };
}

test("strict snapshots round-trip and reject unknown schema or missing domain evidence", () => {
	const { state, activation } = fixture();
	expect(decodeState(JSON.parse(JSON.stringify(state)))).toEqual(state);
	for (const invalid of [{ schemaVersion: 2 }, { nodes: {} }, { unexpected: true }])
		expect(() => decodeState({ ...state, ...invalid })).toThrow();
	activation.proposalId = "absent";
	expect(() => decodeState(state)).toThrow("Proposal producer mismatch");
});

test("worker births use the stored schema without broadening delegation modes", () => {
	const birth = {
		sessionId: "worker",
		resourceId: "dag-test",
		scope: "delegation",
		originKind: "fork",
		entryId: "cut",
		info: { createdBy: "dag" },
		interactive: false,
		visibility: "hidden",
		createdAt: "now",
	} as const;
	expect(decodeBirth(birth)).toEqual(birth);
	for (const invalid of [{ originKind: "seeded" }, { interactive: true }, { visibility: "listed" }])
		expect(() => decodeBirth({ ...birth, ...invalid })).toThrow("birth");
});

test("continuations retain legacy snapshot compatibility without accepting malformed metadata", () => {
	const { state, node } = fixture();
	Object.assign(node, { continuation: { payload: file } });
	expect(decodeState(state).nodes.worker?.continuation).toEqual({ payload: file });
	Object.assign(node, { continuation: { payload: file, sourceActivation: 1 } });
	expect(() => decodeState(state)).not.toThrow();
	for (const invalid of [{ sourceActivation: 0 }, { unexpected: true }]) {
		Object.assign(node, { continuation: { payload: file, ...invalid } });
		expect(() => decodeState(state)).toThrow("snapshot");
	}
});

test("default human input policy is protected before the first gate", () => {
	const { state, node } = fixture();
	node.attempts = [];
	const edits = [
		{
			kind: "put-node" as const,
			node: {
				id: "worker",
				task: "Work",
				outputs: {},
				inputAuthority: "human-or-controller" as const,
			},
		},
	];
	expect(() => prepareEdit(state, edits, { kind: "controller" })).toThrow("human input policy");
	expect(prepareEdit(state, edits, actor).authority).toBe("human");
});

test("human release and historical input policies cannot be removed by controllers", () => {
	const { state, node } = fixture();
	state.gates.input = {
		id: "input",
		kind: "input",
		target: { nodeId: "worker", attempt: 1, activation: 1 },
		authority: "human",
		question: file,
		questionPreview: "Decide",
		disposition: "superseded",
	};
	const edits = state.definitionValue.nodes.map((node) => ({
		kind: "put-node" as const,
		node: { ...node, inputAuthority: "human-or-controller" as const },
	}));
	expect(() => prepareEdit(state, edits, { kind: "controller" })).toThrow("human input policy");
	expect(prepareEdit(state, edits, actor).authority).toBe("human");
	state.gates = {};
	node.attempts = [];
	const remove = { kind: "put-node" as const, node: { id: "worker", task: "Work", outputs: {} } };
	state.definitionValue.nodes = [
		{ ...remove.node, approval: { authority: "human", question: "Approve first" } },
	];
	expect(() => prepareEdit(state, [remove], { kind: "controller" })).toThrow("human-only release");
	expect(prepareEdit(state, [remove], actor).authority).toBe("human");
});

test("a terminal completed wrapper is insufficient without positive assistant evidence", () => {
	const { activation } = fixture();
	const outcome = activation.outcome;
	if (!outcome) throw new Error("Missing fixture outcome");
	expect(successful(activation)).toBe(true);
	outcome.stopReason = "length";
	expect(successful(activation)).toBe(false);
	delete outcome.stopReason;
	expect(successful(activation)).toBe(false);
	outcome.stopReason = "stop";
	outcome.status = "aborted";
	expect(successful(activation)).toBe(false);
});
