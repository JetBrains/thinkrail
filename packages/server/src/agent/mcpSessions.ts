import {
	closeSync,
	type FSWatcher,
	fstatSync,
	mkdirSync,
	openSync,
	readSync,
	watch,
} from "node:fs";
import { isAbsolute } from "node:path";
import { getAgentDir, type McpServerConfig } from "@earendil-works/pi-coding-agent";
import type {
	McpListResult,
	McpReadOutputResult,
	McpServerResourceSummary,
	McpServerStatus,
	McpStatusSnapshot,
	McpTransportKind,
	Project,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	dispatchSessionMcpCommand,
	getSessionMessages,
	liveSessionIdsOf,
	type McpSessionView,
	mcpSessionView,
	requestSessionReload,
	type SessionReloadDisposition,
} from "./agentSessionManager";
import { publishSessionResourcesChanged } from "./chatResources";
import { isBuiltinExtensionEnabled } from "./extensions";
import {
	deriveMcpServerStatuses,
	isMcpResultTool,
	loadHostMcpConfig,
	mcpPolicyOf,
	type ParsedMcpStatus,
	parseMcpAttentionNotice,
	parseMcpStatusText,
	redactMcpText,
	summarizeMcpConfigErrors,
	summarizeMcpServers,
} from "./mcp";
import { interceptExtUiNotify } from "./webUiContext";

const USER_CONFIG_DEBOUNCE_MS = 300;
const READ_OUTPUT_MAX_BYTES = 1024 * 1024;

const BUILTIN_MCP = "builtin:mcp";
const DISABLED_IN_SETTINGS = "pi settings (-builtin:mcp)";

interface Tracked {
	generation: number;
	load: number;
	servers: McpServerStatus[];
	transports: Map<string, McpTransportKind>;
	registered: Set<string>;
	resourcesKey: string;
	inFlight: Promise<void> | null;
	stopAttention: () => void;
}

const tracked = new Map<string, Tracked>();

let publish: (snapshot: McpStatusSnapshot) => void = () => {};
export function setMcpStatusPublisher(fn: (snapshot: McpStatusSnapshot) => void): void {
	publish = fn;
}

function snapshotOf(sessionId: string): McpStatusSnapshot | null {
	const view = mcpSessionView(sessionId);
	const state = tracked.get(sessionId);
	if (!view || !state || state.generation === 0) return null;
	return {
		workspaceId: view.workspaceId,
		sessionId,
		generation: state.generation,
		servers: state.servers,
	};
}

function asParsed(servers: readonly McpServerStatus[]): ParsedMcpStatus["servers"] {
	return new Map(
		servers.map((status) => [
			status.name,
			{
				state: status.state,
				...(status.toolCount !== undefined ? { toolCount: status.toolCount } : {}),
				detail: status.detail ?? "",
			},
		]),
	);
}

const ownsMcp = (view: McpSessionView | undefined): view is McpSessionView =>
	view?.commandOwner === BUILTIN_MCP;

const configKey = (config: McpServerConfig | undefined): string | undefined =>
	config === undefined ? undefined : JSON.stringify(config);

export function pendingMcpReload(sessionId: string): Set<string> {
	const view = mcpSessionView(sessionId);
	if (!ownsMcp(view) || !view.loaded) return new Set();
	const { loaded } = view;
	const current = new Map(
		loadHostMcpConfig({
			agentDir: getAgentDir(),
			cwd: view.cwd,
			projectTrusted: view.projectTrusted,
			policy: view.policy,
			disabledInChat: view.disabledInChat,
		}).servers.map((server) => [server.name, server.config]),
	);
	const names = new Set([...current.keys(), ...loaded.keys()]);
	return new Set(
		[...names].filter((name) => configKey(current.get(name)) !== configKey(loaded.get(name))),
	);
}

function registeredTransports(view: McpSessionView): Map<string, McpTransportKind> {
	return new Map(
		view.registered
			.filter((server) => !view.loaded?.has(server.name))
			.map((server) => [server.name, "url" in server.config ? "http" : "stdio"]),
	);
}

