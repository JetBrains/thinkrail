import type { McpServerState, McpServerStatus, McpServerSummary } from "@thinkrail/contracts";
import { redactMcpText } from "./redact";

export const MCP_ATTENTION_PREFIX = "MCP servers need attention:";
const NO_SERVERS_PREFIX = "No MCP servers configured.";
const EXPOSURE_SUFFIX = / \((codemode|deferred|direct|hidden)\)$/;
const SERVER_LINE = /^([A-Za-z0-9_-]+): (.*)$/;

export interface ParsedMcpServerStatus {
	state: McpServerState;
	toolCount?: number;
	detail: string;
}

export interface ParsedMcpStatus {
	servers: Map<string, ParsedMcpServerStatus>;
	configErrors: string[];
}

function stateOf(text: string): Omit<ParsedMcpServerStatus, "detail"> {
	if (text.startsWith("needs sign-in")) return { state: "needs-sign-in" };
	if (text === "disabled") return { state: "disabled" };
	if (text.startsWith("disconnected")) return { state: "disconnected" };
	if (text.startsWith("failed")) return { state: "failed" };
	if (text === "starting" || text.startsWith("connecting")) return { state: "starting" };
	const connected =
		/^connected(?:, (\d+) tools)?/.exec(text) ?? /^connected · (\d+) tools?/.exec(text);
	if (connected) return { state: "connected", toolCount: Number(connected[1] ?? 0) };
	return { state: "unknown" };
}

export function parseMcpStatusText(text: string): ParsedMcpStatus | null {
	const servers = new Map<string, ParsedMcpServerStatus>();
	const configErrors: string[] = [];
	if (text.startsWith(NO_SERVERS_PREFIX)) return { servers, configErrors };
	let current: ParsedMcpServerStatus | undefined;
	for (const line of text.split("\n")) {
		if (line.startsWith("    ") && current) {
			current.detail += `\n${line.trim()}`;
			continue;
		}
		if (line.startsWith("config error: ")) {
			configErrors.push(redactMcpText(line.slice("config error: ".length)));
			current = undefined;
			continue;
		}
		if (line.startsWith("overridden: ")) {
			current = undefined;
			continue;
		}
		const match = SERVER_LINE.exec(line);
		if (!match?.[1] || match[2] === undefined || !EXPOSURE_SUFFIX.test(match[2])) return null;
		const body = match[2].replace(EXPOSURE_SUFFIX, "");
		current = { ...stateOf(body), detail: line };
		servers.set(match[1], current);
	}
	for (const server of servers.values()) server.detail = redactMcpText(server.detail);
	return { servers, configErrors };
}

export function parseMcpAttentionNotice(text: string): ParsedMcpStatus | null {
	if (!text.startsWith(MCP_ATTENTION_PREFIX)) return null;
	const servers = new Map<string, ParsedMcpServerStatus>();
	const configErrors: string[] = [];
	for (const raw of text.slice(MCP_ATTENTION_PREFIX.length).split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("Run /mcp")) continue;
		if (line.startsWith("config: ")) {
			configErrors.push(redactMcpText(line.slice("config: ".length)));
			continue;
		}
		const match = SERVER_LINE.exec(line);
		if (match?.[1] && match[2] !== undefined) {
			servers.set(match[1], { ...stateOf(match[2]), detail: redactMcpText(line) });
		}
	}
	return { servers, configErrors };
}

export function deriveMcpServerStatuses(options: {
	summaries: readonly McpServerSummary[];
	reported: ParsedMcpStatus | null;
	disabledInChat: ReadonlySet<string>;
	pendingReload?: ReadonlySet<string>;
	previous: readonly McpServerStatus[];
	now: number;
}): McpServerStatus[] {
	const { summaries, reported, disabledInChat, previous, now } = options;
	const before = new Map(previous.map((status) => [status.name, status]));
	const names = [
		...new Set([...summaries.map((summary) => summary.name), ...(reported?.servers.keys() ?? [])]),
	];
	return names.map((name): McpServerStatus => {
		const configured = summaries.filter((summary) => summary.name === name);
		const pending = configured.find(
			(summary) => summary.scope === "project" && summary.approval?.state !== "approved",
		);
		const invalid = configured.find((summary) => summary.configError);
		const parsed = reported?.servers.get(name);
		const stamp = (status: Omit<McpServerStatus, "name" | "updatedAt">): McpServerStatus => ({
			name,
			...status,
			updatedAt: now,
		});
		if (options.pendingReload?.has(name)) {
			return stamp({
				state: "pending-reload",
				...(parsed?.toolCount !== undefined ? { toolCount: parsed.toolCount } : {}),
				detail: "Applies when the chat is idle",
			});
		}
		if (parsed?.state === "disabled") {
			if (disabledInChat.has(name))
				return stamp({ state: "disabled-in-chat", detail: parsed.detail });
			if (configured.some((summary) => summary.projectOverride?.enabled === false)) {
				return stamp({ state: "disabled-in-project", detail: parsed.detail });
			}
			return stamp({ state: "disabled", detail: parsed.detail });
		}
		if (parsed) {
			return stamp({
				state: parsed.state,
				...(parsed.toolCount !== undefined ? { toolCount: parsed.toolCount } : {}),
				detail: parsed.detail,
			});
		}
		if (pending && !configured.some((summary) => summary.scope === "user")) {
			return stamp({ state: "pending-approval" });
		}
		if (invalid) return stamp({ state: "invalid-config", detail: invalid.configError ?? "" });
		if (reported === null) {
			const last = before.get(name);
			return last ? { ...last } : stamp({ state: "unknown" });
		}
		return stamp({ state: "unknown" });
	});
}
