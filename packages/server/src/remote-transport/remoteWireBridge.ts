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

/**
 * The host's request de-duplication for one client, the same the WS path uses: a request id seen again with
 * the same method and params gets the first run's response instead of running twice.
 */
export interface RemoteWireReplay {
	run(id: string, method: string, params: unknown, execute: () => Promise<string>): Promise<string>;
	/** Responses the device has read, so the host may drop them. */
	acknowledge(ids: readonly string[]): void;
	/** On reattach, the ids the device still waits for; every other retained response is dropped. */
	retain(ids: readonly string[]): void;
}

export interface RemoteWireBridgeDeps {
	clientKey: string;
	dispatch: WireDispatch;
	errorCodeOf?: (error: unknown) => string | undefined;
	onError?: (error: unknown, method: string) => void;
	replay?: RemoteWireReplay;
}

export interface RemoteWireBridge {
	/** Fans a channel push out to the remote client, framed exactly as the host's WS pushes. */
	push(channel: string, data: unknown): void;
	/** Sends a push already framed as `{ channel, data }` JSON, as the host's broadcasts are. */
	pushFramed(json: string): void;
	close(): void;
}

/**
 * Runs the host wire protocol over a `RemoteChannel`: decodes request frames, dispatches them through the
 * injected `dispatch` (the host's `handleRequest`), and replies with the same `{ id, ok, result | error }`
 * framing the WS uses; `push` forwards `{ channel, data }` events. With `replay`, a device's `ack` and `resume`
 * frames reach it, and once the device sent `resume` (it acks, so its responses do not pile up) every request
 * runs through it, so a request re-sent after a reconnect never runs twice. An older app that never sends
 * `resume` is served without it.
 */
export function bridgeRemoteWire(
	channel: RemoteChannel,
	deps: RemoteWireBridgeDeps,
): RemoteWireBridge {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const sendRaw = (json: string): void => channel.send(encoder.encode(json));
	const send = (value: unknown): void => sendRaw(JSON.stringify(value));
	const ids = (value: unknown): string[] =>
		Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

	const failure = (id: string, method: string, error: unknown): string => {
		deps.onError?.(error, method);
		const code = deps.errorCodeOf?.(error);
		return JSON.stringify({
			id,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			...(code ? { errorCode: code } : {}),
		});
	};
	const respond = async (id: string, method: string, params: unknown): Promise<string> => {
		try {
			const result = await deps.dispatch(method, params, { clientKey: deps.clientKey });
			return JSON.stringify({ id, ok: true, result });
		} catch (error) {
			return failure(id, method, error);
		}
	};

	let replaying = false;
	const handle = async (bytes: Uint8Array): Promise<void> => {
		let request: unknown;
		try {
			request = JSON.parse(decoder.decode(bytes));
		} catch {
			return;
		}
		if (typeof request !== "object" || request === null) return;
		const frame = request as Record<string, unknown>;
		if ("ack" in frame) return void deps.replay?.acknowledge(ids(frame.ack));
		if ("resume" in frame) {
			replaying = deps.replay !== undefined;
			return void deps.replay?.retain(ids(frame.resume));
		}
		if (typeof frame.id !== "string" || typeof frame.method !== "string") return;
		const id = frame.id;
		const method = frame.method;
		const execute = () => respond(id, method, frame.params);
		try {
			sendRaw(
				await (replaying && deps.replay
					? deps.replay.run(id, method, frame.params, execute)
					: execute()),
			);
		} catch (error) {
			sendRaw(failure(id, method, error));
		}
	};

	channel.onMessage((bytes) => void handle(bytes));

	return {
		push(channelName, data) {
			send({ channel: channelName, data });
		},
		pushFramed: sendRaw,
		close() {
			channel.close();
		},
	};
}
