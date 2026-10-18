import {
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionFactory,
	getAgentDir,
	type InlineExtension,
	type McpServerConfig,
	type RegisteredMcpServer,
	type SessionShutdownEvent,
	type ToolCallEvent,
	type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { grantedMcpTools, loadHostMcpConfig, type McpProjectPolicy, mcpTargetOf } from "./config";
import { createMcpEngine } from "./engine";
import { isMcpResultTool, summarizeMcpResult } from "./results";

const MCP_TOOL_PREFIX = "mcp__";

export const MCP_CONFIRM_DENY = "Deny";
export const MCP_CONFIRM_ONCE = "Allow once";
export const MCP_CONFIRM_CHAT = "Allow in this chat";
export const MCP_CONFIRM_ALWAYS = "Always allow";
// Mobile stacks the options vertically: a lasting grant must never sit next to "Deny".
const CONFIRM_OPTIONS = [MCP_CONFIRM_DENY, MCP_CONFIRM_ONCE, MCP_CONFIRM_CHAT];
const CONFIRM_OPTIONS_WITH_ALWAYS = [...CONFIRM_OPTIONS, MCP_CONFIRM_ALWAYS];

export interface McpSessionHost {
	extensions: InlineExtension[];
	disabledInChat: Set<string>;
	loaded(): ReadonlyMap<string, McpServerConfig> | null;
	registered(): RegisteredMcpServer[];
	shutdownEngine(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void>;
}

export type AskForToolCall = (
	toolCallId: string,
	input: Record<string, unknown>,
	title: string,
	options: string[],
	signal: AbortSignal | undefined,
) => Promise<string | undefined>;

export type GrantMcpTool = (server: string, target: string, tool: string) => void;

export interface McpSessionHostOptions {
	policy: () => McpProjectPolicy;
	onCommandSettled?: (sessionId: string) => void;
	askForToolCall: AskForToolCall;
	grantTool: GrantMcpTool;
}

const ALWAYS_ALLOW_SCOPE =
	"Always allow trusts this tool in every chat of this project. Manage it in Settings › MCP servers.";

function describeCall(event: ToolCallEvent, offersAlways: boolean): string {
	const [server, ...tool] = event.toolName.slice(MCP_TOOL_PREFIX.length).split("__");
	const question = `Allow ${server}/${tool.join("__")}? It may change data.`;
	return offersAlways ? `${question}\n${ALWAYS_ALLOW_SCOPE}` : question;
}

function blocked(reason: string): ToolCallEventResult {
	return { block: true, reason };
}

export function createMcpSessionHost({
	policy,
	onCommandSettled,
	askForToolCall,
	grantTool,
}: McpSessionHostOptions): McpSessionHost {
	const allowedInChat = new Set<string>();
	const disabledInChat = new Set<string>();
	let loaded: Map<string, McpServerConfig> | null = null;
	let current: ExtensionAPI | null = null;

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
		const server = tool?.namespace?.aliases?.[0];
		const config = server === undefined ? undefined : loaded?.get(server);
		if (
			server !== undefined &&
			config !== undefined &&
			grantedMcpTools(policy(), server, config).includes(event.toolName)
		) {
			return undefined;
		}
		if (!ctx.hasUI) {
			return blocked("This MCP call needs the user's confirmation, and no UI is attached.");
		}
		const answer = await askForToolCall(
			event.toolCallId,
			event.input,
			describeCall(event, config !== undefined),
			config ? CONFIRM_OPTIONS_WITH_ALWAYS : CONFIRM_OPTIONS,
			ctx.signal,
		);
		if (answer === MCP_CONFIRM_ALWAYS && server !== undefined && config !== undefined) {
			grantTool(server, mcpTargetOf(config), event.toolName);
			return undefined;
		}
		if (answer === MCP_CONFIRM_ONCE) return undefined;
		if (answer === MCP_CONFIRM_CHAT) {
			allowedInChat.add(event.toolName);
			return undefined;
		}
		if (answer === MCP_CONFIRM_DENY) return blocked("The user denied this MCP call.");
		return blocked(
			ctx.signal?.aborted
				? "The MCP call was cancelled before the user confirmed it."
				: "The user did not confirm this MCP call: they dismissed it or replied in the chat instead.",
		);
	};

	const hostExtension: ExtensionFactory = (pi) => {
		current = pi;
		loaded = null;
		pi.on("tool_call", (event, ctx) => confirm(pi, event, ctx));
		pi.on("tool_result", (event) => {
			if (!isMcpResultTool(event.toolName)) return undefined;
			const summary = summarizeMcpResult(event.toolName, event.structuredContent, event.isError);
			if (!summary) return undefined;
			const details = event.details && typeof event.details === "object" ? event.details : {};
			return { details: { ...details, thinkrail: summary } };
		});
	};
	const loadConfig = (ctx: ExtensionContext) => {
		const config = loadHostMcpConfig({
			agentDir: getAgentDir(),
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
			policy: policy(),
			disabledInChat,
		});
		loaded = new Map(config.servers.map((server) => [server.name, server.config]));
		return config;
	};
	const engine = createMcpEngine({
		loadConfig,
		...(onCommandSettled ? { onCommandSettled } : {}),
	});

	return {
		extensions: [hostExtension, ...engine.extensions],
		disabledInChat,
		loaded: () => loaded,
		registered: () => {
			try {
				return current?.getMcpServers() ?? [];
			} catch {
				return [];
			}
		},
		shutdownEngine: (event, ctx) => engine.shutdown(event, ctx),
	};
}
