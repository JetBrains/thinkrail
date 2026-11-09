import type { RemoteChannel } from "./channel";

export interface WireDispatchContext {
	clientKey: string;
}

/** Handles one wire request, mirroring the host's `handleRequest(method, params, context)`. */
export type WireDispatch = (
	method: string,
	params: unknown,
	context: WireDispatchContext,
) => Promise<unknown>;

export interface RemoteWireBridgeDeps {
	clientKey: string;
	dispatch: WireDispatch;
	errorCodeOf?: (error: unknown) => string | undefined;
	onError?: (error: unknown, method: string) => void;
}

export interface RemoteWireBridge {
	/** Fans a channel push out to the remote client, framed exactly as the host's WS pushes. */
	push(channel: string, data: unknown): void;
	close(): void;
}

/**
 * Runs the host wire protocol over a `RemoteChannel`: decodes request frames, dispatches them through the
 * injected `dispatch` (the host's `handleRequest`), and replies with the same `{ id, ok, result | error }`
 * framing the WS uses; `push` forwards `{ channel, data }` events. Replay/ack is intentionally omitted — the
 * WebRTC channel has no mid-stream reconnect to replay for.
 */
export function bridgeRemoteWire(
	channel: RemoteChannel,
	deps: RemoteWireBridgeDeps,
): RemoteWireBridge {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const send = (value: unknown): void => channel.send(encoder.encode(JSON.stringify(value)));

	const handle = async (bytes: Uint8Array): Promise<void> => {
		let request: unknown;
		try {
			request = JSON.parse(decoder.decode(bytes));
		} catch {
			return;
		}
		if (typeof request !== "object" || request === null) return;
		const frame = request as Record<string, unknown>;
		if (typeof frame.id !== "string" || typeof frame.method !== "string") return;
		const id = frame.id;
		const method = frame.method;
		try {
			const result = await deps.dispatch(method, frame.params, { clientKey: deps.clientKey });
			send({ id, ok: true, result });
		} catch (error) {
			deps.onError?.(error, method);
			const code = deps.errorCodeOf?.(error);
			send({
				id,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				...(code ? { errorCode: code } : {}),
			});
		}
	};

	channel.onMessage((bytes) => void handle(bytes));

	return {
		push(channelName, data) {
			send({ channel: channelName, data });
		},
		close() {
			channel.close();
		},
	};
}
