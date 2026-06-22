import { WS_CHANNELS } from "@thinkrail-pi/contracts";
import { useAppStore } from "./store/appStore";
import { WsTransport } from "./transport";

let transport: WsTransport | null = null;

/** Create the singleton transport, route pushes into the store, and connect. */
export function initTransport(): WsTransport {
	if (transport) return transport;

	transport = new WsTransport({
		onStatus: (status) => useAppStore.getState().setStatus(status),
	});

	transport.subscribe(WS_CHANNELS.serverWelcome, (data) => {
		const welcome = data as { protocolVersion?: number };
		if (typeof welcome.protocolVersion === "number") {
			useAppStore.getState().setWelcome(welcome.protocolVersion);
		}
	});

	transport.connect();
	return transport;
}
