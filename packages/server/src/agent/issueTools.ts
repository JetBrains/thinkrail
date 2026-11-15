import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { CodedError } from "@thinkrail/shared/codedError";
import { type Static, Type } from "typebox";

export const ISSUE_CONTEXT_TOOL_NAME = "issue_context";
export const ISSUE_RECORD_SUMMARY_TOOL_NAME = "issue_record_summary";
export const ISSUE_JOIN_REPOSITORY_TOOL_NAME = "issue_join_repository";

export type IssueSummaryRecovery = "reconcile" | "retry-confirmed-unpublished";

const EmptyParamsSchema = Type.Object({}, { additionalProperties: false });
const RecordSummarySchema = Type.Object(
	{
		operationId: Type.String({
			minLength: 1,
			maxLength: 128,
			pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
		}),
		recovery: Type.Optional(
			Type.Union([Type.Literal("reconcile"), Type.Literal("retry-confirmed-unpublished")]),
		),
		summary: Type.String({
			minLength: 1,
			maxLength: 32_000,
			pattern: "\\S",
			description: "Nonblank summary, at most 32,000 UTF-8 bytes.",
		}),
	},
	{ additionalProperties: false },
);

const JoinRepositorySchema = Type.Object(
	{
		projectId: Type.String({
			minLength: 1,
			maxLength: 256,
			pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$",
			description: 'The projectId of a repository issue_context lists with role "reference".',
		}),
	},
	{ additionalProperties: false },
);

type EmptyParams = Static<typeof EmptyParamsSchema>;
type JoinRepositoryParams = Static<typeof JoinRepositorySchema>;
/** A repository the bound Issue may join, or the worktree it joined as. */
export type IssueJoinedRepository = {
	projectId: string;
	name: string;
	path: string;
	workspaceId?: string;
};
type RecordSummaryParams = Static<typeof RecordSummarySchema>;
type SummaryResult = { noteId: number; url?: string };

export interface IssueToolHost {
	context(sessionId: string): Promise<string>;
	prepareConfirmation?(
		sessionId: string,
		input: {
			operationId: string;
			inspect?: boolean;
			continueDespiteChecks?: boolean;
			recovery?: "reconcile";
			report?: string;
			projectId?: string;
			title?: string;
			body?: string;
			targetBranch?: string;
			action?:
				| "update-body"
				| "close-issue"
				| "ready-mr"
				| "merge-mr"
				| "record-delivery-state"
				| "read-delivery-state"
				| "authorize-automation"
				| "advance-automation"
				| "preflight-dependencies";
			reason?: string;
			acceptance?: string;
			mergeRequestId?: number;
			expectedSha?: string;
			expectedRevision?: number;
			deliveryState?: unknown;
			mode?: "draft" | "auto-merge" | "manual";
			closeIssue?: boolean;
		},
	): Promise<unknown>;
	executeConfirmation?(
		sessionId: string,
		operationId: string,
		toolCallId: string,
		continuationId?: string,
	): Promise<unknown>;
	recordSummary(
		sessionId: string,
		operationId: string,
		summary: string,
		recovery?: IssueSummaryRecovery,
	): Promise<SummaryResult>;
	/** A `reference` repository of this implementation session's Issue; refuses anything else. */
	joinCandidate?(sessionId: string, projectId: string): Promise<IssueJoinedRepository>;
	/** Join it (after the user confirmed) and return its new Issue worktree. */
	joinRepository?(sessionId: string, projectId: string): Promise<IssueJoinedRepository>;
}

const UNAVAILABLE_MESSAGE = "Issue tools are unavailable for this session.";
const INVALID_MESSAGE = "Invalid Issue tool parameters.";
const unavailable = () => new CodedError("RESOURCE_UNAVAILABLE", UNAVAILABLE_MESSAGE);
const invalid = () => new CodedError("RANGE_INVALID", INVALID_MESSAGE);
const defaultHost: IssueToolHost = {
	context: async () => {
		throw unavailable();
	},
	recordSummary: async () => {
		throw unavailable();
	},
};
let host: IssueToolHost = defaultHost;

export function setIssueToolHost(next: IssueToolHost | null): void {
	host = next ?? defaultHost;
}

function validEmptyParams(value: unknown): value is EmptyParams {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Reflect.ownKeys(value).length === 0
	);
}

function validRecordSummaryParams(value: unknown): value is RecordSummaryParams {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const params = value as Record<string, unknown>;
	if (
		Reflect.ownKeys(params).some(
			(key) =>
				!["operationId", "summary", "recovery"].includes(String(key)) || typeof key !== "string",
		) ||
		(Object.hasOwn(params, "recovery") &&
			params.recovery !== "reconcile" &&
			params.recovery !== "retry-confirmed-unpublished") ||
		!Object.hasOwn(params, "operationId") ||
		!Object.hasOwn(params, "summary") ||
		typeof params.operationId !== "string" ||
		typeof params.summary !== "string"
	)
		return false;
	return (
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(params.operationId) &&
		params.summary.trim().length > 0 &&
		new TextEncoder().encode(params.summary).byteLength <= 32_000
	);
}

