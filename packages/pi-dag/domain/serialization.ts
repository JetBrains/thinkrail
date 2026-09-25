import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { fail } from "./errors.ts";
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

export function decodeBirth(value: unknown): Static<typeof birth> {
	if (!Check(birth, value)) fail("corrupt-state", "Invalid worker birth metadata");
	return value;
}

export function decodeState(value: unknown): DagState {
	if (!Check(StateSchema, value)) fail("corrupt-state", "Unsupported or malformed DAG snapshot");
	try {
		validateDefinition(value.definitionValue);
	} catch {
		fail("corrupt-state", "Stored graph is invalid");
	}
	for (const spec of value.definitionValue.nodes) {
		if (!value.nodes[spec.id]) fail("corrupt-state", `Missing node state ${spec.id}`);
	}
	for (const [id, storedNode] of Object.entries(value.nodes)) {
		if (id !== storedNode.id) fail("corrupt-state", "Node identity mismatch");
		for (const [i, storedAttempt] of storedNode.attempts.entries()) {
			if (storedAttempt.number !== i + 1)
				fail("corrupt-state", "Attempt numbering is not contiguous");
			if (storedAttempt.birth && storedAttempt.birth.resourceId !== value.dagId)
				fail("corrupt-state", "Child birth owner mismatch");
			if (storedAttempt.historyCaptureId && !value.captures[storedAttempt.historyCaptureId])
				fail("corrupt-state", "Missing consumed history capture");
			for (const [j, storedActivation] of storedAttempt.activations.entries()) {
				if (storedActivation.number !== j + 1)
					fail("corrupt-state", "Activation numbering is not contiguous");
				const matches = (target: { nodeId: string; attempt: number; activation: number }) =>
					target.nodeId === id &&
					target.attempt === storedAttempt.number &&
					target.activation === storedActivation.number;
				const output = storedActivation.proposalId
					? value.proposals[storedActivation.proposalId]
					: undefined;
				const input = storedActivation.gateId ? value.gates[storedActivation.gateId] : undefined;
				if (storedActivation.proposalId && (!output || !matches(output.target)))
					fail("corrupt-state", "Proposal producer mismatch");
				if (storedActivation.gateId && (!input || !matches(input.target)))
					fail("corrupt-state", "Input gate producer mismatch");
			}
		}
	}
	if (value.mainHistoryId && !value.captures[value.mainHistoryId])
		fail("corrupt-state", "Missing main capture");
	for (const [id, item] of Object.entries(value.captures)) {
		if (
			id !== item.sha256 ||
			item.file.sha256 !== item.sha256 ||
			item.file.sizeBytes !== item.sizeBytes
		)
			fail("corrupt-state", "Capture metadata mismatch");
	}
	for (const item of value.notices) {
		if (item.dagId !== value.dagId || item.version > value.version)
			fail("corrupt-state", "Invalid notice identity/version");
		if (item.kind === "disposed" || item.kind === "recovery") continue;
		const target = item.target;
		if (
			!target ||
			!value.nodes[target.nodeId]?.attempts[target.attempt - 1]?.activations[target.activation - 1]
		)
			fail("corrupt-state", "Missing notice target");
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
		if (
			!source ||
			source.nodeId !== target.nodeId ||
			source.attempt !== target.attempt ||
			source.activation !== target.activation
		)
			fail("corrupt-state", "Notice evidence mismatch");
	}
	for (const [id, item] of Object.entries(value.receipts)) {
		if (
			item.receipt.commandId !== id ||
			item.receipt.dagId !== value.dagId ||
			item.receipt.version > value.version
		)
			fail("corrupt-state", "Invalid receipt identity/version");
	}
	return value;
}
