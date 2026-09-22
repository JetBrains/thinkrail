import { type Static, Type } from "typebox";

export const LIMITS = {
	nodes: 128,
	connections: 512,
	ports: 32,
	definitionBytes: 1024 * 1024,
	valueBytes: 16 * 1024 * 1024,
	historyBytes: 32 * 1024 * 1024,
	page: 100,
	preview: 512,
} as const;

const closed = { additionalProperties: false };
export const IdSchema = Type.String({
	minLength: 1,
	maxLength: 128,
	pattern:
		"^(?!(?:constructor|prototype|toString|toLocaleString|valueOf|hasOwnProperty|isPrototypeOf|propertyIsEnumerable)$)[a-zA-Z0-9][a-zA-Z0-9._-]*$",
});
const TextSchema = Type.String({ maxLength: LIMITS.definitionBytes });
const ReasonSchema = Type.String({ minLength: 1, maxLength: 4096 });
const NumberSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
export const JsonSchema = Type.Cyclic(
	{
		Json: Type.Union([
			Type.Null(),
			Type.Boolean(),
			Type.Number(),
			Type.String(),
			Type.Array(Type.Ref("Json")),
			Type.Record(Type.String(), Type.Ref("Json")),
		]),
	},
	"Json",
);
export type JsonValue = Static<typeof JsonSchema>;