function publishResources(sessionId: string, workspaceId: string, state: Tracked): void {
	const resourcesKey = JSON.stringify(mcpResourceSummaries(sessionId));
	if (resourcesKey === state.resourcesKey) return;
	state.resourcesKey = resourcesKey;
	publishSessionResourcesChanged(workspaceId, sessionId);
}

function apply(sessionId: string, reported: ParsedMcpStatus | null, partial: boolean): void {
	const view = mcpSessionView(sessionId);
	const state = tracked.get(sessionId);
	if (!ownsMcp(view) || !state) return;
	const merged: ParsedMcpStatus | null =
		partial && reported
			? {
					servers: new Map([...asParsed(state.servers), ...reported.servers]),
					configErrors: reported.configErrors,
				}
			: reported;
	const summaries = summarizeMcpServers({
		agentDir: getAgentDir(),
		cwd: view.cwd,
		projectTrusted: view.projectTrusted,
		policy: view.policy,
	});
	const registered = registeredTransports(view);
	state.transports = new Map([
		...summaries.map((summary): [string, McpTransportKind] => [summary.name, summary.transport]),
		...registered,
	]);
	state.registered = new Set(registered.keys());
	state.servers = deriveMcpServerStatuses({
		summaries,
		reported: merged,
		disabledInChat: view.disabledInChat,
		pendingReload: pendingMcpReload(sessionId),
		previous: state.servers,
		now: Date.now(),
	});
	state.generation++;
	const snapshot = snapshotOf(sessionId);
	if (snapshot) publish(snapshot);
	publishResources(sessionId, view.workspaceId, state);
}

function retire(sessionId: string, view: McpSessionView): void {
	const state = tracked.get(sessionId);
	if (!state || state.servers.length === 0) return;
	state.servers = [];
	state.generation++;
	publish({ workspaceId: view.workspaceId, sessionId, generation: state.generation, servers: [] });
	publishResources(sessionId, view.workspaceId, state);
}

export function showPendingMcpReload(sessionId: string): void {
	apply(sessionId, null, true);
}

function startingReport(view: McpSessionView): ParsedMcpStatus {
	const servers: ParsedMcpStatus["servers"] = new Map();
	const given = [
		...(view.loaded ?? []),
		...view.registered.map((server): [string, McpServerConfig] => [server.name, server.config]),
	];
	for (const [name, config] of given) {
		if (servers.has(name)) continue;
		servers.set(name, { state: config.enabled === false ? "disabled" : "starting", detail: "" });
	}
	return { servers, configErrors: [] };
}

export function restartMcpStatus(sessionId: string): void {
	const view = mcpSessionView(sessionId);
	if (!view) return;
	const state = trackedOf(sessionId);
	state.load++;
	state.inFlight = null;
	if (ownsMcp(view)) apply(sessionId, startingReport(view), false);
	scheduleMcpStatusRefresh(sessionId);
}

export function assertMcpServerDisablableInChat(sessionId: string, name: string): void {
	const view = mcpSessionView(sessionId);
	if (!ownsMcp(view)) {
		throw new CodedError("MCP_HANDLED_ELSEWHERE", "MCP is not managed by ThinkRail here.");
	}
	if (view.loaded?.has(name)) return;
	throw new CodedError(
		"MCP_CONFIG_INVALID",
		view.registered.some((server) => server.name === name)
			? `"${name}" is registered by an extension; it can't be disabled per chat.`
			: `No MCP server named "${name}" is configured for this chat.`,
	);
}

export function mcpResourceSummaries(sessionId: string): McpServerResourceSummary[] {
	const state = tracked.get(sessionId);
	if (!state) return [];
	return state.servers.map((status) => ({
		name: status.name,
		state: status.state,
		...(status.toolCount !== undefined ? { toolCount: status.toolCount } : {}),
		transport: state.transports.get(status.name) ?? "stdio",
		...(state.registered.has(status.name) ? { registered: true as const } : {}),
	}));
}

