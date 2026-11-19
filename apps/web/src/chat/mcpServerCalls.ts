import { assistantToolCallsAreExecutable } from "@thinkrail/contracts";
import { MCP_TOOL_PREFIX, readMcpToolDetails } from "./tools/mcp/mcpResult";
import type { ChatTurn, ToolResultState } from "./types";

const MCP_RESOURCE_TOOLS: ReadonlySet<string> = new Set([
	"list_mcp_resources",
	"list_mcp_resource_templates",
	"read_mcp_resource",
]);

export interface McpServerCall {
	toolCallId: string;
	toolName: string;
	tool: string;
	args: Record<string, unknown>;
	result: ToolResultState | undefined;
	dead: boolean;
	streaming: boolean;
	at: number;
}

const PI_TOOL_NAME_LIMIT = 64;
const PI_HASHED_TAIL = /_[0-9a-f]{8}$/;

function piToolPrefix(server: string): string {
	return `${MCP_TOOL_PREFIX}${server.replace(/[^A-Za-z0-9_]/g, "_")}__`;
}

function ownerByToolName(
	toolName: string,
	servers: readonly string[],
): { server: string; tool: string } | null {
	const hashed = toolName.length === PI_TOOL_NAME_LIMIT && PI_HASHED_TAIL.test(toolName);
	const head = hashed ? toolName.slice(0, -9) : toolName;
	const owners = servers
		.map((server) => ({ server, prefix: piToolPrefix(server) }))
		.filter(({ prefix }) => head.startsWith(prefix) || (hashed && prefix.startsWith(head)));
	const [owner] = owners;
	if (!owner || owners.length > 1) return null;
	return {
		server: owner.server,
		tool: head.startsWith(owner.prefix) ? toolName.slice(owner.prefix.length) : toolName,
	};
}

function callServer(
	toolName: string,
	args: Record<string, unknown>,
	result: unknown,
	servers: readonly string[],
): { server: string; tool: string } | null {
	if (toolName.startsWith(MCP_TOOL_PREFIX)) {
		const details = readMcpToolDetails(result);
		return details?.server
			? { server: details.server, tool: details.tool }
			: ownerByToolName(toolName, servers);
	}
	if (!MCP_RESOURCE_TOOLS.has(toolName)) return null;
	const server =
		typeof args.server === "string" ? args.server : (readMcpToolDetails(result)?.server ?? "");
	return { server, tool: toolName };
}

export function mcpServerCalls(
	turns: readonly ChatTurn[],
	toolResults: Readonly<Record<string, ToolResultState>>,
	server: string,
	servers: readonly string[],
): McpServerCall[] {
	const calls: McpServerCall[] = [];
	for (const turn of turns) {
		if (turn.kind !== "assistant") continue;
		const { message } = turn;
		const dead = !assistantToolCallsAreExecutable(message.stopReason);
		for (const block of message.content) {
			if (block.type !== "toolCall") continue;
			const result = toolResults[block.id];
			const title = callServer(block.name, block.arguments, result?.raw, servers);
			if (!title || title.server !== server) continue;
			calls.push({
				toolCallId: block.id,
				toolName: block.name,
				tool: title.tool,
				args: block.arguments,
				result,
				dead,
				streaming: turn.streaming,
				at: message.timestamp,
			});
		}
	}
	return calls.reverse();
}
