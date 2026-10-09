import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionUIContext,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { LoginFrame, LoginPush } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { liveSessionIdsOf, mcpSessionView } from "./agentSessionManager";
import {
	acquireMcpSignInLock,
	createMcpEngine,
	loadHostMcpConfig,
	type McpProjectPolicy,
	parseMcpStatusText,
	redactMcpText,
} from "./mcp";
import { reconnectMcpServer, refreshMcpStatus } from "./mcpSessions";
import { getPiRuntimeGeneration } from "./piRuntime";
import { createWebUiContext } from "./webUiContext";

const PROBE_SHUTDOWN_MS = 3_000;
const PROBE_DEADLINE_MS = 10 * 60_000;
const SIGN_IN_URL = /^Sign in to MCP server "[^"]+" in your browser:\n(\S+)$/;
const SIGNED_IN = /^Signed in to MCP server "/;
const PASTE_HINT =
	"Open the sign-in page. If the browser runs on another device, the localhost page it ends on will fail to load — paste that page's address here.";

export type McpProbeAction = "login" | "test" | "logout";

interface Probe {
	loginId: string;
	ownerClientKey: string;
	serverName: string;
	workspaceId: string;
	pendingInput?: (value: string | undefined) => void;
	session?: AgentSession;
	settled: boolean;
	cancelled: boolean;
	last?: LoginFrame;
}

const probes = new Map<string, Probe>();
let seq = 0;

let publish: (push: LoginPush, ownerClientKey: string) => void = () => {};
export function setMcpLoginPublisher(fn: (push: LoginPush, ownerClientKey: string) => void): void {
	publish = fn;
}

export function isMcpLoginId(loginId: string): boolean {
	return loginId.startsWith("mcplogin_");
}

function isAllowedSignInUrl(raw: string): boolean {
	if (!URL.canParse(raw)) return false;
	const url = new URL(raw);
	if (url.protocol === "https:") return true;
	return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function frame(probe: Probe, raw: LoginFrame): void {
	if (probe.settled) return;
	const next: LoginFrame =
		raw.kind === "error" ? { ...raw, message: redactMcpText(raw.message) } : raw;
	if (next.kind === "success" || next.kind === "error") {
		probe.settled = true;
		probe.last = next;
	}
	publish(
		{
			loginId: probe.loginId,
			providerId: `mcp:${probe.serverName}`,
			frame: next,
			target: { kind: "mcp", workspaceId: probe.workspaceId, serverName: probe.serverName },
		},
		probe.ownerClientKey,
	);
}

function probeUi(probe: Probe, notices: { message: string; level: string }[]): ExtensionUIContext {
	const noop = () => {};
	return {
		...createWebUiContext(`probe:${probe.loginId}`),
		notify(message, type) {
			notices.push({ message, level: type ?? "info" });
			const url = SIGN_IN_URL.exec(message)?.[1];
			if (!url) return;
			if (isAllowedSignInUrl(url)) frame(probe, { kind: "authUrl", url, instructions: PASTE_HINT });
			else
				frame(probe, {
					kind: "error",
					message: "The server sent a sign-in address that is not https.",
				});
		},
		async input(_title, placeholder, opts) {
			if (probe.settled) return undefined;
			return new Promise<string | undefined>((resolve) => {
				const settle = (value: string | undefined) => {
					if (probe.pendingInput === settle) delete probe.pendingInput;
					resolve(value);
				};
				probe.pendingInput = settle;
				opts?.signal?.addEventListener("abort", () => settle(undefined), { once: true });
				frame(probe, {
					kind: "prompt",
					message: "Paste the address the browser was sent to after signing in",
					...(placeholder ? { placeholder } : {}),
				});
			});
		},
		async select() {
			return undefined;
		},
		async confirm() {
			return false;
		},
		async editor() {
			return undefined;
		},
		setStatus: noop,
		setWidget: noop,
		setTitle: noop,
	};
}

async function openProbe(
	probe: Probe,
	options: { cwd: string; projectTrusted: boolean; policy: McpProjectPolicy },
	notices: { message: string; level: string }[],
): Promise<AgentSession> {
	const { cwd, projectTrusted, policy } = options;
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
	const loadConfig = () => {
		const loaded = loadHostMcpConfig({ agentDir, cwd, projectTrusted, policy });
		return {
			...loaded,
			servers: loaded.servers
				.filter((server) => server.name === probe.serverName)
				.map((server) => ({ ...server, config: { ...server.config, enabled: true } })),
		};
	};
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		additionalExtensionPaths: ["builtin:mcp"],
		extensionFactories: createMcpEngine({ loadConfig, lockSignIns: false }).extensions,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd,
		modelRuntime: (await getPiRuntimeGeneration()).runtime,
		sessionManager: SessionManager.inMemory(cwd),
		settingsManager,
		resourceLoader,
	});
	await session.bindExtensions({
		mode: "rpc",
		uiContext: probeUi(probe, notices),
		onError: () => {},
	});
	return session;
}

async function closeProbe(session: AgentSession): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }).catch(() => {}),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, PROBE_SHUTDOWN_MS);
		}),
	]);
	clearTimeout(timer);
	session.dispose();
}

