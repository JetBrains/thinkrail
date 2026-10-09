import type {
	McpContentBlockSummary,
	McpResultSummary,
	McpToolDetails,
} from "@thinkrail/contracts";
import { resultText } from "@thinkrail/extension-api/web";

export const MCP_TOOL_PREFIX = "mcp__";

type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const stringOf = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

function detailsOf(result: unknown): JsonRecord | null {
	return isRecord(result) && isRecord(result.details) ? result.details : null;
}

export interface McpCallTitle {
	server: string;
	tool: string;
}

export function parseMcpToolName(toolName: string): McpCallTitle | null {
	if (!toolName.startsWith(MCP_TOOL_PREFIX)) return null;
	const rest = toolName.slice(MCP_TOOL_PREFIX.length);
	const split = rest.indexOf("__");
	return split < 0
		? { server: rest, tool: "" }
		: { server: rest.slice(0, split), tool: rest.slice(split + 2) };
}

export function readMcpToolDetails(result: unknown): McpToolDetails | null {
	const details = detailsOf(result);
	if (typeof details?.server !== "string" || typeof details.tool !== "string") return null;
	const fullOutputPath = stringOf(details.fullOutputPath);
	return {
		server: details.server,
		tool: details.tool,
		...(fullOutputPath ? { fullOutputPath } : {}),
	};
}

export function mcpCallTitle(toolName: string, result: unknown): McpCallTitle {
	const details = readMcpToolDetails(result);
	if (details?.server && details.tool) return { server: details.server, tool: details.tool };
	return parseMcpToolName(toolName) ?? { server: "", tool: toolName };
}

export function mcpFullOutputPath(result: unknown): string | null {
	return stringOf(detailsOf(result)?.fullOutputPath) || null;
}

const optionalString = (value: unknown): boolean =>
	value === undefined || typeof value === "string";

function isBlockSummary(value: unknown): value is McpContentBlockSummary {
	if (!isRecord(value)) return false;
	switch (value.kind) {
		case "text":
			return typeof value.chars === "number";
		case "image":
		case "audio":
			return typeof value.mimeType === "string";
		case "resource_link":
			return (
				typeof value.uri === "string" &&
				optionalString(value.name) &&
				optionalString(value.mimeType)
			);
		case "resource":
			return (
				typeof value.uri === "string" &&
				optionalString(value.mimeType) &&
				(value.chars === undefined || typeof value.chars === "number")
			);
		default:
			return false;
	}
}

export function readMcpResultSummary(result: unknown): McpResultSummary | null {
	const summary = detailsOf(result)?.thinkrail;
	if (!isRecord(summary) || !Array.isArray(summary.blocks)) return null;
	return {
		blocks: summary.blocks.filter(isBlockSummary),
		...(summary.structuredContent !== undefined
			? { structuredContent: summary.structuredContent }
			: {}),
		...(summary.structuredContentTruncated === true ? { structuredContentTruncated: true } : {}),
		...(summary.isError === true ? { isError: true } : {}),
	};
}

export function mcpText(result: unknown): string {
	const content = isRecord(result) ? result.content : undefined;
	if (!Array.isArray(content)) return resultText(result);
	return content
		.flatMap((block) =>
			isRecord(block) && block.type === "text" && typeof block.text === "string"
				? [block.text]
				: [],
		)
		.join("\n");
}

export interface McpArgEntry {
	key: string;
	value: string;
}

export function mcpArgEntries(args: Record<string, unknown>): McpArgEntry[] {
	return Object.entries(args).map(([key, value]) => ({
		key,
		value: typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value)),
	}));
}

const ARGS_SUMMARY_CHARS = 100;

export function mcpArgsSummary(args: Record<string, unknown>): string {
	const pairs = Object.entries(args)
		.map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`)
		.join(" ");
	return pairs.length > ARGS_SUMMARY_CHARS ? `${pairs.slice(0, ARGS_SUMMARY_CHARS - 1)}…` : pairs;
}

export type McpCliAction = "sign-in" | "settings";

const SIGN_IN_PHRASE = /\b(?:requires|needs) sign-in\b|\bmcp login\b/i;
const MCP_COMMAND_PHRASE = /\brun \/mcp\b/i;

export function mcpCliAction(text: string): McpCliAction | null {
	if (SIGN_IN_PHRASE.test(text)) return "sign-in";
	if (MCP_COMMAND_PHRASE.test(text)) return "settings";
	return null;
}

export interface McpListedItem {
	server: string;
	uri: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
}

export interface McpListingError {
	server: string;
	error: string;
}

export interface McpListing {
	items: McpListedItem[];
	nextCursor?: string;
	errors: McpListingError[];
}

const LISTING_FIELDS: Readonly<Record<string, { items: string; uri: string }>> = {
	list_mcp_resources: { items: "resources", uri: "uri" },
	list_mcp_resource_templates: { items: "resourceTemplates", uri: "uriTemplate" },
};

function listedItem(value: unknown, uriField: string, fallbackServer: string): McpListedItem[] {
	if (!isRecord(value)) return [];
	const uri = stringOf(value[uriField]);
	if (!uri) return [];
	const title = stringOf(value.title);
	const description = stringOf(value.description);
	const mimeType = stringOf(value.mimeType);
	return [
		{
			server: stringOf(value.server) ?? fallbackServer,
			uri,
			name: stringOf(value.name) || uri,
			...(title ? { title } : {}),
			...(description ? { description } : {}),
			...(mimeType ? { mimeType } : {}),
		},
	];
}

function listingError(value: unknown): McpListingError[] {
	if (!isRecord(value)) return [];
	const error = stringOf(value.error);
	return error ? [{ server: stringOf(value.server) ?? "", error }] : [];
}

export function parseMcpListing(toolName: string, payload: unknown): McpListing | null {
	const fields = LISTING_FIELDS[toolName];
	if (!fields || !isRecord(payload)) return null;
	const items = payload[fields.items];
	if (!Array.isArray(items)) return null;
	const server = stringOf(payload.server) ?? "";
	const nextCursor = stringOf(payload.nextCursor);
	return {
		items: items.flatMap((item) => listedItem(item, fields.uri, server)),
		...(nextCursor ? { nextCursor } : {}),
		errors: Array.isArray(payload.errors) ? payload.errors.flatMap(listingError) : [],
	};
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export function readMcpListing(toolName: string, result: unknown): McpListing | null {
	return (
		parseMcpListing(toolName, readMcpResultSummary(result)?.structuredContent) ??
		parseMcpListing(toolName, parseJson(mcpText(result).trim()))
	);
}

export function readToolSearchLoaded(result: unknown): string[] | null {
	const loaded = detailsOf(result)?.loaded;
	return Array.isArray(loaded)
		? loaded.filter((name): name is string => typeof name === "string")
		: null;
}

const LOADED_TOOL_LINE = /^- ([^\s:]+): ?(.*)$/;

export function toolSearchDescriptions(text: string): Map<string, string> {
	const descriptions = new Map<string, string>();
	for (const line of text.split("\n")) {
		const match = LOADED_TOOL_LINE.exec(line);
		if (match?.[1]) descriptions.set(match[1], match[2] ?? "");
	}
	return descriptions;
}