export function createIssueContextTool(): ToolDefinition<typeof EmptyParamsSchema, undefined> {
	return {
		name: ISSUE_CONTEXT_TOOL_NAME,
		label: "Issue Context",
		description: "Read the issue context associated with this session, if one is available.",
		parameters: EmptyParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!validEmptyParams(params)) throw invalid();
			try {
				const text = await host.context(ctx.sessionManager.getSessionId());
				return { content: [{ type: "text", text }], details: undefined };
			} catch {
				throw unavailable();
			}
		},
	};
}

export function createIssueRecordSummaryTool(): ToolDefinition<
	typeof RecordSummarySchema,
	SummaryResult
> {
	return {
		name: ISSUE_RECORD_SUMMARY_TOOL_NAME,
		label: "Record Issue Summary",
		description:
			"Before handing off Issue work, publish a concise summary of decisions, results, validation and next steps. Generate a unique operationId for each summary; reuse it only to retry the identical summary. Confirm the returned noteId before yielding. On recovery-required, obtain explicit HUMAN confirmation before either recovery mode, then reuse the ORIGINAL operationId and EXACT summary. Selecting recovery represents that confirmation; an agent must not infer it. reconcile only recovers a unique exact-body receipt without sending; it does not prove original authorship, so the human must confirm adopting that receipt. retry-confirmed-unpublished requires human confirmation that the original request/process ended and remote publication did not happen, plus authorization to retry. Absence, errors and timeouts are NOT proof. Legacy intents can retry once with that confirmation and fresh zero exact matches; already-retried attempts cannot resend. Never change operationId to bypass uncertainty.",
		parameters: RecordSummarySchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!validRecordSummaryParams(params)) throw invalid();
			try {
				const result = await host.recordSummary(
					ctx.sessionManager.getSessionId(),
					params.operationId,
					params.summary,
					...(params.recovery ? [params.recovery] : []),
				);
				return {
					content: [{ type: "text", text: JSON.stringify(result) }],
					details: result,
				};
			} catch (error) {
				if (error instanceof CodedError && error.code === "ISSUE_SUMMARY_RECOVERY_REQUIRED") {
					throw new CodedError(
						"ISSUE_SUMMARY_RECOVERY_REQUIRED",
						"Issue summary requires reconciliation. Obtain explicit human confirmation before either recovery mode; reuse the original operationId and exact summary. Retry requires human confirmation that the original request/process ended without remote publication and authorization to retry. Absence, errors and timeouts are not proof.",
					);
				}
				throw unavailable();
			}
		},
	};
}

function validJoinParams(value: unknown): value is JoinRepositoryParams {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const keys = Reflect.ownKeys(value);
	const projectId = (value as Record<string, unknown>).projectId;
	return (
		keys.length === 1 &&
		keys[0] === "projectId" &&
		typeof projectId === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(projectId)
	);
}

type JoinResult = { joined: boolean; repository?: IssueJoinedRepository };

/** Ask the user to join one `reference` repository to the running Issue implementation. */
export function createIssueJoinRepositoryTool(): ToolDefinition<
	typeof JoinRepositorySchema,
	JoinResult
> {
	return {
		name: ISSUE_JOIN_REPOSITORY_TOOL_NAME,
		label: "Join Issue Repository",
		description:
			'During Issue implementation, request that a repository listed with role "reference" (read-only) join this Issue so it can be changed. The user must confirm; on success the host creates its Issue worktree and returns its path, which is the only place to edit that repository. A declined request means: do not change that repository.',
		parameters: JoinRepositorySchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!validJoinParams(params)) throw invalid();
			const sessionId = ctx.sessionManager.getSessionId();
			let candidate: IssueJoinedRepository;
			try {
				if (!host.joinCandidate) throw unavailable();
				candidate = await host.joinCandidate(sessionId, params.projectId);
			} catch {
				throw unavailable();
			}
			if (!ctx.hasUI)
				throw new CodedError(
					"RESOURCE_UNAVAILABLE",
					"Joining a repository needs the user's confirmation, which this session cannot ask for.",
				);
			const confirmed = await ctx.ui.confirm(
				`Join ${candidate.name} to this Issue?`,
				`The agent asks to change ${candidate.name} (${candidate.path}). ThinkRail will create an Issue worktree for it, branched from its freshly fetched default branch, next to the Issue's other worktrees.`,
			);
			if (!confirmed) {
				const text = `The user declined joining ${candidate.name}. Do not change that repository; continue without it or ask the user.`;
				return { content: [{ type: "text", text }], details: { joined: false } };
			}
			let joined: IssueJoinedRepository;
			try {
				if (!host.joinRepository) throw unavailable();
				joined = await host.joinRepository(sessionId, params.projectId);
			} catch (error) {
				if (error instanceof CodedError && error.code === "ISSUE_REPOSITORY_REFUSED") throw error;
				throw unavailable();
			}
			return {
				content: [{ type: "text", text: JSON.stringify({ joined: true, repository: joined }) }],
				details: { joined: true, repository: joined },
			};
		},
	};
}

