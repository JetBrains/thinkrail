import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { canonicalJson, fail } from "./errors.ts";
import { validateDefinition } from "./graph.ts";
import {
	ActivationRefSchema,
	AuthoritySchema,
	DefinitionSchema,
	IdSchema,
	LIMITS,
} from "./schemas.ts";

const closed = { additionalProperties: false };
const text = Type.String();
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const nullableId = Type.Union([text, Type.Null()]);
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const file = Type.Object(
	{
		artifactId: hash,
		sha256: hash,
		sizeBytes: Type.Integer({ minimum: 0, maximum: LIMITS.historyBytes }),
	},
	closed,
);
const actor = Type.Union([
	Type.Object({ kind: Type.Literal("controller"), sessionId: text }, closed),
	Type.Object(
		{ kind: Type.Literal("human"), operatorId: text, conversationId: Type.Optional(text) },
		closed,
	),
	Type.Object({ kind: Type.Literal("owner"), ownerId: text }, closed),
]);
const decision = Type.Object(
	{ actor, reason: text, at: text, commandId: Type.Optional(IdSchema) },
	closed,
);
const value = Type.Object(
	{
		kind: Type.Union([Type.Literal("text"), Type.Literal("json"), Type.Literal("artifact")]),
		file,
		preview: Type.String({ maxLength: LIMITS.preview }),
	},
	closed,
);
const birth = Type.Object(
	{
		sessionId: text,
		resourceId: text,
		scope: text,
		originKind: Type.Union([Type.Literal("fresh"), Type.Literal("fork")]),
		entryId: Type.Optional(text),
		info: Type.Object(
			{ createdBy: text, roleName: Type.Optional(text), roleSource: Type.Optional(text) },
			closed,
		),
		interactive: Type.Literal(false),
		visibility: Type.Literal("hidden"),
		createdAt: text,
	},
	closed,
);
const runStatus = Type.Union([
	Type.Literal("completed"),
	Type.Literal("error"),
	Type.Literal("aborted"),
]);
const details = Type.Object(
	{
		childSessionId: text,
		roleName: Type.Optional(text),
		roleSource: Type.Optional(text),
		status: Type.Union([runStatus, Type.Literal("queued"), Type.Literal("running")]),
		model: Type.Optional(text),
		activity: Type.Optional(text),
		durationMs: Type.Number(),
		usage: Type.Object(
			{
				input: Type.Number(),
				output: Type.Number(),
				cacheRead: Type.Number(),
				cacheWrite: Type.Number(),
				cost: Type.Number(),
				turns: Type.Number(),
				contextTokens: Type.Number(),
			},
			closed,
		),
	},
	closed,
);
const outcome = Type.Object(
	{
		status: runStatus,
		details,
		finalText: Type.Optional(file),
		errorMessage: Type.Optional(file),
		historyEntryId: nullableId,
		stopReason: Type.Optional(
			Type.Union([
				Type.Literal("stop"),
				Type.Literal("toolUse"),
				Type.Literal("length"),
				Type.Literal("error"),
				Type.Literal("aborted"),
				Type.Literal("pending"),
				Type.Literal("deferred"),
			]),
		),
	},
	closed,
);
const activation = Type.Object(
	{
		number: positive,
		phase: Type.Union([
			Type.Literal("preparing"),
			Type.Literal("queued"),
			Type.Literal("running"),
			Type.Literal("settled"),
			Type.Literal("uncertain"),
		]),
		payload: file,
		createdAt: text,
		calls: Type.Optional(
			Type.Record(
				hash,
				Type.Object(
					{
						fingerprint: hash,
						id: IdSchema,
						kind: Type.Union([Type.Literal("proposal"), Type.Literal("input")]),
					},
					closed,
				),
				closed,
			),
		),
		outcome: Type.Optional(outcome),
		failure: Type.Optional(file),
		proposalId: Type.Optional(IdSchema),
		gateId: Type.Optional(IdSchema),
		interrupted: Type.Optional(Type.Boolean()),
	},
	closed,
);
const attempt = Type.Object(
	{
		number: positive,
		graphRevision: positive,
		configuration: file,
		reusedOutputs: Type.Optional(
			Type.Array(Type.Object({ proposalId: IdSchema, name: IdSchema }, closed)),
		),
		birth: Type.Optional(birth),
		inputs: Type.Array(
			Type.Object(
				{ connectionId: IdSchema, proposalId: IdSchema, output: IdSchema, input: IdSchema, value },
				closed,
			),
		),
		historyCaptureId: Type.Optional(hash),
		activations: Type.Array(activation),
		stale: Type.Boolean(),
	},
	closed,
);
const node = Type.Object(
	{
		id: IdSchema,
		taskFile: file,
		attempts: Type.Array(attempt),
		held: Type.Boolean(),
		cancelled: Type.Boolean(),
		skipped: Type.Optional(decision),
		continuation: Type.Optional(
			Type.Object({ payload: file, sourceActivation: Type.Optional(positive) }, closed),
		),
		retryOutputs: Type.Optional(
			Type.Array(Type.Object({ proposalId: IdSchema, name: IdSchema }, closed)),
		),
	},
	closed,
);
const proposal = Type.Object(
	{
		id: IdSchema,
		createdVersion: positive,
		target: ActivationRefSchema,
		outputs: Type.Record(IdSchema, value, closed),
		createdAt: text,
		disposition: Type.Union([
			Type.Literal("pending"),
			Type.Literal("accepted"),
			Type.Literal("rejected"),
			Type.Literal("superseded"),
		]),
		acceptance: Type.Optional(decision),
		historyCaptureId: Type.Optional(hash),
		historyRelease: Type.Optional(decision),
	},
	closed,
);
const gate = Type.Object(
	{
		id: IdSchema,
		kind: Type.Union([Type.Literal("approval"), Type.Literal("input")]),
		target: ActivationRefSchema,
		authority: AuthoritySchema,
		question: file,
		questionPreview: Type.String({ maxLength: LIMITS.preview }),
		proposalId: Type.Optional(IdSchema),
		historyCaptureId: Type.Optional(hash),
		disposition: Type.Union([
			Type.Literal("pending"),
			Type.Literal("approved"),
			Type.Literal("rejected"),
			Type.Literal("answered"),
			Type.Literal("superseded"),
		]),
		decision: Type.Optional(decision),
		answer: Type.Optional(file),
	},
	closed,
);
const capture = Type.Object(
	{
		format: Type.Literal("pi-session-branch-v1"),
		sourceSessionId: text,
		entryId: nullableId,
		sha256: hash,
		sizeBytes: count,
		file,
	},
	closed,
);
const receipt = Type.Object(
	{ commandId: IdSchema, dagId: IdSchema, version: positive, graphRevision: positive },
	closed,
);
const intervention = Type.Object(
	{
		commandId: IdSchema,
		target: ActivationRefSchema,
		text: file,
		status: Type.Union([
			Type.Literal("pending"),
			Type.Literal("offered"),
			Type.Literal("not-enqueued"),
			Type.Literal("settled"),
			Type.Literal("superseded"),
		]),
		offeredVersion: Type.Optional(positive),
	},
	closed,
);
const history = Type.Object(
	{
		id: IdSchema,
		version: positive,
		at: text,
		kind: text,
		actor: Type.Optional(actor),
		target: Type.Optional(ActivationRefSchema),
		content: file,
		files: Type.Array(file),
	},
	closed,
);
const notice = Type.Object(
	{
		dagId: IdSchema,
		noticeId: IdSchema,
		version: positive,
		kind: Type.Union([
			Type.Literal("waiting"),
			Type.Literal("attention"),
			Type.Literal("completed"),
			Type.Literal("recovery"),
			Type.Literal("disposed"),
		]),
		text,
		target: Type.Optional(ActivationRefSchema),
		gateId: Type.Optional(IdSchema),
		proposalId: Type.Optional(IdSchema),
	},
	closed,
);
const StateSchema = Type.Object(
	{
		schemaVersion: Type.Literal(1),
		scope: text,
		dagId: IdSchema,
		title: text,
		version: positive,
		graphRevision: positive,
		mode: Type.Union([Type.Literal("paused"), Type.Literal("running")]),
		lifecycle: Type.Union([
			Type.Literal("active"),
			Type.Literal("disposing"),
			Type.Literal("disposed"),
		]),
		createdAt: text,
		updatedAt: text,
		definitionValue: DefinitionSchema,
		definitionFile: file,
		profile: Type.Object({ cwd: text }, closed),
		nodes: Type.Record(IdSchema, node, closed),
		proposals: Type.Record(IdSchema, proposal, closed),
		gates: Type.Record(IdSchema, gate, closed),
		captures: Type.Record(hash, capture, closed),
		mainHistoryId: Type.Optional(hash),
		receipts: Type.Record(
			IdSchema,
			Type.Object(
				{ authority: Type.Optional(AuthoritySchema), fingerprint: hash, receipt },
				closed,
			),
			closed,
		),
		interventions: Type.Array(intervention),
		history: Type.Array(history),
		notices: Type.Array(notice),
		attachments: Type.Array(text),
	},
	closed,
);

