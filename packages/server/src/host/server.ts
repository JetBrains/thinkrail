import { createHash, randomUUID } from "node:crypto";
import { join, normalize } from "node:path";
import type {
	HostPlatform,
	ServerWelcome,
	SessionDeletedPayload,
	TerminalTabsPush,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import {
	disposeAllSessions,
	getSessionWorkspaceId,
	isProjectSkillPath,
	setExtUiPublisher,
	setReviewCommentHandler,
	setSessionDeletedPublisher,
	setSessionPublisher,
	setSkillAdmissionResolver,
	settleSessionsForShutdown,
} from "../agent";
import {
	type AnalyticsOptions,
	initializeAnalytics,
	setAnalyticsSending,
	shutdownAnalytics,
	track,
} from "../analytics";
import {
	cancelAllLogins,
	initializeJbcentralRuntime,
	setJbcentralAppliedPublisher,
	setJbcentralChangedPublisher,
	setLoginPublisher,
	stopJbcentralRuntime,
} from "../auth";
import { resolveWorktreeFile } from "../fs";
import { logger } from "../log";
import { loadWorkspaces } from "../persistence";
import {
	getProjects,
	listProjects,
	listRecentProjects,
	openProject,
	setProjectPublisher,
} from "../projects";
import { reanchorWorkspace, resolveCommentFromAgent, setReviewPublisher } from "../reviews";
import { getConfig, setSettingsPublisher } from "../settings";
import {
	closeAllTerminals,
	persistTerminalSessions,
	resumeClientTerminals,
	reviveTerminalSessions,
	setTerminalPublisher,
	setTerminalTabsPublisher,
} from "../terminal";
import { isTodoToolEnd, maybeAttachChangeArtifacts } from "../todos";
import {
	setRepoMetaPublisher,
	setSkillPathClassifier,
	setWatchPublisher,
	stopAllWatches,
} from "../watch";
import { getWorkspace, refreshUserOwnedWorkspace, setWorkspacePublisher } from "../workspaces";
import {
	isPromptCommitted,
	isSettledTurn,
	maybeAutoRenameWorkspace,
	maybeNaiveNameWorkspace,
} from "./autoRename";
import { setFsNudgePublisher } from "./fsNudge";
import { handleRequest, requestMethodDiagnostic } from "./handlers";
import { provisionInitialTerminal } from "./initialTerminal";
import { trackLoginOutcome } from "./loginAnalytics";
import { RequestReplayCache } from "./requestReplayCache";
import { terminalDeliveryForSendStatus } from "./terminalSend";
import {
	handleReviewerSettled,
	installTodoReviewSeams,
	markClientStale,
	maybeAutoReReview,
	maybeResumeReflection,
	reconcilePendingReviewsOnBoot,
} from "./todoReview";

export interface CreateServerOptions {
	port?: number;
	host?: string;
	staticDir?: string;
	projectPath?: string;
	appVersion?: string;
	analytics?: Pick<
		AnalyticsOptions,
		"channel" | "build" | "posthogApiKey" | "posthogHost" | "mute"
	>;
}

export interface RunningServer {
	readonly port: number;
	stop: () => void;
	shutdown: () => Promise<void>;
}

interface SocketData {
	clientKey: string;
}

const CLIENT_REPLAY_RETENTION_MS = 60_000;

const log = logger("host");

const isRequestId = (id: unknown): id is string => typeof id === "string";

export async function createServer(options: CreateServerOptions = {}): Promise<RunningServer> {
	await initializeJbcentralRuntime();
	getConfig();
	const {
		port = 24242,
		host = "localhost",
		staticDir,
		projectPath,
		appVersion,
		analytics,
	} = options;

	const sockets = new Map<string, Bun.ServerWebSocket<SocketData>>();
	const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const requestReplays = new RequestReplayCache<string>();
	const terminalBackpressured = new Set<string>();
	let stopping = false;
	let shutdownPromise: Promise<void> | undefined;

	const armClientReap = (clientKey: string): void => {
		reapTimers.set(
			clientKey,
			setTimeout(() => {
				reapTimers.delete(clientKey);
				if (sockets.has(clientKey)) return;
				if (!requestReplays.clearClient(clientKey)) armClientReap(clientKey);
			}, CLIENT_REPLAY_RETENTION_MS),
		);
	};

	const server = Bun.serve<SocketData, never>({
		port,
		hostname: host,
		async fetch(req, srv) {
			const url = new URL(req.url);
			if (url.pathname === "/ws") {
				const clientKey = url.searchParams.get("client") ?? `anon-${randomUUID()}`;
				return srv.upgrade(req, { data: { clientKey } })
					? undefined
					: new Response("ws upgrade failed", { status: 400 });
			}
			if (url.pathname === "/health") {
				return new Response("ok");
			}
			if (url.pathname.startsWith("/files/")) {
				return serveWorktreeFile(url.pathname);
			}
			if (staticDir) {
				return serveStatic(url.pathname, staticDir);
			}
			return new Response("not found", { status: 404 });
		},
		websocket: {
			open(ws) {
				const replaced = sockets.get(ws.data.clientKey);
				sockets.set(ws.data.clientKey, ws);
				if (replaced && replaced !== ws) replaced.close();
				terminalBackpressured.delete(ws.data.clientKey);
				const pendingReap = reapTimers.get(ws.data.clientKey);
				if (pendingReap !== undefined) {
					clearTimeout(pendingReap);
					reapTimers.delete(ws.data.clientKey);
				}
				ws.subscribe(WS_CHANNELS.piEvent);
				ws.subscribe(WS_CHANNELS.piExtensionUi);
				ws.subscribe(WS_CHANNELS.sessionDeleted);
				ws.subscribe(WS_CHANNELS.providerLogin);
				ws.subscribe(WS_CHANNELS.providerChanged);
				ws.subscribe(WS_CHANNELS.projectUpdated);
				ws.subscribe(WS_CHANNELS.terminalTabs);
				ws.subscribe(WS_CHANNELS.workspaceCreated);
				ws.subscribe(WS_CHANNELS.workspaceUpdated);
				ws.subscribe(WS_CHANNELS.workspaceRemoved);
				ws.subscribe(WS_CHANNELS.workspaceFsChanged);
				ws.subscribe(WS_CHANNELS.settingsChanged);
				ws.subscribe(WS_CHANNELS.reviewChanged);
				const hostPlatform: HostPlatform =
					process.platform === "darwin" || process.platform === "win32"
						? process.platform
						: "linux";
				const welcome: ServerWelcome = {
					protocolVersion: PROTOCOL_VERSION,
					hostPlatform,
					projects: listProjects(),
					recentProjects: listRecentProjects(),
					config: getConfig(),
					...(appVersion ? { appVersion } : {}),
				};
				const welcomeStatus = ws.send(
					JSON.stringify({ channel: WS_CHANNELS.serverWelcome, data: welcome }),
				);
				const welcomeDelivery = terminalDeliveryForSendStatus(welcomeStatus);
				if (welcomeDelivery === "unavailable") {
					ws.close();
					return;
				}
				if (welcomeDelivery === "backpressured") {
					terminalBackpressured.add(ws.data.clientKey);
				}
				resumeClientTerminals(ws.data.clientKey);
			},
			async message(ws, message) {
				const raw = typeof message === "string" ? message : message.toString();
				let req: unknown;
				try {
					req = JSON.parse(raw);
				} catch {
					return;
				}
				if (typeof req !== "object" || req === null) return;
				if ("ack" in req && Array.isArray(req.ack)) {
					requestReplays.acknowledge(ws.data.clientKey, req.ack.filter(isRequestId));
					return;
				}
				if ("resume" in req && Array.isArray(req.resume)) {
					requestReplays.retain(ws.data.clientKey, req.resume.filter(isRequestId));
					return;
				}
				if (
					!("id" in req) ||
					typeof req.id !== "string" ||
					!("method" in req) ||
					typeof req.method !== "string"
				) {
					return;
				}
				const requestId = req.id;
				const method = req.method;
				const methodDiagnostic = requestMethodDiagnostic(method);
				const params = "params" in req ? req.params : undefined;
				const sessionId = "sessionId" in req ? req.sessionId : undefined;
				const fingerprint = createHash("sha256")
					.update(JSON.stringify([method, params, sessionId ?? null]))
					.digest("hex");
				log.debug(`ws ${methodDiagnostic}`);
				try {
					const response = await requestReplays.run(
						ws.data.clientKey,
						requestId,
						fingerprint,
						async () => {
							try {
								const result = await handleRequest(method, params, {
									clientKey: ws.data.clientKey,
								});
								return JSON.stringify({ id: requestId, ok: true, result });
							} catch (err) {
								const error = err instanceof Error ? err.message : String(err);
								log.debug(`ws ${methodDiagnostic} failed`);
								const code = errorCodeOf(err);
								return JSON.stringify({
									id: requestId,
									ok: false,
									error,
									...(code ? { errorCode: code } : {}),
								});
							}
						},
					);
					if (ws.send(response) === 0) ws.close();
				} catch (err) {
					const error = err instanceof Error ? err.message : String(err);
					if (ws.send(JSON.stringify({ id: requestId, ok: false, error })) === 0) ws.close();
				}
			},
			drain(ws) {
				if (sockets.get(ws.data.clientKey) !== ws) return;
				terminalBackpressured.delete(ws.data.clientKey);
				resumeClientTerminals(ws.data.clientKey);
			},
			close(ws) {
				if (stopping) return;
				const { clientKey } = ws.data;
				if (sockets.get(clientKey) === ws) {
					sockets.delete(clientKey);
					terminalBackpressured.delete(clientKey);
				}
				if (sockets.has(clientKey) || reapTimers.has(clientKey)) return;
				armClientReap(clientKey);
			},
		},
	});

	setTerminalPublisher((clientKey, channel, data) => {
		if (terminalBackpressured.has(clientKey)) return "unavailable";
		const ws = sockets.get(clientKey);
		if (!ws) return "unavailable";
		try {
			const delivery = terminalDeliveryForSendStatus(ws.send(JSON.stringify({ channel, data })));
			if (delivery !== "delivered") terminalBackpressured.add(clientKey);
			return delivery;
		} catch {
			terminalBackpressured.add(clientKey);
			ws.close();
			return "unavailable";
		}
	});

	setSkillAdmissionResolver((workspaceId) => {
		try {
			const { projectId, skillOverrides } = getWorkspace(workspaceId);
			const project = getProjects().find((p) => p.id === projectId);
			return {
				trusted: project?.trusted === true,
				acknowledged: project?.acknowledgedSkills ?? [],
				disabled: project?.disabledSkills ?? [],
				disabledGroups: project?.disabledGroups ?? [],
				overrides: skillOverrides ?? {},
			};
		} catch {
			return { trusted: false, acknowledged: [], disabled: [], disabledGroups: [], overrides: {} };
		}
	});

	setProjectPublisher((project) => {
		server.publish(
			WS_CHANNELS.projectUpdated,
			JSON.stringify({ channel: WS_CHANNELS.projectUpdated, data: project }),
		);
	});

	setTerminalTabsPublisher((workspaceId, tabs) => {
		const data: TerminalTabsPush = { workspaceId, tabs };
		server.publish(
			WS_CHANNELS.terminalTabs,
			JSON.stringify({ channel: WS_CHANNELS.terminalTabs, data }),
		);
	});

	setWorkspacePublisher((event) => {
		const channel =
			event.kind === "created"
				? WS_CHANNELS.workspaceCreated
				: event.kind === "updated"
					? WS_CHANNELS.workspaceUpdated
					: WS_CHANNELS.workspaceRemoved;
		const data =
			event.kind === "removed" ? { projectId: event.projectId, id: event.id } : event.workspace;
		server.publish(channel, JSON.stringify({ channel, data }));
	});

	const publishFsChanged = (payload: WorkspaceFsChangedPayload) => {
		server.publish(
			WS_CHANNELS.workspaceFsChanged,
			JSON.stringify({ channel: WS_CHANNELS.workspaceFsChanged, data: payload }),
		);
		reanchorWorkspace(payload.workspaceId);
	};
	setWatchPublisher(publishFsChanged);
	setSkillPathClassifier(isProjectSkillPath);
	setFsNudgePublisher(publishFsChanged);

	setRepoMetaPublisher((workspaceId) => {
		refreshUserOwnedWorkspace(workspaceId);
		publishFsChanged({ workspaceId, paths: [], truncated: false, skillChange: "none" });
	});

	setReviewPublisher((payload) => {
		server.publish(
			WS_CHANNELS.reviewChanged,
			JSON.stringify({
				channel: WS_CHANNELS.reviewChanged,
				data: markClientStale(payload, payload.workspaceId),
			}),
		);
	});
	setReviewCommentHandler((sessionId, commentId, note) => ({
		resolvedBody: resolveCommentFromAgent(sessionId, commentId, note).body,
	}));
	installTodoReviewSeams();
	reconcilePendingReviewsOnBoot();

	setSettingsPublisher((config) => {
		server.publish(
			WS_CHANNELS.settingsChanged,
			JSON.stringify({ channel: WS_CHANNELS.settingsChanged, data: config }),
		);
		setAnalyticsSending(config.analyticsEnabled);
	});

	setSessionDeletedPublisher((payload: SessionDeletedPayload) => {
		server.publish(
			WS_CHANNELS.sessionDeleted,
			JSON.stringify({ channel: WS_CHANNELS.sessionDeleted, data: payload }),
		);
	});

	setSessionPublisher((payload) => {
		server.publish(
			WS_CHANNELS.piEvent,
			JSON.stringify({ channel: WS_CHANNELS.piEvent, data: payload }),
		);
		if (isPromptCommitted(payload.event)) {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			if (workspaceId) void maybeNaiveNameWorkspace(payload.sessionId, workspaceId);
		} else if (isSettledTurn(payload.event)) {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			if (workspaceId) void maybeAutoRenameWorkspace(payload.sessionId, workspaceId);
			handleReviewerSettled(payload.sessionId, payload.event);
			maybeResumeReflection(payload.sessionId);
		}
		if (isTodoToolEnd(payload.event)) {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			if (workspaceId)
				void maybeAttachChangeArtifacts(workspaceId, payload.sessionId).then(() =>
					maybeAutoReReview(workspaceId, payload.sessionId),
				);
		}
	});

	setExtUiPublisher((request) => {
		server.publish(
			WS_CHANNELS.piExtensionUi,
			JSON.stringify({ channel: WS_CHANNELS.piExtensionUi, data: request }),
		);
	});

	setLoginPublisher((push) => {
		server.publish(
			WS_CHANNELS.providerLogin,
			JSON.stringify({ channel: WS_CHANNELS.providerLogin, data: push }),
		);
		trackLoginOutcome(push);
	});
	setJbcentralAppliedPublisher(() => {
		track({ name: "provider_login", params: { provider: "jbcentral", method: "central" } });
	});
	setJbcentralChangedPublisher(() => {
		server.publish(
			WS_CHANNELS.providerChanged,
			JSON.stringify({ channel: WS_CHANNELS.providerChanged, data: {} }),
		);
	});

	initializeAnalytics({
		...(appVersion ? { appVersion } : {}),
		...(analytics ?? {}),
		enabled: getConfig().analyticsEnabled,
	});

	reviveTerminalSessions();
	for (const workspace of loadWorkspaces()) provisionInitialTerminal(workspace);

	if (projectPath) {
		try {
			openProject(projectPath);
		} catch {
			log.warn("could not open requested project");
		}
	}

	const stop = (): void => {
		if (stopping) return;
		stopping = true;
		void shutdownAnalytics();
		cancelAllLogins();
		stopJbcentralRuntime();
		stopAllWatches();
		disposeAllSessions();
		for (const timer of reapTimers.values()) clearTimeout(timer);
		reapTimers.clear();
		sockets.clear();
		terminalBackpressured.clear();
		requestReplays.clear();
		persistTerminalSessions();
		closeAllTerminals();
		setSettingsPublisher(null);
		setJbcentralAppliedPublisher(() => {});
		setJbcentralChangedPublisher(() => {});
		server.stop(true);
	};
	const shutdown = (): Promise<void> => {
		shutdownPromise ??= (async () => {
			await Promise.allSettled([settleSessionsForShutdown(), shutdownAnalytics()]);
			stop();
		})();
		return shutdownPromise;
	};

	return {
		get port() {
			return server.port ?? port;
		},
		stop,
		shutdown,
	};
}

async function serveWorktreeFile(pathname: string): Promise<Response> {
	const rest = pathname.slice("/files/".length);
	const slash = rest.indexOf("/");
	if (slash <= 0) return new Response("not found", { status: 404 });
	const workspaceId = decodeURIComponent(rest.slice(0, slash));
	const relPath = decodeURIComponent(rest.slice(slash + 1));
	try {
		const file = Bun.file(resolveWorktreeFile(workspaceId, relPath));
		if (!(await file.exists())) return new Response("not found", { status: 404 });
		return new Response(file);
	} catch {
		return new Response("not found", { status: 404 });
	}
}

async function serveStatic(pathname: string, staticDir: string): Promise<Response> {
	const safe = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
	const requested = safe === "/" || safe === "" ? "index.html" : safe;
	const file = Bun.file(join(staticDir, requested));
	if (await file.exists()) return new Response(file);
	const index = Bun.file(join(staticDir, "index.html"));
	if (await index.exists()) return new Response(index);
	return new Response("not found", { status: 404 });
}
