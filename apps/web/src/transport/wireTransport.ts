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

/** Create the singleton transport, route pushes into the store, and connect. */
export function initTransport(): WsTransport {
	if (transport) return transport;

	transport = new WsTransport({
		onStatus: (status) => useAppStore.getState().setStatus(status),
	});

	transport.subscribe(WS_CHANNELS.serverWelcome, (data) => {
		const welcome = data as Partial<ServerWelcome>;
		if (typeof welcome.protocolVersion === "number") {
			useAppStore.getState().setWelcome(welcome.protocolVersion);
		}
		if (Array.isArray(welcome.projects)) {
			// `recentProjects` is required by the current protocol; falling back keeps a stale host's open
			// projects usable while the shell surfaces the version mismatch.
			useAppStore
				.getState()
				.installProjectSnapshot(
					welcome.projects,
					Array.isArray(welcome.recentProjects) ? welcome.recentProjects : welcome.projects,
				);
		}
		// The host's source-of-truth app config (theme, …), applied on connect. Reconciles the pre-React
		// paint hint; the shell's theme effect performs the DOM swap.
		if (welcome.config) {
			useAppStore.getState().applyConfig(welcome.config);
		}
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

	// The workspace lifecycle trio — every client (including the initiator) converges by reacting to these,
	// never a per-client optimistic mutation. `created`/`updated` carry the full snapshot; `removed` the ids.
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

	// A workspace's review snapshot changed (UI edit, agent resolve, re-anchor) — every client converges
	// on the full-snapshot push, the initiator too (no optimistic mutation).
	transport.subscribe(WS_CHANNELS.reviewChanged, (data) => {
		const payload = data as ReviewChangedPayload;
		useAppStore.getState().applyReviewChanged(payload);
	});

	transport.subscribe(WS_CHANNELS.workspaceFsChanged, (data) => {
		useAppStore.getState().noteFsChanged(data as WorkspaceFsChangedPayload);
	});

	// A server-synced settings change (theme, …) — every client converges on this broadcast, including the
	// one that made the change (no optimistic apply).
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
