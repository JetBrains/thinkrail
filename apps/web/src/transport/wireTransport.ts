import type {
	ExtUiRequest,
	LoginPush,
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
	});

	transport.subscribe(WS_CHANNELS.piEvent, (data) => {
		const { sessionId, event } = data as SessionEventPayload;
		useAppStore.getState().handlePiEvent(event, sessionId);
	});

	transport.subscribe(WS_CHANNELS.piExtensionUi, (data) => {
		useAppStore.getState().applyExtUi(data as ExtUiRequest);
	});

	transport.subscribe(WS_CHANNELS.providerLogin, (data) => {
		useAppStore.getState().applyLoginFrame(data as LoginPush);
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
