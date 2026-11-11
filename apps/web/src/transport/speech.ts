import { PROTOCOL_VERSION, SPEECH_SOCKET_ROUTE } from "@thinkrail/contracts";
import { getTransport } from "./wireTransport";

export function openSpeechSocket(): WebSocket {
	const url = new URL(`${getTransport().httpBase()}${SPEECH_SOCKET_ROUTE}`);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("protocol", String(PROTOCOL_VERSION));
	return new WebSocket(url);
}