export async function reconcileMcpSessions(
	sessionIds: readonly string[],
): Promise<Record<string, SessionReloadDisposition>> {
	const dispositions: Record<string, SessionReloadDisposition> = {};
	for (const sessionId of sessionIds) {
		if (pendingMcpReload(sessionId).size === 0) continue;
		try {
			const disposition = await requestSessionReload(sessionId);
			dispositions[sessionId] = disposition;
			if (disposition === "deferred") showPendingMcpReload(sessionId);
		} catch {}
	}
	return dispositions;
}

export function watchUserMcpConfig(): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let watcher: FSWatcher | undefined;
	try {
		const agentDir = getAgentDir();
		mkdirSync(agentDir, { recursive: true });
		watcher = watch(agentDir, (_event, filename) => {
			if (filename !== null && filename !== "mcp.json") return;
			clearTimeout(timer);
			timer = setTimeout(
				() => void reconcileMcpSessions(liveSessionIdsOf()),
				USER_CONFIG_DEBOUNCE_MS,
			);
		});
	} catch {
		return () => {};
	}
	return () => {
		clearTimeout(timer);
		watcher?.close();
	};
}

export function watchMcpStatus(sessionId: string): void {
	trackedOf(sessionId);
}

function trackedOf(sessionId: string): Tracked {
	const existing = tracked.get(sessionId);
	if (existing) return existing;
	const state: Tracked = {
		generation: 0,
		load: 0,
		servers: [],
		transports: new Map(),
		registered: new Set(),
		resourcesKey: "[]",
		inFlight: null,
		stopAttention: () => {},
	};
	tracked.set(sessionId, state);
	state.stopAttention = interceptExtUiNotify(sessionId, (message) => {
		const parsed = parseMcpAttentionNotice(message);
		if (!parsed) return false;
		apply(sessionId, parsed, true);
		queueMicrotask(() => scheduleMcpStatusRefresh(sessionId));
		return false;
	});
	return state;
}

async function capture(sessionId: string, state: Tracked): Promise<void> {
	const load = state.load;
	const notices: string[] = [];
	try {
		await dispatchSessionMcpCommand(sessionId, "", (message) => notices.push(message));
	} catch {}
	if (tracked.get(sessionId) !== state || state.load !== load) return;
	const parsed = notices.map(parseMcpStatusText).findLast((status) => status !== null);
	if (parsed) apply(sessionId, parsed, false);
}

export async function refreshMcpStatus(
	sessionId: string,
	waitMs: number,
): Promise<McpStatusSnapshot | null> {
	const view = mcpSessionView(sessionId);
	if (!view) return null;
	if (!ownsMcp(view)) {
		retire(sessionId, view);
		return null;
	}
	const state = trackedOf(sessionId);
	if (!state.inFlight) {
		const running: Promise<void> = capture(sessionId, state).finally(() => {
			if (state.inFlight === running) state.inFlight = null;
		});
		state.inFlight = running;
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		state.inFlight,
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, waitMs);
		}),
	]);
	clearTimeout(timer);
	return snapshotOf(sessionId);
}

export async function reconnectMcpServer(sessionId: string, name: string): Promise<void> {
	const failures: string[] = [];
	const reconnect = ownsMcp(mcpSessionView(sessionId))
		? dispatchSessionMcpCommand(sessionId, `reconnect ${name}`, (message, level) => {
				if (level === "error") failures.push(message);
			})
		: null;
	if (!reconnect) {
		throw new CodedError("MCP_HANDLED_ELSEWHERE", "MCP is not managed by ThinkRail here.");
	}
	await reconnect;
	const failure = failures.at(-1);
	if (failure !== undefined) throw new Error(redactMcpText(failure));
}

export function scheduleMcpStatusRefresh(sessionId: string): void {
	void refreshMcpStatus(sessionId, 0);
}

