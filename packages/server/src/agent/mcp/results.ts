import type { McpContentBlockSummary, McpResultSummary } from "@thinkrail/contracts";
import { isRecord } from "./config";

export const MCP_STRUCTURED_SUMMARY_BYTES = 64 * 1024;
const RESOURCE_TOOLS = new Set([
	"list_mcp_resources",
	"list_mcp_resource_templates",
	"read_mcp_resource",
]);

export function isMcpResultTool(toolName: string): boolean {
	return toolName.startsWith("mcp__") || RESOURCE_TOOLS.has(toolName);
}

const text = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

function blockSummary(block: unknown): McpContentBlockSummary | null {
	if (!isRecord(block)) return null;
	switch (block.type) {
		case "text":
			return { kind: "text", chars: text(block.text)?.length ?? 0 };
		case "image":
			return { kind: "image", mimeType: text(block.mimeType) ?? "image/*" };
		case "audio":
			return { kind: "audio", mimeType: text(block.mimeType) ?? "audio/*" };
		case "resource_link": {
			const name = text(block.name);
			const mimeType = text(block.mimeType);
			return {
				kind: "resource_link",
				uri: text(block.uri) ?? "",
				...(name ? { name } : {}),
				...(mimeType ? { mimeType } : {}),
			};
		}
		case "resource":
			return resourceSummary(block.resource);
		default:
			return null;
	}
}

function resourceSummary(resource: unknown): McpContentBlockSummary | null {
	if (!isRecord(resource)) return null;
	const mimeType = text(resource.mimeType);
	const body = text(resource.text);
	return {
		kind: "resource",
		uri: text(resource.uri) ?? "",
		...(mimeType ? { mimeType } : {}),
		...(body !== undefined ? { chars: body.length } : {}),
	};
}

function bounded(
	value: unknown,
): Pick<McpResultSummary, "structuredContent" | "structuredContentTruncated"> {
	if (value === undefined) return {};
	const json = JSON.stringify(value);
	if (json === undefined) return {};
	return Buffer.byteLength(json) <= MCP_STRUCTURED_SUMMARY_BYTES
		? { structuredContent: value }
		: { structuredContentTruncated: true };
}

export function summarizeMcpResult(
	toolName: string,
	structured: unknown,
	isError: boolean,
): McpResultSummary | null {
	if (!isRecord(structured)) return null;
	const flag = isError ? { isError: true } : {};
	if (toolName === "read_mcp_resource") {
		const contents = Array.isArray(structured.contents) ? structured.contents : [];
		return {
			blocks: contents.flatMap((entry) => resourceSummary(entry) ?? []),
			...flag,
		};
	}
	if (RESOURCE_TOOLS.has(toolName)) return { blocks: [], ...bounded(structured), ...flag };
	const blocks = Array.isArray(structured.content) ? structured.content : [];
	return {
		blocks: blocks.flatMap((block) => blockSummary(block) ?? []),
		...bounded(structured.structuredContent),
		...flag,
	};
}
