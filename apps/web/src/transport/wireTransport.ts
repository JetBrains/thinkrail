import type {
	AppConfig,
	ExtUiRequest,
	HostUpdateNotice,
	LoginPush,
	Project,
	ReviewChangedPayload,
	ServerWelcome,
	SessionAttentionPayload,
	SessionAttention as SessionAttentionRow,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionEventPayload,
	SessionRunning,
	SessionRunningPayload,
	Workspace,
	WorkspaceFsChangedPayload,
	WorkspaceRemoved,
} from "@thinkrail/contracts";
import {
	ATTENTION_NAVIGATION_PROTOCOL_VERSION,
	ATTENTION_PROTOCOL_VERSION,
	SESSION_RUNNING_PROTOCOL_VERSION,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { isConnectedGeneration, useAppStore } from "../store";
import { createAttentionHydration, createTokenizedSnapshotHydrator } from "./attentionHydration";
import { createPiEventBatcher, shouldFlushPiEventsBefore } from "./piEventBatcher";
import { WsTransport } from "./transport";

let transport: WsTransport | null = null;

export function supportsSessionAttention(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= ATTENTION_PROTOCOL_VERSION;
}

export function supportsAttentionNavigation(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= ATTENTION_NAVIGATION_PROTOCOL_VERSION;
}

export function supportsSessionRunning(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= SESSION_RUNNING_PROTOCOL_VERSION;
}

const attentionHydration = createAttentionHydration({
	apply: (payload: SessionAttentionPayload) =>
		useAppStore.getState().applySessionAttention(payload),
	hydrate: (rows: SessionAttentionRow[]) => useAppStore.getState().hydrateSessionAttention(rows),
});

const runningHydration = createTokenizedSnapshotHydrator({
	apply: (payload: SessionRunningPayload) => useAppStore.getState().applySessionRunning(payload),
	hydrate: (rows: SessionRunning[]) => useAppStore.getState().hydrateSessionRunning(rows),
});

function refreshSessionAttention(connectionGeneration: number): void {
	const state = useAppStore.getState();
	if (!supportsSessionAttention(state.protocolVersion)) {
		attentionHydration.abandon();
		state.hydrateSessionAttention([]);
		return;
	}
	const token = attentionHydration.begin();
	const current = (): boolean =>
		isConnectedGeneration(useAppStore.getState(), connectionGeneration);
	void getTransport()
		.request("session.attentionList", {})
		.then((rows) => {
			if (current()) attentionHydration.settle(token, rows);
			else attentionHydration.discard(token);
		})
		.catch(() => {
			if (current()) attentionHydration.fail(token);
			else attentionHydration.discard(token);
		});
}

function refreshSessionRunning(connectionGeneration: number): void {
	const state = useAppStore.getState();
	if (!supportsSessionRunning(state.protocolVersion)) {
		runningHydration.abandon();
		state.clearSessionRunning();
		return;
	}
	const token = runningHydration.begin();
	const current = (): boolean =>
		isConnectedGeneration(useAppStore.getState(), connectionGeneration);
	void getTransport()
		.request("session.runningList", {})
		.then((rows) => {
			if (current()) runningHydration.settle(token, rows);
			else runningHydration.discard(token);
		})
		.catch(() => {
			if (current()) runningHydration.fail(token);
			else runningHydration.discard(token);
		});
}

function refreshLoadedWorkspaceLists(connectionGeneration: number): void {
	const snapshot = useAppStore.getState();
	const openProjectIds = new Set(snapshot.projects.map((project) => project.id));
	for (const projectId of Object.keys(snapshot.workspaces)) {
		if (!openProjectIds.has(projectId)) continue;
		void getTransport()
			.request("workspace.list", { projectId, includeDiffStats: false })
			.then((workspaces) => {
				const current = useAppStore.getState();
				if (!isConnectedGeneration(current, connectionGeneration)) return;
				if (!current.projects.some((project) => project.id === projectId)) return;
				for (const workspace of workspaces) current.updateWorkspace(workspace);
			})
			.catch(() => {});
	}
}

export function initTransport(): WsTransport {
	if (transport) return transport;
	const piEvents = createPiEventBatcher((payloads) =>
		useAppStore.getState().handlePiEvents(payloads),
	);

	transport = new WsTransport(
		{
			onStatus: (status) => {
				piEvents.flush();
				const state = useAppStore.getState();
				if (status !== "connected") {
					runningHydration.abandon();
					state.clearSessionRunning();
				}
				state.setStatus(status);
			},
		},
		{
			beforeDispatch: (message) => {
				if (shouldFlushPiEventsBefore(message)) piEvents.flush();
			},
		},
	);

	transport.subscribe(WS_CHANNELS.serverWelcome, (data) => {
		const welcome = data as Partial<ServerWelcome>;
		if (typeof welcome.protocolVersion !== "number" || !Array.isArray(welcome.projects)) return;
		useAppStore.getState().hideInterviewPrompt();
		useAppStore
			.getState()
			.installWelcomeSnapshot(
				welcome.protocolVersion,
				welcome.projects,
				Array.isArray(welcome.recentProjects) ? welcome.recentProjects : welcome.projects,
				welcome.config,
				welcome.hostPlatform === "darwin" ||
					welcome.hostPlatform === "linux" ||
					welcome.hostPlatform === "win32"
					? welcome.hostPlatform
					: undefined,
				welcome.hostUpdate,
			);
		refreshLoadedWorkspaceLists(useAppStore.getState().connectionGeneration);
		refreshSessionAttention(useAppStore.getState().connectionGeneration);
		refreshSessionRunning(useAppStore.getState().connectionGeneration);
	});

	transport.subscribe(WS_CHANNELS.hostUpdateAvailable, (data) => {
		useAppStore.getState().applyHostUpdate(data as HostUpdateNotice);
	});

	transport.subscribe(WS_CHANNELS.projectUpdated, (data) => {
		useAppStore.getState().applyProjectUpdated(data as Project);
	});

	transport.subscribe(WS_CHANNELS.piEvent, (data) => {
		piEvents.enqueue(data as SessionEventPayload);
	});

	transport.subscribe(WS_CHANNELS.piExtensionUi, (data) => {
		useAppStore.getState().applyExtUi(data as ExtUiRequest);
	});

	transport.subscribe(WS_CHANNELS.sessionCreated, (data) => {
		const summary = data as SessionCreatedPayload;
		useAppStore
			.getState()
			.noteClosedChats(summary.workspaceId, [
				{ sessionId: summary.sessionId, title: summary.title, closedAt: summary.updatedAt },
			]);
	});

	transport.subscribe(WS_CHANNELS.sessionDeleted, (data) => {
		const { workspaceId, sessionId } = data as SessionDeletedPayload;
		useAppStore.getState().deleteChat(workspaceId, sessionId, false);
	});

	transport.subscribe(WS_CHANNELS.sessionAttention, (data) => {
		attentionHydration.push(data as SessionAttentionPayload);
	});

	transport.subscribe(WS_CHANNELS.sessionRunning, (data) => {
		runningHydration.push(data as SessionRunningPayload);
	});

	transport.subscribe(WS_CHANNELS.providerLogin, (data) => {
		useAppStore.getState().applyLoginFrame(data as LoginPush);
	});

	transport.subscribe(WS_CHANNELS.providerChanged, () => {
		useAppStore.getState().noteProviderChanged();
		const providerVersion = useAppStore.getState().providerVersion;
		getTransport()
			.request("model.list", {})
			.then((models) => useAppStore.getState().setModelsForProviderVersion(providerVersion, models))
			.catch(() => {});
	});

	transport.subscribe(WS_CHANNELS.feedbackInterview, () => {
		useAppStore.getState().showInterviewPrompt();
	});

	transport.subscribe(WS_CHANNELS.workspaceCreated, (data) => {
		useAppStore.getState().addWorkspace(data as Workspace);
	});

	transport.subscribe(WS_CHANNELS.workspaceUpdated, (data) => {
		useAppStore.getState().updateWorkspace(data as Workspace);
	});

	transport.subscribe(WS_CHANNELS.workspaceRemoved, (data) => {
		const { projectId, id } = data as WorkspaceRemoved;
		useAppStore.getState().applyWorkspaceRemoved(projectId, id);
	});

	transport.subscribe(WS_CHANNELS.reviewChanged, (data) => {
		const payload = data as ReviewChangedPayload;
		useAppStore.getState().applyReviewChanged(payload);
	});

	transport.subscribe(WS_CHANNELS.workspaceFsChanged, (data) => {
		useAppStore.getState().noteFsChanged(data as WorkspaceFsChangedPayload);
	});

	transport.subscribe(WS_CHANNELS.settingsChanged, (data) => {
		useAppStore.getState().applyConfig(data as AppConfig);
	});

	transport.connect();
	return transport;
}

export function getTransport(): WsTransport {
	if (!transport) throw new Error("transport not initialized — call initTransport() first");
	return transport;
}
