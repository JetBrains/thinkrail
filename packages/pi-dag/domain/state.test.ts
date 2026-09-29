import { expect, test } from "bun:test";
import {
	type Activation,
	authorizeGate,
	DagError,
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
		createdAt: "2026-01-02T03:04:05.000Z",
	} as const;
	expect(decodeBirth(birth)).toEqual(birth);
	for (const invalid of [
		{ originKind: "seeded" },
		{ originKind: "fresh", entryId: "cut" },
		{ entryId: "" },
		{ sessionId: "" },
		{ resourceId: "../dag" },
		{ createdAt: "not-a-date" },
		{ interactive: true },
		{ visibility: "listed" },
	])
		expect(() => decodeBirth({ ...birth, ...invalid })).toThrow("birth");
});

test("strict snapshots reject dangling evidence, impossible outcomes and mismatched artifacts", () => {
	const corruptions: Array<(state: DagState) => void> = [
		(state) => {
			const worker = state.nodes.worker;
			if (!worker) throw new Error("Missing worker");
			worker.taskFile = { ...worker.taskFile, sha256: "b".repeat(64) };
		},
		(state) => {
			state.proposals.proposal = {
				id: "proposal",
				createdVersion: 1,
				target: { nodeId: "worker", attempt: 2, activation: 1 },
				outputs: {},
				createdAt: "now",
				disposition: "pending",
			};
		},
		(state) => {
			state.proposals.key = {
				id: "different",
				createdVersion: 1,
				target: { nodeId: "worker", attempt: 1, activation: 1 },
				outputs: {},
				createdAt: "now",
				disposition: "pending",
			};
		},
		(state) => {
			const worker = state.nodes.worker;
			const activation = worker?.attempts[0]?.activations[0];
			if (!activation) throw new Error("Missing activation");
			activation.calls = {
				["c".repeat(64)]: {
					fingerprint: "f".repeat(64),
					id: "missing",
					kind: "proposal",
				},
			};
		},
		(state) => {
			const activation = state.nodes.worker?.attempts[0]?.activations[0];
			if (!activation) throw new Error("Missing activation");
			const target = { nodeId: "worker", attempt: 1, activation: 1 };
			state.proposals.proposal = {
				id: "proposal",
				createdVersion: 1,
				target,
				outputs: {},
				createdAt: "now",
				disposition: "pending",
			};
			state.gates.approval = {
				id: "approval",
				kind: "approval",
				target,
				authority: "human",
				question: file,
				questionPreview: "Approve",
				proposalId: "proposal",
				disposition: "pending",
			};
			activation.calls = {
				["c".repeat(64)]: {
					fingerprint: "f".repeat(64),
					id: "approval",
					kind: "input",
				},
			};
		},
		(state) => {
			const outcome = state.nodes.worker?.attempts[0]?.activations[0]?.outcome;
			if (!outcome) throw new Error("Missing outcome");
			outcome.details.status = "running";
		},
		(state) => {
			const activation = state.nodes.worker?.attempts[0]?.activations[0];
			if (!activation) throw new Error("Missing activation");
			state.proposals.proposal = {
				id: "proposal",
				createdVersion: 1,
				target: { nodeId: "worker", attempt: 1, activation: 1 },
				outputs: {},
				createdAt: "now",
				disposition: "accepted",
			};
			activation.proposalId = "proposal";
		},
	];
	for (const corrupt of corruptions) {
		const { state } = fixture();
		corrupt(state);
		try {
			decodeState(state);
			throw new Error("Expected corrupt state rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(DagError);
			if (!(error instanceof DagError)) throw error;
			expect(error.failure.code).toBe("corrupt-state");
		}
	}
});

test("historical approval gates retain the evidence scope they actually decided", () => {
	const { state, activation } = fixture();
	const captureId = "b".repeat(64);
	const captureFile: StoredFile = { artifactId: captureId, sha256: captureId, sizeBytes: 10 };
	const target = { nodeId: "worker", attempt: 1, activation: 1 };
	const decision = { actor, reason: "approved output", at: "now" };
	state.captures[captureId] = {
		format: "pi-session-branch-v1",
		sourceSessionId: "worker",
		entryId: null,
		sha256: captureId,
		sizeBytes: captureFile.sizeBytes,
		file: captureFile,
	};
	state.proposals.proposal = {
		id: "proposal",
		createdVersion: 1,
		target,
		outputs: {},
		createdAt: "now",
		disposition: "accepted",
		acceptance: decision,
		historyCaptureId: captureId,
	};
	activation.proposalId = "proposal";
	state.gates.output = {
		id: "output",
		kind: "approval",
		target,
		authority: "human",
		question: file,
		questionPreview: "Release output?",
		proposalId: "proposal",
		disposition: "approved",
		decision,
	};
	expect(() => decodeState(state)).not.toThrow();
});

test("persisted gate decisions must satisfy the gate's stored authority", () => {
	for (const kind of ["approval", "input"] as const) {
		const { state, activation } = fixture();
		const target = { nodeId: "worker", attempt: 1, activation: 1 };
		const decision = {
			actor: { kind: "controller" as const, sessionId: "controller" },
			reason: "not authorized",
			at: "now",
		};
		if (kind === "approval") {
			state.proposals.proposal = {
				id: "proposal",
				createdVersion: 1,
				target,
				outputs: {},
				createdAt: "now",
				disposition: "pending",
			};
			activation.proposalId = "proposal";
			state.gates.gate = {
				id: "gate",
				kind,
				target,
				authority: "human",
				question: file,
				questionPreview: "Approve?",
				proposalId: "proposal",
				disposition: "approved",
				decision,
			};
		} else {
			activation.gateId = "gate";
			state.gates.gate = {
				id: "gate",
				kind,
				target,
				authority: "human",
				question: file,
				questionPreview: "Answer?",
				disposition: "answered",
				decision,
				answer: file,
			};
		}
		expect(() => decodeState(state)).toThrow(DagError);
		state.gates.gate.decision = { ...decision, actor };
		expect(() => decodeState(state)).not.toThrow();
	}
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

test("gate authority admits only the caller kinds named by the policy", () => {
	const human = { kind: "human", operatorId: "operator" } as const;
	const controller = { kind: "controller", sessionId: "session" } as const;
	const owner = { kind: "owner", ownerId: "host" } as const;
	expect(() => authorizeGate(human, "human")).not.toThrow();
	expect(() => authorizeGate(controller, "human")).toThrow("human");
	expect(() => authorizeGate(owner, "human")).toThrow("human");
	expect(() => authorizeGate(human, "human-or-controller")).not.toThrow();
	expect(() => authorizeGate(controller, "human-or-controller")).not.toThrow();
	expect(() => authorizeGate(owner, "human-or-controller")).toThrow("human or controller");
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
