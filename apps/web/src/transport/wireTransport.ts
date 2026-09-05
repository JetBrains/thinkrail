import type {
	AppConfig,
	ExtUiRequest,
	LoginPush,
	Project,
	ReviewChangedPayload,
	ServerWelcome,
	SessionActivityPayload,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionEventPayload,
	Workspace,
	WorkspaceFsChangedPayload,
	WorkspaceRemoved,
} from "@thinkrail/contracts";
import { ACTIVITY_PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { isConnectedGeneration, useAppStore } from "../store";
import { createActivityHydration } from "./activityHydration";
import { createPiEventBatcher, shouldFlushPiEventsBefore } from "./piEventBatcher";
import { WsTransport } from "./transport";

let transport: WsTransport | null = null;

export function supportsSessionActivity(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= ACTIVITY_PROTOCOL_VERSION;
}

const activityHydration = createActivityHydration({
	apply: (payload) => useAppStore.getState().applySessionActivity(payload),
	hydrate: (rows) => useAppStore.getState().hydrateSessionActivity(rows),
});

function refreshSessionActivity(connectionGeneration: number): void {
	const state = useAppStore.getState();
	if (!supportsSessionActivity(state.protocolVersion)) {
		activityHydration.abandon();
		state.hydrateSessionActivity([]);
		return;
	}
	const token = activityHydration.begin();
	const current = (): boolean =>
		isConnectedGeneration(useAppStore.getState(), connectionGeneration);
	void getTransport()
		.request("session.activityList", {})
		.then((rows) => {
			if (current()) activityHydration.settle(token, rows);
			else activityHydration.discard(token);
		})
		.catch(() => {
			if (current()) activityHydration.fail(token);
			else activityHydration.discard(token);
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
				useAppStore.getState().setStatus(status);
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
			);
		refreshLoadedWorkspaceLists(useAppStore.getState().connectionGeneration);
		refreshSessionActivity(useAppStore.getState().connectionGeneration);
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

	transport.subscribe(WS_CHANNELS.sessionActivity, (data) => {
		activityHydration.push(data as SessionActivityPayload);
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
