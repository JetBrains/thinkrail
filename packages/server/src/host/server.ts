import { createHash, randomUUID } from "node:crypto";
import { join, normalize } from "node:path";
import type {
	HostPlatform,
	HostUpdateNotice,
	ServerWelcome,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionStateRecord,
	TerminalTabsPush,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import {
	FEEDBACK_INTERVIEW_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import {
	disposeAllSessions,
	getSessionWorkspaceId,
	initializeSessionStates,
	isProjectSkillPath,
	refreshAgentReviewTool,
	refreshSubagentConcurrency,
	refreshSubagentTools,
	setAgentReviewEnabledResolver,
	setExtUiPublisher,
	setModelContextPublisher,
	setReviewCommentHandler,
	setSessionCreatedPublisher,
	setSessionDeletedPublisher,
	setSessionProjectResolver,
	setSessionPublisher,
	setSessionResourcesPublisher,
	setSessionStatePublisher,
	setSkillAdmissionResolver,
	setSubagentConcurrencyResolver,
	setSubagentsEnabledResolver,
	setTitleToolHost,
	settleSessionsForShutdown,
} from "../agent";
import {
	type AnalyticsOptions,
	initializeAnalytics,
	shutdownAnalytics,
	startAttributionClaim,
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
import { forgetOpenBranchReview } from "../branch-review";
import { redeliverInterview, releaseInterview, setFeedbackPublisher } from "../feedback";
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
	setWatchStartedPublisher,
	stopAllWatches,
} from "../watch";
import {
	getWorkspace,
	recordWorkspaceHead,
	refreshUserOwnedWorkspace,
	seedWorkspaceHead,
	setWorkspacePublisher,
} from "../workspaces";
import { BLOB_PREFIX, FILES_PREFIX, serveBlob, serveWorktreeFile } from "./fileRoutes";
import { setFsNudgePublisher } from "./fsNudge";
import { handleRequest, requestMethodDiagnostic } from "./handlers";
import { provisionInitialTerminal } from "./initialTerminal";
import { trackLoginOutcome } from "./loginAnalytics";
import {
	additionalCapture,
	applyAdditionalAnalyticsSettings,
	captureReviewCommentResolved,
	initialAdditionalAnalyticsEnabled,
	observeCurrentSetup,
	setupObservation,
} from "./productAnalytics";
import { RequestReplayCache } from "./requestReplayCache";
import {
	installRequestReviewSeam,
	maybeAutoReReview,
	setReviewFailedPublisher,
} from "./requestReview";
import { runObservation } from "./runAnalytics";
import {
	REVIEW_REFRESH_INTERVAL_MS,
	refreshOpenProjectReviews,
	stampSessionActivity,
} from "./settledLifecycle";
import { resolveSubagentMaxConcurrent, resolveSubagentsEnabled } from "./subagentPolicy";
import { taskObservation } from "./taskAnalytics";
import {
	BACKPRESSURE_RECONCILE_MS,
	drainedClientKeys,
	terminalDeliveryForSendStatus,
} from "./terminalSend";
import { titleToolHost } from "./titleTool";
import { markClientStale, reconcilePendingReviewsOnBoot } from "./todoReview";

export interface CreateServerOptions {
	port?: number;
	host?: string;
	staticDir?: string;
	projectPath?: string;
	appVersion?: string;
	analytics?: Pick<
		AnalyticsOptions,
		| "channel"
		| "build"
		| "posthogApiKey"
		| "posthogHost"
		| "mute"
		| "env"
		| "fetchImpl"
		| "openExternal"
		| "attributionEndpoint"
		| "attributionFetch"
		| "attributionSleep"
		| "attributionSchedule"
		| "attributionRequestTimeoutMs"
		| "attributionDeadlineMs"
	>;
	hostUpdate?: {
		intervalMs: number;
		check(): Promise<HostUpdateNotice | null>;
		run(): Promise<void>;
	};
}

export interface RunningServer {
	readonly port: number;
	startAttributionClaim: () => void;
	stop: () => void;
	shutdown: () => Promise<void>;
}

interface SocketData {
	clientKey: string;
	protocolVersion: number;
}

const CLIENT_REPLAY_RETENTION_MS = 60_000;

const log = logger("host");

const isRequestId = (id: unknown): id is string => typeof id === "string";

function clientProtocolVersion(value: string | null): number {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function sameHostUpdateRelease(
	current: HostUpdateNotice | undefined,
	next: HostUpdateNotice,
): boolean {
	return (
		current !== undefined &&
		current.currentVersion === next.currentVersion &&
		current.availableVersion === next.availableVersion &&
		current.channel === next.channel
	);
}

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
		hostUpdate,
	} = options;

	setSessionProjectResolver((workspaceId) => {
		try {
			return getWorkspace(workspaceId).projectId;
		} catch {
			return null;
		}
	});
	await initializeSessionStates(
		loadWorkspaces().map((workspace) => ({
			id: workspace.id,
			projectId: workspace.projectId,
			cwd: workspace.worktreePath,
		})),
	);

	const sockets = new Map<string, Bun.ServerWebSocket<SocketData>>();
	const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const requestReplays = new RequestReplayCache<string>();
	const terminalBackpressured = new Set<string>();
	let hostUpdateNotice: HostUpdateNotice | undefined;
	let hostUpdateTimer: ReturnType<typeof setInterval> | undefined;
	const reviewRefreshTimer = setInterval(
		() =>
			void refreshOpenProjectReviews().catch(() =>
				log.warn("periodic settled lifecycle refresh failed"),
			),
		REVIEW_REFRESH_INTERVAL_MS,
	);
	reviewRefreshTimer.unref?.();
	let hostUpdateActive = hostUpdate !== undefined;
	let hostUpdateChecking = false;
	let requestHostUpdate = (): void => {
		throw new Error("Host update is unavailable.");
	};
	let stopping = false;
	let shutdownPromise: Promise<void> | undefined;

	const armClientReap = (clientKey: string): void => {
		reapTimers.set(
			clientKey,
			setTimeout(() => {
				reapTimers.delete(clientKey);
				if (sockets.has(clientKey)) return;
				if (!requestReplays.clearClient(clientKey)) {
					armClientReap(clientKey);
					return;
				}
				releaseInterview(clientKey);
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
				const protocolVersion = clientProtocolVersion(url.searchParams.get("protocol"));
				return srv.upgrade(req, { data: { clientKey, protocolVersion } })
					? undefined
					: new Response("ws upgrade failed", { status: 400 });
			}
			if (url.pathname === "/health") {
				return new Response("ok");
			}
			if (url.pathname.startsWith(FILES_PREFIX)) {
				return serveWorktreeFile(url.pathname);
			}
			if (url.pathname.startsWith(BLOB_PREFIX)) {
				return serveBlob(url.pathname, req.signal);
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
				ws.subscribe(WS_CHANNELS.sessionCreated);
				ws.subscribe(WS_CHANNELS.sessionDeleted);
				ws.subscribe(WS_CHANNELS.sessionResourcesChanged);
				ws.subscribe(WS_CHANNELS.sessionState);
				ws.subscribe(WS_CHANNELS.providerLogin);
				ws.subscribe(WS_CHANNELS.providerChanged);
				ws.subscribe(WS_CHANNELS.projectUpdated);
				ws.subscribe(WS_CHANNELS.terminalTabs);
				ws.subscribe(WS_CHANNELS.workspaceCreated);
				ws.subscribe(WS_CHANNELS.workspaceUpdated);
				ws.subscribe(WS_CHANNELS.workspaceRemoved);
				ws.subscribe(WS_CHANNELS.workspaceFsChanged);
				ws.subscribe(WS_CHANNELS.settingsChanged);
				if (hostUpdate) ws.subscribe(WS_CHANNELS.hostUpdateAvailable);
				ws.subscribe(WS_CHANNELS.reviewChanged);
				ws.subscribe(WS_CHANNELS.reviewFailed);
				const hostPlatform: HostPlatform =
					process.platform === "darwin" || process.platform === "win32"
						? process.platform
						: "linux";
				const setupCapture = additionalCapture();
				const welcome: ServerWelcome = {
					protocolVersion: PROTOCOL_VERSION,
					hostPlatform,
					projects: listProjects(),
					recentProjects: listRecentProjects(),
					config: getConfig(),
					...(appVersion ? { appVersion } : {}),
					...(hostUpdateNotice ? { hostUpdate: hostUpdateNotice } : {}),
				};
				setupObservation.observe(setupCapture, {
					project_present: welcome.projects.length > 0 ? "yes" : "no",
				});
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
				redeliverInterview(ws.data.clientKey);
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
									protocolVersion: ws.data.protocolVersion,
									...(hostUpdate ? { runHostUpdate: requestHostUpdate } : {}),
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
				const { clientKey } = ws.data;
				if (stopping) return;
				if (sockets.get(clientKey) === ws) {
					sockets.delete(clientKey);
					terminalBackpressured.delete(clientKey);
				}
				if (sockets.has(clientKey) || reapTimers.has(clientKey)) return;
				armClientReap(clientKey);
			},
		},
	});

	const backpressureReconciler = setInterval(() => {
		const drained = drainedClientKeys(terminalBackpressured, (clientKey) =>
			sockets.get(clientKey)?.getBufferedAmount(),
		);
		for (const clientKey of drained) {
			log.warn(
				`terminal backpressure latch lifted by reconciler, drain never arrived (${clientKey})`,
			);
			terminalBackpressured.delete(clientKey);
			resumeClientTerminals(clientKey);
		}
	}, BACKPRESSURE_RECONCILE_MS);

	const publishHostUpdate = (notice: HostUpdateNotice): void => {
		if (!hostUpdateActive) return;
		hostUpdateNotice = notice;
		server.publish(
			WS_CHANNELS.hostUpdateAvailable,
			JSON.stringify({ channel: WS_CHANNELS.hostUpdateAvailable, data: notice }),
		);
	};

	const clearHostUpdateTimer = (): void => {
		if (hostUpdateTimer !== undefined) clearInterval(hostUpdateTimer);
		hostUpdateTimer = undefined;
	};

	const hostUpdateBlocksDiscovery = (): boolean =>
		hostUpdateNotice?.status === "running" || hostUpdateNotice?.status === "succeeded";

	const checkForHostUpdate = async (): Promise<void> => {
		if (!hostUpdate || !hostUpdateActive || hostUpdateChecking || hostUpdateBlocksDiscovery()) {
			return;
		}
		hostUpdateChecking = true;
		try {
			const result = await hostUpdate.check();
			if (!hostUpdateActive || hostUpdateBlocksDiscovery()) return;
			if (result && !sameHostUpdateRelease(hostUpdateNotice, result)) {
				publishHostUpdate({
					currentVersion: result.currentVersion,
					availableVersion: result.availableVersion,
					channel: result.channel,
					status: "available",
				});
			}
		} catch {
		} finally {
			hostUpdateChecking = false;
		}
	};

	requestHostUpdate = (): void => {
		if (!hostUpdate || !hostUpdateActive || !hostUpdateNotice) {
			throw new Error("Host update is unavailable.");
		}
		if (hostUpdateNotice.status === "running" || hostUpdateNotice.status === "succeeded") {
			return;
		}
		publishHostUpdate({ ...hostUpdateNotice, status: "running" });
		void (async () => {
			try {
				await hostUpdate.run();
				if (!hostUpdateActive || hostUpdateNotice?.status !== "running") return;
				publishHostUpdate({ ...hostUpdateNotice, status: "succeeded" });
				clearHostUpdateTimer();
			} catch {
				if (!hostUpdateActive || hostUpdateNotice?.status !== "running") return;
				publishHostUpdate({ ...hostUpdateNotice, status: "failed" });
			}
		})();
	};

	const stopHostUpdateChecks = (): void => {
		hostUpdateActive = false;
		clearHostUpdateTimer();
	};

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

	setFeedbackPublisher((clientKey) => {
		const ws = sockets.get(clientKey);
		if (!ws || ws.data.protocolVersion < FEEDBACK_INTERVIEW_PROTOCOL_VERSION) return false;
		try {
			return ws.send(JSON.stringify({ channel: WS_CHANNELS.feedbackInterview, data: {} })) !== 0;
		} catch {
			ws.close();
			return false;
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

	setSubagentsEnabledResolver((workspaceId) => {
		try {
			return resolveSubagentsEnabled(getConfig().subagentsEnabled, getWorkspace(workspaceId));
		} catch {
			return false;
		}
	});

	setSubagentConcurrencyResolver((workspaceId) => {
		const globalDefault = getConfig().subagentMaxConcurrent;
		try {
			return resolveSubagentMaxConcurrent(globalDefault, getWorkspace(workspaceId));
		} catch {
			return resolveSubagentMaxConcurrent(globalDefault, undefined);
		}
	});

	setAgentReviewEnabledResolver(() => getConfig().agentReviewEnabled !== false);

	setProjectPublisher((project) => {
		const capture = additionalCapture();
		if (capture) {
			try {
				setupObservation.observe(capture, {
					project_present: listProjects().length > 0 ? "yes" : "no",
				});
			} catch {}
		}
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

	setWatchStartedPublisher(seedWorkspaceHead);
	setRepoMetaPublisher((workspaceId) => {
		recordWorkspaceHead(workspaceId);
		refreshUserOwnedWorkspace(workspaceId);
		const workspace = loadWorkspaces().find((w) => w.id === workspaceId);
		if (workspace) forgetOpenBranchReview(workspace.worktreePath);
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
	setReviewFailedPublisher((payload) => {
		server.publish(
			WS_CHANNELS.reviewFailed,
			JSON.stringify({ channel: WS_CHANNELS.reviewFailed, data: payload }),
		);
	});
	setReviewCommentHandler((sessionId, commentId, note) => {
		const capture = additionalCapture();
		const resolved = resolveCommentFromAgent(sessionId, commentId, note);
		captureReviewCommentResolved(capture, "agent", "resolved");
		return { resolvedBody: resolved.body };
	});
	installRequestReviewSeam();
	setTitleToolHost(titleToolHost);
	reconcilePendingReviewsOnBoot();

	setSettingsPublisher((config, appliedUpdate) => {
		server.publish(
			WS_CHANNELS.settingsChanged,
			JSON.stringify({ channel: WS_CHANNELS.settingsChanged, data: config }),
		);
		if (applyAdditionalAnalyticsSettings(config, appliedUpdate)) {
			setupObservation.clear();
			runObservation.clear();
			taskObservation.clear();
			void observeCurrentSetup();
		}
		if (
			config.analyticsEnabled &&
			config.analyticsConsentConfirmed &&
			(appliedUpdate.analyticsEnabled === true || appliedUpdate.analyticsConsentConfirmed === true)
		) {
			startAttributionClaim();
		}
		if (appliedUpdate.subagentsEnabled !== undefined) refreshSubagentTools();
		if (appliedUpdate.subagentMaxConcurrent !== undefined) refreshSubagentConcurrency();
		if (appliedUpdate.agentReviewEnabled !== undefined) refreshAgentReviewTool();
	});

	setSessionCreatedPublisher((payload: SessionCreatedPayload) => {
		server.publish(
			WS_CHANNELS.sessionCreated,
			JSON.stringify({ channel: WS_CHANNELS.sessionCreated, data: payload }),
		);
	});

	setSessionStatePublisher((record: SessionStateRecord) => {
		stampSessionActivity(record);
		server.publish(
			WS_CHANNELS.sessionState,
			JSON.stringify({ channel: WS_CHANNELS.sessionState, data: record }),
		);
	});

	setSessionDeletedPublisher((payload: SessionDeletedPayload) => {
		runObservation.forget(payload.sessionId);
		taskObservation.forget(payload.sessionId);
		server.publish(
			WS_CHANNELS.sessionDeleted,
			JSON.stringify({ channel: WS_CHANNELS.sessionDeleted, data: payload }),
		);
	});

	setSessionResourcesPublisher((payload) => {
		server.publish(
			WS_CHANNELS.sessionResourcesChanged,
			JSON.stringify({ channel: WS_CHANNELS.sessionResourcesChanged, data: payload }),
		);
	});

	setSessionPublisher((payload) => {
		runObservation.observe(payload.sessionId, payload.event);
		if (payload.event.type === "tool_execution_start") {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			if (workspaceId) taskObservation.toolStarted(workspaceId, payload.sessionId, payload.event);
		}
		server.publish(
			WS_CHANNELS.piEvent,
			JSON.stringify({ channel: WS_CHANNELS.piEvent, data: payload }),
		);
		if (isTodoToolEnd(payload.event)) {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			const observeCompletion = taskObservation.toolFinished(payload.sessionId, payload.event);
			if (workspaceId)
				void maybeAttachChangeArtifacts(workspaceId, payload.sessionId).then(async () => {
					await observeCompletion();
					maybeAutoReReview(workspaceId, payload.sessionId);
				});
		}
	});

	setExtUiPublisher((request) => {
		server.publish(
			WS_CHANNELS.piExtensionUi,
			JSON.stringify({ channel: WS_CHANNELS.piExtensionUi, data: request }),
		);
	});

	setLoginPublisher((push, generation) => {
		server.publish(
			WS_CHANNELS.providerLogin,
			JSON.stringify({ channel: WS_CHANNELS.providerLogin, data: push }),
		);
		trackLoginOutcome(push, generation);
	});
	setJbcentralAppliedPublisher(() => {
		track({
			name: "provider_login",
			params: { provider: "jbcentral", method: "central", auth_method: "central" },
		});
	});
	const publishProviderChanged = () => {
		server.publish(
			WS_CHANNELS.providerChanged,
			JSON.stringify({ channel: WS_CHANNELS.providerChanged, data: {} }),
		);
	};
	setJbcentralChangedPublisher(publishProviderChanged);
	setModelContextPublisher(publishProviderChanged);

	const initialConfig = getConfig();
	initializeAnalytics({
		...(appVersion ? { appVersion } : {}),
		...(analytics ?? {}),
		additionalEnabled: initialAdditionalAnalyticsEnabled(initialConfig),
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

	void observeCurrentSetup();

	const stop = (): void => {
		if (stopping) return;
		stopping = true;
		clearInterval(reviewRefreshTimer);
		setupObservation.clear();
		runObservation.reset();
		taskObservation.clear();
		void shutdownAnalytics();
		stopHostUpdateChecks();
		cancelAllLogins();
		stopJbcentralRuntime();
		stopAllWatches();
		disposeAllSessions();
		for (const timer of reapTimers.values()) clearTimeout(timer);
		reapTimers.clear();
		sockets.clear();
		clearInterval(backpressureReconciler);
		terminalBackpressured.clear();
		requestReplays.clear();
		persistTerminalSessions();
		closeAllTerminals();
		setFeedbackPublisher(null);
		setSettingsPublisher(null);
		setModelContextPublisher(null);
		setJbcentralAppliedPublisher(() => {});
		setJbcentralChangedPublisher(() => {});
		server.stop(true);
	};
	const shutdown = (): Promise<void> => {
		shutdownPromise ??= (async () => {
			stopHostUpdateChecks();
			await Promise.allSettled([settleSessionsForShutdown(), shutdownAnalytics()]);
			stop();
		})();
		return shutdownPromise;
	};

	if (hostUpdate) {
		void checkForHostUpdate();
		hostUpdateTimer = setInterval(() => void checkForHostUpdate(), hostUpdate.intervalMs);
	}

	const startAttributionClaimWhenReady = (): void => {
		const config = getConfig();
		if (config.analyticsEnabled && config.analyticsConsentConfirmed) startAttributionClaim();
	};

	return {
		get port() {
			return server.port ?? port;
		},
		startAttributionClaim: startAttributionClaimWhenReady,
		stop,
		shutdown,
	};
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
