import {
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionFactory,
	getAgentDir,
	type InlineExtension,
	type SessionShutdownEvent,
	type ToolCallEvent,
	type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { loadHostMcpConfig, type McpProjectPolicy } from "./config";
import { createMcpEngine } from "./engine";
import { isMcpResultTool, summarizeMcpResult } from "./results";

const MCP_TOOL_PREFIX = "mcp__";
const ARGS_PREVIEW_CHARS = 160;

export const MCP_CONFIRM_DENY = "Deny";
export const MCP_CONFIRM_ONCE = "Allow once";
export const MCP_CONFIRM_CHAT = "Allow in this chat";
// Mobile stacks the options vertically: "Allow in this chat" must never sit next to "Deny".
const CONFIRM_OPTIONS = [MCP_CONFIRM_DENY, MCP_CONFIRM_ONCE, MCP_CONFIRM_CHAT];

export interface McpSessionHost {
	extensions: InlineExtension[];
	shutdownEngine(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void>;
	cancelPendingConfirmations(): void;
}

function describeCall(event: ToolCallEvent): string {
	const [server, ...tool] = event.toolName.slice(MCP_TOOL_PREFIX.length).split("__");
	const args = JSON.stringify(event.input ?? {});
	const preview =
		args.length > ARGS_PREVIEW_CHARS ? `${args.slice(0, ARGS_PREVIEW_CHARS - 1)}…` : args;
	return `Allow the MCP call ${server}/${tool.join("__")}? It may change data. ${preview}`;
}

function blocked(reason: string): ToolCallEventResult {
	return { block: true, reason };
}

export function createMcpSessionHost(policy: () => McpProjectPolicy): McpSessionHost {
	const allowedInChat = new Set<string>();
	const pending = new Set<AbortController>();

	const confirm = async (
		pi: ExtensionAPI,
		event: ToolCallEvent,
		ctx: ExtensionContext,
	): Promise<ToolCallEventResult | undefined> => {
		if (!event.toolName.startsWith(MCP_TOOL_PREFIX)) return undefined;
		const tool = pi.getAllTools().find((candidate) => candidate.name === event.toolName);
		if (tool?.annotations?.readOnlyHint === true || allowedInChat.has(event.toolName)) {
			return undefined;
		}
		if (!ctx.hasUI) {
			return blocked("This MCP call needs the user's confirmation, and no UI is attached.");
		}
		const cancel = new AbortController();
		const signal = ctx.signal ? AbortSignal.any([ctx.signal, cancel.signal]) : cancel.signal;
		pending.add(cancel);
		try {
			const answer = await ctx.ui.select(describeCall(event), CONFIRM_OPTIONS, { signal });
			if (signal.aborted) {
				return blocked("The MCP call was cancelled before the user confirmed it.");
			}
			if (answer === MCP_CONFIRM_ONCE) return undefined;
			if (answer === MCP_CONFIRM_CHAT) {
				allowedInChat.add(event.toolName);
				return undefined;
			}
			return blocked(
				answer === MCP_CONFIRM_DENY
					? "The user denied this MCP call."
					: "The user dismissed the confirmation for this MCP call.",
			);
		} finally {
			pending.delete(cancel);
		}
	};

	const hostExtension: ExtensionFactory = (pi) => {
		pi.on("tool_call", (event, ctx) => confirm(pi, event, ctx));
		pi.on("tool_result", (event) => {
			if (!isMcpResultTool(event.toolName)) return undefined;
			const summary = summarizeMcpResult(event.toolName, event.structuredContent, event.isError);
			if (!summary) return undefined;
			const details = event.details && typeof event.details === "object" ? event.details : {};
			return { details: { ...details, thinkrail: summary } };
		});
	};
	const loadConfig = (ctx: ExtensionContext) =>
		loadHostMcpConfig({
			agentDir: getAgentDir(),
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
			policy: policy(),
		});
	const engine = createMcpEngine({ loadConfig });

	return {
		extensions: [hostExtension, ...engine.extensions],
		shutdownEngine: (event, ctx) => engine.shutdown(event, ctx),
		cancelPendingConfirmations: () => {
			for (const cancel of pending) cancel.abort();
		},
	};
}