export const AuthoritySchema = Type.Union([
	Type.Literal("human"),
	Type.Literal("human-or-controller"),
]);
export const ValueSpecSchema = Type.Object(
	{
		kind: Type.Union([Type.Literal("text"), Type.Literal("json"), Type.Literal("artifact")]),
	},
	closed,
);
const PortsSchema = Type.Record(IdSchema, ValueSpecSchema, {
	...closed,
	maxProperties: LIMITS.ports,
});
export const SessionSchema = Type.Object(
	{
		model: Type.Optional(
			Type.Object(
				{
					provider: Type.String({ minLength: 1, maxLength: 256 }),
					id: Type.String({ minLength: 1, maxLength: 256 }),
				},
				closed,
			),
		),
		thinkingLevel: Type.Optional(
			Type.Union([
				Type.Literal("off"),
				Type.Literal("minimal"),
				Type.Literal("low"),
				Type.Literal("medium"),
				Type.Literal("high"),
				Type.Literal("xhigh"),
				Type.Literal("max"),
			]),
		),
		tools: Type.Array(IdSchema, { maxItems: 64, uniqueItems: true }),
		systemPrompt: Type.Optional(TextSchema),
		contextFiles: Type.Optional(Type.Boolean()),
		skills: Type.Optional(
			Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
				maxItems: 64,
				uniqueItems: true,
			}),
		),
	},
	closed,
);
export const NodeSchema = Type.Object(
	{
		id: IdSchema,
		task: TextSchema,
		session: Type.Optional(Type.Partial(SessionSchema)),
		inputs: Type.Optional(PortsSchema),
		outputs: PortsSchema,
		approval: Type.Optional(
			Type.Object({ authority: AuthoritySchema, question: TextSchema }, closed),
		),
		inputAuthority: Type.Optional(AuthoritySchema),
	},
	closed,
);
export const ConnectionSchema = Type.Union([
	Type.Object(
		{
			id: IdSchema,
			kind: Type.Literal("data"),
			from: Type.Object({ nodeId: IdSchema, output: IdSchema }, closed),
			to: Type.Object({ nodeId: IdSchema, input: IdSchema }, closed),
			context: Type.Optional(Type.Literal("fork")),
		},
		closed,
	),
	Type.Object(
		{
			id: IdSchema,
			kind: Type.Literal("control"),
			from: IdSchema,
			to: IdSchema,
			allowSkipped: Type.Boolean(),
			context: Type.Optional(Type.Literal("fork")),
		},
		closed,
	),
	Type.Object(
		{
			id: IdSchema,
			kind: Type.Literal("control"),
			from: Type.Object({ kind: Type.Literal("main") }, closed),
			to: IdSchema,
			context: Type.Literal("fork"),
		},
		closed,
	),
]);
export const DefinitionSchema = Type.Object(
	{
		title: Type.String({ minLength: 1, maxLength: 512 }),
		defaults: SessionSchema,
		maxConcurrent: Type.Optional(Type.Integer({ minimum: 1, maximum: 16 })),
		nodes: Type.Array(NodeSchema, { minItems: 1, maxItems: LIMITS.nodes }),
		connections: Type.Array(ConnectionSchema, { maxItems: LIMITS.connections }),
	},
	closed,
);
export const EditSchema = Type.Union([
	Type.Object({ kind: Type.Literal("put-node"), node: NodeSchema }, closed),
	Type.Object({ kind: Type.Literal("remove-node"), nodeId: IdSchema }, closed),
	Type.Object({ kind: Type.Literal("put-connection"), connection: ConnectionSchema }, closed),
	Type.Object({ kind: Type.Literal("remove-connection"), connectionId: IdSchema }, closed),
]);
export const AttemptRefSchema = Type.Object({ nodeId: IdSchema, attempt: NumberSchema }, closed);
export const ActivationRefSchema = Type.Object(
	{ nodeId: IdSchema, attempt: NumberSchema, activation: NumberSchema },
	closed,
);
const DagTargetSchema = Type.Object({ kind: Type.Literal("dag") }, closed);
const NodeTargetSchema = Type.Object({ kind: Type.Literal("node"), nodeId: IdSchema }, closed);
const ActivationTargetSchema = Type.Object(
	{
		kind: Type.Literal("activation"),
		nodeId: IdSchema,
		attempt: NumberSchema,
		activation: NumberSchema,
	},
	closed,
);
export const ControlSchema = Type.Union([
	Type.Object(
		{
			kind: Type.Union([
				Type.Literal("pause"),
				Type.Literal("resume"),
				Type.Literal("dispose"),
				Type.Literal("attach-notices"),
				Type.Literal("detach-notices"),
			]),
		},
		closed,
	),
	Type.Object(
		{
			kind: Type.Literal("interrupt"),
			target: Type.Union([DagTargetSchema, ActivationTargetSchema]),
		},
		closed,
	),
	Type.Object(
		{ kind: Type.Literal("cancel"), target: Type.Union([DagTargetSchema, NodeTargetSchema]) },
		closed,
	),
	Type.Object({ kind: Type.Literal("skip"), nodeId: IdSchema, reason: ReasonSchema }, closed),
	Type.Object(
		{ kind: Type.Literal("steer"), target: ActivationRefSchema, text: TextSchema },
		closed,
	),
	Type.Object(
		{
			kind: Type.Literal("continue"),
			target: ActivationRefSchema,
			instructions: Type.Optional(TextSchema),
		},
		closed,
	),
	Type.Object(
		{
			kind: Type.Literal("retry"),
			target: AttemptRefSchema,
			previousOutputs: Type.Optional(
				Type.Array(Type.Object({ proposalId: IdSchema, name: IdSchema }, closed), {
					maxItems: LIMITS.ports,
				}),
			),
		},
		closed,
	),
]);
export const DecisionSchema = Type.Union([
	Type.Object(
		{
			kind: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
			gateId: IdSchema,
			reason: ReasonSchema,
		},
		closed,
	),
	Type.Object({ kind: Type.Literal("answer"), gateId: IdSchema, value: JsonSchema }, closed),
	Type.Object(
		{
			kind: Type.Union([Type.Literal("accept-result"), Type.Literal("reject-result")]),
			proposalId: IdSchema,
			reason: ReasonSchema,
		},
		closed,
	),
	Type.Object(
		{ kind: Type.Literal("reconcile"), target: ActivationRefSchema, reason: ReasonSchema },
		closed,
	),
]);
export const RequestSchema = Type.Union([
	Type.Object(
		{
			commandId: IdSchema,
			command: Type.Object({ kind: Type.Literal("create"), definition: DefinitionSchema }, closed),
		},
		closed,
	),
	Type.Object(
		{
			commandId: IdSchema,
			dagId: IdSchema,
			expectedVersion: NumberSchema,
			command: Type.Union([
				Type.Object(
					{
						kind: Type.Literal("edit"),
						edits: Type.Array(EditSchema, {
							minItems: 1,
							maxItems: LIMITS.nodes + LIMITS.connections,
						}),
					},
					closed,
				),
				ControlSchema,
				DecisionSchema,
			]),
		},
		closed,
	),
]);
export const SubmissionSchema = Type.Record(
	IdSchema,
	Type.Union([
		Type.Object(
			{ kind: Type.Literal("text"), text: Type.String({ maxLength: LIMITS.valueBytes }) },
			closed,
		),
		Type.Object({ kind: Type.Literal("json"), value: JsonSchema }, closed),
		Type.Object(
			{ kind: Type.Literal("artifact"), path: Type.String({ minLength: 1, maxLength: 4096 }) },
			closed,
		),
	]),
	{ ...closed, maxProperties: LIMITS.ports },
);
export const PageSchema = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LIMITS.page })),
		cursor: Type.Optional(Type.String({ maxLength: 4096 })),
	},
	closed,
);
export const ReadQuerySchema = Type.Union([
	Type.Object({ kind: Type.Literal("list"), ...PageSchema.properties }, closed),
	Type.Object({ kind: Type.Literal("get"), dagId: IdSchema }, closed),
	Type.Object(
		{ kind: Type.Literal("output"), dagId: IdSchema, proposalId: IdSchema, name: IdSchema },
		closed,
	),
	Type.Object({ kind: Type.Literal("history"), dagId: IdSchema, ...PageSchema.properties }, closed),
]);

export type DagDefinition = Static<typeof DefinitionSchema>;
export type DagNodeSpec = Static<typeof NodeSchema>;
export type DagConnection = Static<typeof ConnectionSchema>;
export type DagSessionOptions = Static<typeof SessionSchema>;
export type GraphEdit = Static<typeof EditSchema>;
export type DagCommandRequest = Static<typeof RequestSchema>;
export type DagControl = Static<typeof ControlSchema>;
export type DagDecision = Static<typeof DecisionSchema>;
export type DagReadQuery = Static<typeof ReadQuerySchema>;
export type GateAuthority = Static<typeof AuthoritySchema>;
export type AttemptRef = Static<typeof AttemptRefSchema>;
export type ActivationRef = Static<typeof ActivationRefSchema>;
export type DagSubmission = Static<typeof SubmissionSchema>;
export type PageRequest = Static<typeof PageSchema>;