export function forgetMcpStatus(sessionId: string): void {
	tracked.get(sessionId)?.stopAttention();
	tracked.delete(sessionId);
}

function mcpOwnerElsewhere(
	owners: readonly (string | null)[],
	enabledInSettings: boolean,
): string | undefined {
	const replacement = owners.find((owner) => owner !== null && owner !== BUILTIN_MCP);
	if (replacement) return replacement;
	if (!enabledInSettings) return DISABLED_IN_SETTINGS;
	return owners.includes(null) ? "pi settings" : undefined;
}

/**
 * Resolves pi settings, then returns a synchronous answer to "who manages MCP for this workspace instead
 * of ThinkRail?" (`undefined` when ThinkRail does) that samples the live `/mcp` owners when called, so a
 * caller can check and mutate in one call stack.
 */
export async function mcpOwnershipGuard(options: {
	workspaceId: string;
	cwd: string;
	projectTrusted: boolean;
}): Promise<() => string | undefined> {
	const enabledInSettings = await isBuiltinExtensionEnabled(
		options.cwd,
		options.projectTrusted,
		"mcp",
	);
	return () =>
		mcpOwnerElsewhere(
			liveSessionIdsOf(options.workspaceId).map(
				(sessionId) => mcpSessionView(sessionId)?.commandOwner ?? null,
			),
			enabledInSettings,
		);
}

export async function listMcpServers(options: {
	workspaceId: string;
	cwd: string;
	project: Pick<Project, "piResourceTrust" | "mcpApprovals" | "mcpOverrides"> | undefined;
	waitMs: number;
}): Promise<McpListResult> {
	const sessionIds = liveSessionIdsOf(options.workspaceId);
	const projectTrusted = options.project?.piResourceTrust === "granted";
	const [snapshots, ownership] = await Promise.all([
		Promise.all(sessionIds.map((sessionId) => refreshMcpStatus(sessionId, options.waitMs))),
		mcpOwnershipGuard({ workspaceId: options.workspaceId, cwd: options.cwd, projectTrusted }),
	]);
	const elsewhere = ownership();
	const files = { agentDir: getAgentDir(), cwd: options.cwd, projectTrusted };
	const configErrors = summarizeMcpConfigErrors(files);
	return {
		servers: summarizeMcpServers({ ...files, policy: mcpPolicyOf(options.project) }),
		statuses: snapshots.filter((snapshot): snapshot is McpStatusSnapshot => snapshot !== null),
		...(configErrors.length > 0 ? { configErrors } : {}),
		...(elsewhere !== undefined ? { handledElsewhere: { by: elsewhere } } : {}),
	};
}

function readBounded(path: string): { text: string; truncated: boolean } {
	const fd = openSync(path, "r");
	try {
		const size = fstatSync(fd).size;
		const buffer = Buffer.alloc(Math.min(size, READ_OUTPUT_MAX_BYTES));
		const read = readSync(fd, buffer, 0, buffer.length, 0);
		return { text: buffer.subarray(0, read).toString("utf8"), truncated: size > read };
	} finally {
		closeSync(fd);
	}
}

export async function readMcpToolOutput(
	workspaceId: string,
	sessionId: string,
	toolCallId: string,
	cwd: string,
): Promise<McpReadOutputResult> {
	const { messages } = await getSessionMessages(sessionId, workspaceId, cwd);
	const result = messages.find(
		(message) => message.role === "toolResult" && message.toolCallId === toolCallId,
	);
	if (result?.role !== "toolResult" || !isMcpResultTool(result.toolName)) {
		return { available: false, reason: "unavailable" };
	}
	const details = result.details as { fullOutputPath?: unknown } | undefined;
	const path = details?.fullOutputPath;
	if (typeof path !== "string" || !isAbsolute(path))
		return { available: false, reason: "unavailable" };
	try {
		return { available: true, ...readBounded(path) };
	} catch {
		return { available: false, reason: "expired" };
	}
}
