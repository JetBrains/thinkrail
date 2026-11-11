import { INSTANCE_TOKEN_PARAM, PROTOCOL_VERSION, SPEECH_SOCKET_ROUTE } from "@thinkrail/contracts";
import { instanceToken } from "./instanceToken";
import { getTransport } from "./wireTransport";

export function openSpeechSocket(): WebSocket {
	const url = new URL(`${getTransport().httpBase()}${SPEECH_SOCKET_ROUTE}`);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("protocol", String(PROTOCOL_VERSION));
	const token = instanceToken();
	if (token !== null) url.searchParams.set(INSTANCE_TOKEN_PARAM, token);
	return new WebSocket(url);
}
