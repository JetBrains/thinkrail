import type { McpContentBlockSummary, McpResultSummary } from "@thinkrail/contracts";
import { isRecord } from "./config";

export const MCP_SUMMARY_BYTES = 64 * 1024;
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

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? "");

function boundedBlocks(
	all: McpContentBlockSummary[],
	budget: number,
): { kept: Pick<McpResultSummary, "blocks" | "omittedBlocks">; remaining: number } {
	const blocks: McpContentBlockSummary[] = [];
	let used = bytes([]);
	for (const block of all) {
		const size = bytes(block) + 1;
		if (used + size > budget) break;
		blocks.push(block);
		used += size;
	}
	const omitted = all.length - blocks.length;
	return {
		kept: { blocks, ...(omitted > 0 ? { omittedBlocks: omitted } : {}) },
		remaining: budget - used,
	};
}

function boundedStructured(
	value: unknown,
	budget: number,
): Pick<McpResultSummary, "structuredContent" | "structuredContentTruncated"> {
	if (value === undefined) return {};
	const json = JSON.stringify(value);
	if (json === undefined) return {};
	return Buffer.byteLength(json) <= budget
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
		const { kept } = boundedBlocks(
			contents.flatMap((entry) => resourceSummary(entry) ?? []),
			MCP_SUMMARY_BYTES,
		);
		return { ...kept, ...flag };
	}
	if (RESOURCE_TOOLS.has(toolName))
		return { blocks: [], ...boundedStructured(structured, MCP_SUMMARY_BYTES), ...flag };
	const content = Array.isArray(structured.content) ? structured.content : [];
	const { kept, remaining } = boundedBlocks(
		content.flatMap((block) => blockSummary(block) ?? []),
		MCP_SUMMARY_BYTES,
	);
	return { ...kept, ...boundedStructured(structured.structuredContent, remaining), ...flag };
}
