import type {
	AppConfig,
	ExtUiRequest,
	LayoutChangedPayload,
	LoginPush,
	Project,
	ReviewChangedPayload,
	ServerWelcome,
	SessionDeletedPayload,
	SessionEventPayload,
	Workspace,
	WorkspaceFsChangedPayload,
	WorkspaceRemoved,
} from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { WsTransport } from "./transport";

let transport: WsTransport | null = null;

export function initTransport(): WsTransport {
	if (transport) return transport;

	transport = new WsTransport({
		onStatus: (status) => useAppStore.getState().setStatus(status),
	});

	transport.subscribe(WS_CHANNELS.serverWelcome, (data) => {
		const welcome = data as Partial<ServerWelcome>;
		if (typeof welcome.protocolVersion !== "number" || !Array.isArray(welcome.projects)) return;
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
	});

	transport.subscribe(WS_CHANNELS.projectUpdated, (data) => {
		useAppStore.getState().applyProjectUpdated(data as Project);
	});

	transport.subscribe(WS_CHANNELS.piEvent, (data) => {
		const { sessionId, event } = data as SessionEventPayload;
		useAppStore.getState().handlePiEvent(event, sessionId);
	});

	transport.subscribe(WS_CHANNELS.piExtensionUi, (data) => {
		useAppStore.getState().applyExtUi(data as ExtUiRequest);
	});

	transport.subscribe(WS_CHANNELS.sessionDeleted, (data) => {
		const { workspaceId, sessionId } = data as SessionDeletedPayload;
		useAppStore.getState().deleteChat(workspaceId, sessionId, false);
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

	transport.subscribe(WS_CHANNELS.layoutChanged, (data) => {
		useAppStore.getState().applyLayoutChanged(data as LayoutChangedPayload);
	});

	transport.connect();
	return transport;
}

export function getTransport(): WsTransport {
	if (!transport) throw new Error("transport not initialized — call initTransport() first");
	return transport;
}
