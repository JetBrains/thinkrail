import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { CodedError } from "@thinkrail/shared/codedError";
import { type Static, Type } from "typebox";

export const ISSUE_CONTEXT_TOOL_NAME = "issue_context";
export const ISSUE_RECORD_SUMMARY_TOOL_NAME = "issue_record_summary";

const EmptyParamsSchema = Type.Object({}, { additionalProperties: false });
const RecordSummarySchema = Type.Object(
	{
		operationId: Type.String({
			minLength: 1,
			maxLength: 128,
			pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
		}),
		summary: Type.String({
			minLength: 1,
			maxLength: 32_000,
			pattern: "\\S",
			description: "Nonblank summary, at most 32,000 UTF-8 bytes.",
		}),
	},
	{ additionalProperties: false },
);

type EmptyParams = Static<typeof EmptyParamsSchema>;
type RecordSummaryParams = Static<typeof RecordSummarySchema>;
type SummaryResult = { noteId: number; url?: string };

export interface IssueToolHost {
	context(sessionId: string): Promise<string>;
	recordSummary(sessionId: string, operationId: string, summary: string): Promise<SummaryResult>;
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
		Reflect.ownKeys(params).length !== 2 ||
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
			"Before handing off Issue work, publish a concise summary of decisions, results, validation and next steps. Generate a unique operationId for each summary; reuse it only to retry the identical summary. Confirm the returned noteId before yielding.",
		parameters: RecordSummarySchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!validRecordSummaryParams(params)) throw invalid();
			try {
				const result = await host.recordSummary(
					ctx.sessionManager.getSessionId(),
					params.operationId,
					params.summary,
				);
				return {
					content: [{ type: "text", text: JSON.stringify(result) }],
					details: result,
				};
			} catch {
				throw unavailable();
			}
		},
	};
}

export function issueToolsExtension(pi: ExtensionAPI): void {
	pi.registerTool(createIssueContextTool());
	pi.registerTool(createIssueRecordSummaryTool());
}
