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
	/** Points the client at a (new) channel and replays any in-flight requests onto it. */
	attach(channel: DeviceChannel): void;
	/** Issues a wire request; resolves with the host's result (or rejects on error). Survives a reconnect. */
	request<T = unknown>(method: string, params?: unknown): Promise<T>;
	/** Subscribes to a host push channel; returns an unsubscribe function. Persists across reconnects. */
	subscribe(channel: string, handler: (data: unknown) => void): () => void;
	close(): void;
}

interface Pending {
	frame: string;
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
}

/**
 * The device side of the wire protocol, mirroring the host's `remoteWireBridge`. It is channel-agnostic and
 * reconnect-safe: a dropped WebRTC channel does not fail in-flight requests — when `attach` installs a fresh
 * channel (after re-pairing), every pending request is replayed onto it, and subscriptions persist. Only
 * `close` rejects outstanding work. Responses are matched by id; `{ channel, data }` pushes fan to subscribers.
 */
export function createDeviceWireClient(): DeviceWireClient {
	let channel: DeviceChannel | null = null;
	let nextId = 0;
	let closed = false;
	const pending = new Map<string, Pending>();
	const subscribers = new Map<string, Set<(data: unknown) => void>>();

	const onMessage = (raw: string): void => {
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
	};

	return {
		attach(next) {
			if (closed) return;
			channel = next;
			next.onMessage(onMessage);
			next.onClose(() => {
				if (channel === next) channel = null; // pending wait for the next attach
			});
			for (const entry of pending.values()) next.send(entry.frame); // replay in-flight requests
		},
		request(method, params) {
			const id = `d${++nextId}`;
			const frame = JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) });
			return new Promise((resolve, reject) => {
				if (closed) {
					reject(new RemoteRequestError("remote session closed"));
					return;
				}
				pending.set(id, { frame, resolve: resolve as (value: unknown) => void, reject });
				if (channel?.open) channel.send(frame);
			});
		},
		subscribe(channelName, handler) {
			let set = subscribers.get(channelName);
			if (!set) {
				set = new Set();
				subscribers.set(channelName, set);
			}
			set.add(handler);
			return () => void set?.delete(handler);
		},
		close() {
			closed = true;
			for (const entry of pending.values())
				entry.reject(new RemoteRequestError("remote session closed"));
			pending.clear();
			channel?.close();
			channel = null;
		},
	};
}
