import { assistantToolCallsAreExecutable } from "@thinkrail/contracts";
import { MCP_TOOL_PREFIX, mcpCallTitle, readMcpToolDetails } from "./tools/mcp/mcpResult";
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

function callServer(
	toolName: string,
	args: Record<string, unknown>,
	result: unknown,
): { server: string; tool: string } | null {
	if (toolName.startsWith(MCP_TOOL_PREFIX)) return mcpCallTitle(toolName, result);
	if (!MCP_RESOURCE_TOOLS.has(toolName)) return null;
	const server =
		typeof args.server === "string" ? args.server : (readMcpToolDetails(result)?.server ?? "");
	return { server, tool: toolName };
}

export function mcpServerCalls(
	turns: readonly ChatTurn[],
	toolResults: Readonly<Record<string, ToolResultState>>,
	server: string,
): McpServerCall[] {
	const calls: McpServerCall[] = [];
	for (const turn of turns) {
		if (turn.kind !== "assistant") continue;
		const { message } = turn;
		const dead = !assistantToolCallsAreExecutable(message.stopReason);
		for (const block of message.content) {
			if (block.type !== "toolCall") continue;
			const result = toolResults[block.id];
			const title = callServer(block.name, block.arguments, result?.raw);
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