export type StoredFile = Static<typeof file>;
export type StoredValue = Static<typeof value>;
export type DagCaller = Static<typeof actor>;
export type DecisionRecord = Static<typeof decision>;
export type DagReceipt = Static<typeof receipt>;
export type DagNotice = Static<typeof notice>;
export type StoredOutcome = Static<typeof outcome>;
export type Activation = Static<typeof activation>;
export type Attempt = Static<typeof attempt>;
export type ConsumedInput = Attempt["inputs"][number];
export type NodeRecord = Static<typeof node>;
export type Proposal = Static<typeof proposal>;
export type Gate = Static<typeof gate>;
export type Intervention = Static<typeof intervention>;
export type DagState = Static<typeof StateSchema>;

function storedFileIdentity(value: StoredFile): void {
	if (value.artifactId !== value.sha256)
		fail("corrupt-state", "Stored file identity does not match its digest");
}

function storageSegment(value: string): boolean {
	return /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(value);
}

export function decodeBirth(value: unknown): Static<typeof birth> {
	if (!Check(birth, value)) fail("corrupt-state", "Invalid worker birth metadata");
	if (
		!storageSegment(value.sessionId) ||
		!storageSegment(value.resourceId) ||
		!storageSegment(value.scope) ||
		!value.info.createdBy ||
		!Number.isFinite(Date.parse(value.createdAt)) ||
		(value.originKind === "fresh" && value.entryId !== undefined) ||
		(value.entryId !== undefined && value.entryId.length === 0)
	)
		fail("corrupt-state", "Invalid worker birth metadata");
	return value;
}