function outcome(
	action: McpProbeAction,
	serverName: string,
	notices: readonly { message: string; level: string }[],
	status: string | undefined,
): LoginFrame {
	if (action === "test") {
		const parsed = status ? parseMcpStatusText(status)?.servers.get(serverName) : undefined;
		if (parsed?.state === "connected") return { kind: "success" };
		if (parsed?.state === "needs-sign-in")
			return { kind: "error", message: "Reachable — needs sign-in." };
		return { kind: "error", message: parsed?.detail ?? "The server did not answer." };
	}
	const last = notices.at(-1);
	if (action === "login" && notices.some((notice) => SIGNED_IN.test(notice.message))) {
		return { kind: "success" };
	}
	if (action === "logout" && last && last.level === "info") return { kind: "success" };
	return { kind: "error", message: last?.message ?? "Sign-in did not finish." };
}

async function reconnectSignedIn(workspaceId: string, serverName: string): Promise<void> {
	for (const sessionId of liveSessionIdsOf(workspaceId)) {
		const snapshot = await refreshMcpStatus(sessionId, 0);
		const state = snapshot?.servers.find((server) => server.name === serverName)?.state;
		if (state === "needs-sign-in" && mcpSessionView(sessionId)) {
			await reconnectMcpServer(sessionId, serverName).catch(() => {});
			await refreshMcpStatus(sessionId, 0);
		}
	}
}

export function startMcpProbe(options: {
	action: McpProbeAction;
	workspaceId: string;
	cwd: string;
	projectTrusted: boolean;
	policy: McpProjectPolicy;
	serverName: string;
	ownerClientKey: string;
	deadlineMs?: number;
}): { loginId: string; done: Promise<LoginFrame> } {
	const { action, serverName } = options;
	const lock = acquireMcpSignInLock(serverName, "settings");
	if ("heldBy" in lock) {
		const where = lock.heldBy === "chat" ? " in a chat" : "";
		throw new Error(`A sign-in for "${serverName}" is already running${where}.`);
	}
	let finish: (last: LoginFrame) => void = () => {};
	const done = new Promise<LoginFrame>((resolve) => {
		finish = resolve;
	});
	const probe: Probe = {
		loginId: `mcplogin_${++seq}`,
		ownerClientKey: options.ownerClientKey,
		serverName,
		workspaceId: options.workspaceId,
		settled: false,
		cancelled: false,
	};
	probes.set(probe.loginId, probe);
	const deadline = setTimeout(
		() => stopProbe(probe, "Sign-in timed out."),
		options.deadlineMs ?? PROBE_DEADLINE_MS,
	);
	const notices: { message: string; level: string }[] = [];
	void (async () => {
		try {
			frame(probe, {
				kind: "progress",
				message: action === "test" ? "Connecting…" : "Contacting the server…",
			});
			probe.session = await openProbe(probe, options, notices);
			if (probe.cancelled) return;
			const command = probe.session.extensionRunner.getCommand("mcp");
			if (!command) throw new Error("MCP is not available in this host.");
			const context = probe.session.extensionRunner.createCommandContext();
			const args =
				action === "login"
					? `login ${serverName}`
					: action === "logout"
						? `logout ${serverName}`
						: "";
			const before = notices.length;
			await command.handler(args, context);
			const status = action === "test" ? notices.slice(before).at(-1)?.message : undefined;
			const result = probe.cancelled
				? ({ kind: "error", message: "Sign-in cancelled." } as const)
				: outcome(action, serverName, notices.slice(before), status);
			if (result.kind === "success" && action === "test") {
				const parsed = status ? parseMcpStatusText(status)?.servers.get(serverName) : undefined;
				frame(probe, { kind: "progress", message: `Connected · ${parsed?.toolCount ?? 0} tools` });
			}
			frame(probe, result);
			if (result.kind === "success" && action === "login") {
				await reconnectSignedIn(options.workspaceId, serverName);
			}
		} catch (error) {
			frame(probe, {
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			clearTimeout(deadline);
			probes.delete(probe.loginId);
			if (probe.session) await closeProbe(probe.session).catch(() => {});
			lock.release();
			finish(probe.last ?? { kind: "error", message: "Sign-in did not finish." });
		}
	})();
	return { loginId: probe.loginId, done };
}

function ownedProbe(loginId: string, clientKey: string): Probe | undefined {
	const probe = probes.get(loginId);
	if (probe && probe.ownerClientKey !== clientKey) {
		throw new CodedError("LOGIN_NOT_OWNER", "This sign-in was started on another device.");
	}
	return probe;
}

export function replyMcpProbe(loginId: string, clientKey: string, value: string): void {
	ownedProbe(loginId, clientKey)?.pendingInput?.(value);
}

function stopProbe(probe: Probe, message: string): void {
	if (probe.settled) return;
	probe.cancelled = true;
	frame(probe, { kind: "error", message });
	probe.pendingInput?.(undefined);
	if (probe.session)
		void probe.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
}

export function cancelMcpProbe(loginId: string, clientKey: string): void {
	const probe = ownedProbe(loginId, clientKey);
	if (probe) stopProbe(probe, "Sign-in cancelled.");
}

export function cancelMcpProbesOwnedBy(clientKey: string): void {
	for (const probe of probes.values()) {
		if (probe.ownerClientKey === clientKey) stopProbe(probe, "Sign-in cancelled.");
	}
}

export function cancelAllMcpProbes(): void {
	for (const probe of probes.values()) stopProbe(probe, "Sign-in cancelled.");
}
