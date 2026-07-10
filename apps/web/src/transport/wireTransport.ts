import type {
	AuthEvent,
	ExtUiRequest,
	ServerWelcome,
	SessionEventPayload,
	Workspace,
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
			useAppStore.getState().setProjects(welcome.projects);
		}
		// Hydrate the provider-auth read on every (re)connect — the gate keys off a *definitive*
		// modelCount, so this fetch is what arms/disarms it.
		refreshAuthStatus();
	});

	transport.subscribe(WS_CHANNELS.authEvent, (data) => {
		const event = data as AuthEvent;
		useAppStore.getState().applyAuthEvent(event);
		// Any auth/model change (ours or another client's): re-read status + models so pickers and the
		// gate reconcile with the host's truth.
		if (event.kind === "changed") refreshAuthStatus();
	});

	transport.subscribe(WS_CHANNELS.piEvent, (data) => {
		const { sessionId, event } = data as SessionEventPayload;
		useAppStore.getState().handlePiEvent(event, sessionId);
	});

	transport.subscribe(WS_CHANNELS.piExtensionUi, (data) => {
		useAppStore.getState().applyExtUi(data as ExtUiRequest);
	});

	transport.subscribe(WS_CHANNELS.workspaceUpdated, (data) => {
		useAppStore.getState().updateWorkspace(data as Workspace);
	});

	transport.connect();
	return transport;
}

export function getTransport(): WsTransport {
	if (!transport) throw new Error("transport not initialized — call initTransport() first");
	return transport;
}

/** Re-read `auth.status` (+ `model.list` so open pickers refresh) into the store. Fire-and-forget. */
export function refreshAuthStatus(): void {
	const t = transport;
	if (!t) return;
	t.request("auth.status", {})
		.then((status) => useAppStore.getState().setAuthStatus(status))
		.catch(() => {
			/* transient — the next welcome/changed refetches */
		});
	t.request("model.list", {})
		.then((models) => useAppStore.getState().setModels(models))
		.catch(() => {
			/* transient */
		});
}