export function decodeState(value: unknown): DagState {
	if (!Check(StateSchema, value)) fail("corrupt-state", "Unsupported or malformed DAG snapshot");
	try {
		validateDefinition(value.definitionValue);
	} catch {
		fail("corrupt-state", "Stored graph is invalid");
	}
	if (value.graphRevision > value.version)
		fail("corrupt-state", "Snapshot graph revision is from the future");
	storedFileIdentity(value.definitionFile);

	for (const [id, item] of Object.entries(value.captures)) {
		storedFileIdentity(item.file);
		if (
			id !== item.sha256 ||
			item.file.sha256 !== item.sha256 ||
			item.file.sizeBytes !== item.sizeBytes
		)
			fail("corrupt-state", "Capture metadata mismatch");
	}
	if (value.mainHistoryId && !value.captures[value.mainHistoryId])
		fail("corrupt-state", "Missing main capture");

	for (const spec of value.definitionValue.nodes) {
		if (!value.nodes[spec.id]) fail("corrupt-state", `Missing node state ${spec.id}`);
	}
	for (const [id, storedNode] of Object.entries(value.nodes)) {
		if (id !== storedNode.id) fail("corrupt-state", "Node identity mismatch");
		storedFileIdentity(storedNode.taskFile);
		if (storedNode.continuation) storedFileIdentity(storedNode.continuation.payload);
		for (const [i, storedAttempt] of storedNode.attempts.entries()) {
			if (storedAttempt.number !== i + 1 || storedAttempt.activations.length === 0)
				fail("corrupt-state", "Attempt numbering or activation evidence is invalid");
			if (storedAttempt.graphRevision > value.graphRevision)
				fail("corrupt-state", "Attempt graph revision is from the future");
			storedFileIdentity(storedAttempt.configuration);
			if (storedAttempt.birth) {
				decodeBirth(storedAttempt.birth);
				if (storedAttempt.birth.resourceId !== value.dagId)
					fail("corrupt-state", "Child birth owner mismatch");
			}
			if (storedAttempt.historyCaptureId && !value.captures[storedAttempt.historyCaptureId])
				fail("corrupt-state", "Missing consumed history capture");
			for (const input of storedAttempt.inputs) storedFileIdentity(input.value.file);
			for (const [j, storedActivation] of storedAttempt.activations.entries()) {
				if (storedActivation.number !== j + 1)
					fail("corrupt-state", "Activation numbering is not contiguous");
				storedFileIdentity(storedActivation.payload);
				if (storedActivation.failure) storedFileIdentity(storedActivation.failure);
				if (storedActivation.proposalId && storedActivation.gateId)
					fail("corrupt-state", "Activation has conflicting protocol evidence");
				if (storedActivation.outcome) {
					const observed = storedActivation.outcome;
					if (observed.status !== observed.details.status)
						fail("corrupt-state", "Outcome and run details disagree");
					if (
						storedAttempt.birth &&
						observed.details.childSessionId !== storedAttempt.birth.sessionId
					)
						fail("corrupt-state", "Outcome child identity does not match its birth");
					if (observed.finalText) storedFileIdentity(observed.finalText);
					if (observed.errorMessage) storedFileIdentity(observed.errorMessage);
				}
			}
		}
	}

	const targetRecord = (target: { nodeId: string; attempt: number; activation: number }) => {
		const node = value.nodes[target.nodeId];
		const storedAttempt = node?.attempts[target.attempt - 1];
		const storedActivation = storedAttempt?.activations[target.activation - 1];
		return storedAttempt?.number === target.attempt &&
			storedActivation?.number === target.activation
			? { node, attempt: storedAttempt, activation: storedActivation }
			: undefined;
	};
	const sameTarget = (
		left: { nodeId: string; attempt: number; activation: number },
		right: { nodeId: string; attempt: number; activation: number },
	) =>
		left.nodeId === right.nodeId &&
		left.attempt === right.attempt &&
		left.activation === right.activation;

	for (const [id, item] of Object.entries(value.proposals)) {
		if (id !== item.id || !targetRecord(item.target) || item.createdVersion > value.version)
			fail("corrupt-state", "Invalid proposal identity, target or version");
		for (const output of Object.values(item.outputs)) storedFileIdentity(output.file);
		if (item.historyCaptureId && !value.captures[item.historyCaptureId])
			fail("corrupt-state", "Missing proposal history capture");
		if (item.historyRelease && !item.historyCaptureId)
			fail("corrupt-state", "Released history has no captured evidence");
		if (item.disposition === "accepted" && !item.acceptance)
			fail("corrupt-state", "Accepted proposal has no decision");
		if (item.disposition === "pending" && item.acceptance)
			fail("corrupt-state", "Pending proposal already has an acceptance decision");
	}

	for (const [id, item] of Object.entries(value.gates)) {
		if (id !== item.id || !targetRecord(item.target))
			fail("corrupt-state", "Invalid gate identity or target");
		storedFileIdentity(item.question);
		if (item.answer) storedFileIdentity(item.answer);
		if (item.historyCaptureId && !value.captures[item.historyCaptureId])
			fail("corrupt-state", "Missing gate history capture");
		const guardedProposal = item.proposalId ? value.proposals[item.proposalId] : undefined;
		if (item.kind === "approval") {
			if (
				!guardedProposal ||
				!sameTarget(guardedProposal.target, item.target) ||
				guardedProposal.historyCaptureId !== item.historyCaptureId ||
				item.answer ||
				item.disposition === "answered"
			)
				fail("corrupt-state", "Approval gate evidence is inconsistent");
		} else if (
			item.proposalId ||
			item.historyCaptureId ||
			item.disposition === "approved" ||
			item.disposition === "rejected"
		)
			fail("corrupt-state", "Input gate evidence is inconsistent");
		if (item.disposition === "pending" && (item.decision || item.answer))
			fail("corrupt-state", "Pending gate already has a decision");
		if (
			item.disposition === "answered" &&
			(item.kind !== "input" || !item.decision || !item.answer)
		)
			fail("corrupt-state", "Answered input gate lacks evidence");
		if (
			(item.disposition === "approved" || item.disposition === "rejected") &&
			(item.kind !== "approval" || !item.decision)
		)
			fail("corrupt-state", "Decided approval gate lacks evidence");
		if (item.answer && (item.kind !== "input" || !item.decision))
			fail("corrupt-state", "Gate answer has no input decision");
	}

	const selection = (proposalId: string, name: string) => {
		const selected = value.proposals[proposalId]?.outputs[name];
		if (!selected) fail("corrupt-state", "Stored output selection is missing");
		return selected;
	};
	for (const storedNode of Object.values(value.nodes)) {
		for (const retry of storedNode.retryOutputs ?? []) selection(retry.proposalId, retry.name);
		for (const storedAttempt of storedNode.attempts) {
			for (const reused of storedAttempt.reusedOutputs ?? [])
				selection(reused.proposalId, reused.name);
			for (const input of storedAttempt.inputs) {
				const selected = selection(input.proposalId, input.output);
				if (canonicalJson(selected) !== canonicalJson(input.value))
					fail("corrupt-state", "Consumed input does not match proposal evidence");
			}
			for (const storedActivation of storedAttempt.activations) {
				const target = {
					nodeId: storedNode.id,
					attempt: storedAttempt.number,
					activation: storedActivation.number,
				};
				const output = storedActivation.proposalId
					? value.proposals[storedActivation.proposalId]
					: undefined;
				const input = storedActivation.gateId ? value.gates[storedActivation.gateId] : undefined;
				if (storedActivation.proposalId && (!output || !sameTarget(output.target, target)))
					fail("corrupt-state", "Proposal producer mismatch");
				if (
					storedActivation.gateId &&
					(input?.kind !== "input" || !sameTarget(input.target, target))
				)
					fail("corrupt-state", "Input gate producer mismatch");
				for (const call of Object.values(storedActivation.calls ?? {})) {
					const evidence =
						call.kind === "proposal" ? value.proposals[call.id] : value.gates[call.id];
					if (
						!evidence ||
						(call.kind === "input" && "kind" in evidence && evidence.kind !== "input") ||
						!sameTarget(evidence.target, target)
					)
						fail("corrupt-state", "Worker call receipt has no matching evidence");
				}
			}
		}
	}

	const historyIds = new Set<string>();
	for (const item of value.history) {
		if (historyIds.has(item.id) || item.version > value.version)
			fail("corrupt-state", "Invalid history identity or version");
		historyIds.add(item.id);
		if (item.target && !targetRecord(item.target)) fail("corrupt-state", "Missing history target");
		storedFileIdentity(item.content);
		for (const file of item.files) storedFileIdentity(file);
	}
	const interventionIds = new Set<string>();
	for (const item of value.interventions) {
		if (interventionIds.has(item.commandId) || !targetRecord(item.target))
			fail("corrupt-state", "Invalid intervention identity or target");
		interventionIds.add(item.commandId);
		storedFileIdentity(item.text);
	}
	const noticeIds = new Set<string>();
	for (const item of value.notices) {
		if (noticeIds.has(item.noticeId) || item.dagId !== value.dagId || item.version > value.version)
			fail("corrupt-state", "Invalid notice identity/version");
		noticeIds.add(item.noticeId);
		if (item.kind === "disposed" || item.kind === "recovery") continue;
		const target = item.target;
		if (!target || !targetRecord(target)) fail("corrupt-state", "Missing notice target");
		const source =
			item.kind === "waiting"
				? item.gateId
					? value.gates[item.gateId]?.target
					: undefined
				: item.kind === "completed"
					? item.proposalId
						? value.proposals[item.proposalId]?.target
						: undefined
					: target;
		if (!source || !sameTarget(source, target)) fail("corrupt-state", "Notice evidence mismatch");
	}
	for (const [id, item] of Object.entries(value.receipts)) {
		if (
			item.receipt.commandId !== id ||
			item.receipt.dagId !== value.dagId ||
			item.receipt.version > value.version ||
			item.receipt.graphRevision > value.graphRevision
		)
			fail("corrupt-state", "Invalid receipt identity/version");
	}
	if (new Set(value.attachments).size !== value.attachments.length)
		fail("corrupt-state", "Duplicate notice attachment");
	return value;
}
