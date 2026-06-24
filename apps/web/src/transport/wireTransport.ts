import type { Project } from "@thinkrail-pi/contracts";
import { WS_CHANNELS } from "@thinkrail-pi/contracts";
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
		const welcome = data as { protocolVersion?: number; projects?: Project[] };
		if (typeof welcome.protocolVersion === "number") {
			useAppStore.getState().setWelcome(welcome.protocolVersion);
		}
		if (Array.isArray(welcome.projects)) {
			useAppStore.getState().setProjects(welcome.projects);
		}
	});

	transport.connect();
	return transport;
}

export function getTransport(): WsTransport {
	if (!transport) throw new Error("transport not initialized — call initTransport() first");
	return transport;
}
