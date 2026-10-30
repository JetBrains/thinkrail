import type { DeviceChannel } from "./deviceChannel";

export class RemoteRequestError extends Error {
	readonly code: string | undefined;
	constructor(message: string, code?: string) {
		super(message);
		this.name = "RemoteRequestError";
		this.code = code;
	}
}

export interface DeviceWireClient {
	/** Issues a wire request over the channel and resolves with the host's result (or rejects on error). */
	request<T = unknown>(method: string, params?: unknown): Promise<T>;
	/** Subscribes to a host push channel; returns an unsubscribe function. */
	subscribe(channel: string, handler: (data: unknown) => void): () => void;
	close(): void;
}

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
}

/**
 * The device side of the wire protocol, mirroring the host's `remoteWireBridge`: it sends `{ id, method,
 * params }` requests over the channel, matches `{ id, ok, result | error }` replies by id, and fans
 * `{ channel, data }` pushes to subscribers. Transport-agnostic over `DeviceChannel`, so it is unit-tested
 * with an in-memory channel; the real channel is a WebRTC DataChannel.
 */
export function createDeviceWireClient(channel: DeviceChannel): DeviceWireClient {
	let nextId = 0;
	const pending = new Map<string, Pending>();
	const subscribers = new Map<string, Set<(data: unknown) => void>>();

	channel.onMessage((raw) => {
		let message: unknown;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		if (typeof message !== "object" || message === null) return;
		const frame = message as Record<string, unknown>;
		if (typeof frame.id === "string") {
			const entry = pending.get(frame.id);
			if (!entry) return;
			pending.delete(frame.id);
			if (frame.ok === true) entry.resolve(frame.result);
			else {
				const error = typeof frame.error === "string" ? frame.error : "remote request failed";
				entry.reject(
					new RemoteRequestError(
						error,
						typeof frame.errorCode === "string" ? frame.errorCode : undefined,
					),
				);
			}
		} else if (typeof frame.channel === "string") {
			for (const handler of subscribers.get(frame.channel) ?? []) handler(frame.data);
		}
	});

	channel.onClose(() => {
		for (const entry of pending.values())
			entry.reject(new RemoteRequestError("remote channel closed"));
		pending.clear();
	});

	return {
		request(method, params) {
			const id = `d${++nextId}`;
			return new Promise((resolve, reject) => {
				pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
				channel.send(JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) }));
			});
		},
		subscribe(channelName, handler) {
			let set = subscribers.get(channelName);
			if (!set) {
				set = new Set();
				subscribers.set(channelName, set);
			}
			set.add(handler);
			return () => {
				set?.delete(handler);
			};
		},
		close() {
			channel.close();
		},
	};
}
