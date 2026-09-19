import type {
	AppConfig,
	ExtUiRequest,
	HostUpdateNotice,
	LoginPush,
	Project,
	ReviewChangedPayload,
	ServerWelcome,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionEventPayload,
	SessionStateRecord,
	Workspace,
	WorkspaceFsChangedPayload,
	WorkspaceRemoved,
} from "@thinkrail/contracts";
import { SESSION_STATE_PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { isConnectedGeneration, useAppStore } from "../store";
import { createPiEventBatcher, shouldFlushPiEventsBefore } from "./piEventBatcher";
import { WsTransport } from "./transport";

let transport: WsTransport | null = null;

interface SessionStateHydration {
	generation: number;
	installed: boolean;
	buffered: SessionStateRecord[];
}

let sessionStateHydration: SessionStateHydration | null = null;
const SESSION_STATE_BUFFER_LIMIT = 4_096;

function applySessionStateRecord(record: SessionStateRecord): void {
	const store = useAppStore.getState();
	store.applySessionState(record);
	if (record.state.needsInput?.kind === "dialog") {
		store.applyExtUi(record.state.needsInput.request);
	}
}

function hydrateSessionStates(connectionGeneration: number): void {
	const hydration: SessionStateHydration = {
		generation: connectionGeneration,
		installed: false,
		buffered: [],
	};
	sessionStateHydration = hydration;
	let retryDelay = 500;
	const attempt = (): void => {
		void getTransport()
			.request("session.stateList", {})
			.then((records) => {
				const current = useAppStore.getState();
				if (
					sessionStateHydration !== hydration ||
					!isConnectedGeneration(current, connectionGeneration)
				) {
					return;
				}
				current.installSessionStateSnapshot(records);
				for (const record of records) {
					if (record.state.needsInput?.kind === "dialog") {
						current.applyExtUi(record.state.needsInput.request);
					}
				}
				hydration.installed = true;
				for (const record of hydration.buffered) applySessionStateRecord(record);
				hydration.buffered = [];
			})
			.catch(() => {
				const current = useAppStore.getState();
				if (
					sessionStateHydration !== hydration ||
					!isConnectedGeneration(current, connectionGeneration)
				) {
					return;
				}
				setTimeout(attempt, retryDelay);
				retryDelay = Math.min(retryDelay * 2, 8_000);
			});
	};
	attempt();
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
				welcome.hostUpdate,
			);
		const connectionGeneration = useAppStore.getState().connectionGeneration;
		refreshLoadedWorkspaceLists(connectionGeneration);
		if (welcome.protocolVersion >= SESSION_STATE_PROTOCOL_VERSION) {
			hydrateSessionStates(connectionGeneration);
		} else {
			sessionStateHydration = null;
			useAppStore.getState().installSessionStateSnapshot([]);
		}
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

	transport.subscribe(WS_CHANNELS.sessionState, (data) => {
		const record = data as SessionStateRecord;
		const hydration = sessionStateHydration;
		const current = useAppStore.getState();
		if (hydration && hydration.generation !== current.connectionGeneration) return;
		if (hydration && !hydration.installed && isConnectedGeneration(current, hydration.generation)) {
			if (hydration.buffered.length >= SESSION_STATE_BUFFER_LIMIT) {
				hydrateSessionStates(hydration.generation);
				sessionStateHydration?.buffered.push(record);
			} else {
				hydration.buffered.push(record);
			}
			return;
		}
		applySessionStateRecord(record);
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
		const store = useAppStore.getState();
		store.addWorkspace(data as Workspace);
		if (
			store.protocolVersion !== null &&
			store.protocolVersion >= SESSION_STATE_PROTOCOL_VERSION &&
			store.status === "connected"
		) {
			hydrateSessionStates(store.connectionGeneration);
		}
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