const PrepareConfirmationSchema = Type.Object(
	{
		operationId: Type.String({
			minLength: 1,
			maxLength: 128,
			pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
		}),
		action: Type.Optional(
			Type.Union([
				Type.Literal("update-body"),
				Type.Literal("close-issue"),
				Type.Literal("ready-mr"),
				Type.Literal("merge-mr"),
				Type.Literal("record-delivery-state"),
				Type.Literal("read-delivery-state"),
				Type.Literal("authorize-automation"),
				Type.Literal("advance-automation"),
				Type.Literal("preflight-dependencies"),
			]),
		),
		mode: Type.Optional(
			Type.Union([Type.Literal("draft"), Type.Literal("auto-merge"), Type.Literal("manual")]),
		),
		closeIssue: Type.Optional(Type.Boolean()),
		mergeRequestId: Type.Optional(Type.Integer({ minimum: 1 })),
		expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
		deliveryState: Type.Optional(Type.Unknown()),
		expectedSha: Type.Optional(Type.String({ pattern: "^[a-fA-F0-9]{40}$" })),
		reason: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
		acceptance: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
		inspect: Type.Optional(Type.Boolean()),
		continueDespiteChecks: Type.Optional(Type.Boolean()),
		recovery: Type.Optional(Type.Literal("reconcile")),
		report: Type.Optional(Type.String({ minLength: 1, maxLength: 32000 })),
		projectId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		title: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
		body: Type.Optional(Type.String({ maxLength: 32000 })),
		targetBranch: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
	},
	{ additionalProperties: false },
);
const ExecuteConfirmationSchema = Type.Object(
	{
		operationId: Type.String({ minLength: 1, maxLength: 128 }),
		toolCallId: Type.String({ minLength: 1, maxLength: 512 }),
		continuationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	},
	{ additionalProperties: false },
);
export function createIssuePrepareConfirmationTool(): ToolDefinition<
	typeof PrepareConfirmationSchema,
	unknown
> {
	return {
		name: "issue_prepare_confirmation",
		label: "Prepare Issue Confirmation",
		parameters: PrepareConfirmationSchema,
		description:
			"Record/read structured per-repository delivery state; authorize and advance per-repository lifecycle policies using action:'authorize-automation' and action:'advance-automation' with the same operationId/projectId. Before changing a downstream pairing, call action:'preflight-dependencies' with its projectId; this reads exact upstream merged requests and target SHAs. It blocks when host-verified API/ABI/protocol compatibility evidence is unavailable—do not substitute independent CI. Policy advancement also requires host-observed validation evidence bound to the exact SHA/tree/target; agent-reported validation never qualifies. Other actions independently confirm MR ready/merge, Issue close, body replacement, stage report and Draft delivery. Pass returned confirmation questions unchanged to ask_user_question. inspect:true and dependency preflight are read-only. Never bypass host operations through shell.",
		async execute(_id, params, _signal, _update, ctx) {
			if (!host.prepareConfirmation) throw unavailable();
			const result = await host.prepareConfirmation(ctx.sessionManager.getSessionId(), params);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	};
}
export function createIssueExecuteConfirmationTool(): ToolDefinition<
	typeof ExecuteConfirmationSchema,
	unknown
> {
	return {
		name: "issue_execute_confirmation",
		label: "Execute Issue Confirmation",
		parameters: ExecuteConfirmationSchema,
		description:
			"Execute a prepared Issue operation only after the exact returned question was submitted with Looks right. Supply that ask_user_question toolCallId. Host validates the real answer, fixed version and one-time durable intent. Results may be partial/uncertain: stop and reconcile, never retry under a new operationId or bypass through shell. When a refusal returns continuation questions, show them unchanged and pass continuationId with that card's real toolCallId to attempt the fixed request once. Stage confirmation does not authorize push or PR/MR creation; those require their own per-repository card.",
		async execute(_id, params, _signal, _update, ctx) {
			if (!host.executeConfirmation) throw unavailable();
			const result = await host.executeConfirmation(
				ctx.sessionManager.getSessionId(),
				params.operationId,
				params.toolCallId,
				params.continuationId,
			);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	};
}
export function issueToolsExtension(pi: ExtensionAPI): void {
	pi.registerTool(createIssueContextTool());
	pi.registerTool(createIssueRecordSummaryTool());
	pi.registerTool(createIssueJoinRepositoryTool());
	pi.registerTool(createIssuePrepareConfirmationTool());
	pi.registerTool(createIssueExecuteConfirmationTool());
}
