import { WS_CHANNELS } from "@thinkrail/contracts";
import type { DeviceChannel } from "./deviceChannel";

/** Snapshot pushes: the host sends them once when a channel opens, so a later subscriber gets the last one. */
const STICKY_CHANNELS: ReadonlySet<string> = new Set([
	WS_CHANNELS.serverWelcome,
	WS_CHANNELS.remoteHostRoutes,
]);

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
	/** Lets go of a channel whose peer died without closing it; requests wait for the next `attach`. */
	detach(): void;
	/** True while a channel is attached. */
	readonly open: boolean;
	/** Hears a channel attach (`true`) and go away until the next one (`false`); not `close`. */
	onOpenChange(listener: (open: boolean) => void): () => void;
	/**
	 * Issues a wire request; resolves with the host's result (or rejects on error). Survives a reconnect. An
	 * aborted `signal` rejects it with the signal's reason and forgets it, so it is never replayed.
	 */
	request<T = unknown>(
		method: string,
		params?: unknown,
		options?: { signal?: AbortSignal },
	): Promise<T>;
	/** Subscribes to a host push channel; returns an unsubscribe function. Persists across reconnects; a snapshot channel (`server.welcome`) replays its last value at once. */
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
 * channel, it sends `resume` with the ids still waiting and replays them, and subscriptions persist. Ids are
 * unique per client, so the host's replay cache answers a re-sent request from its first run instead of running
 * it twice; the responses read are `ack`ed, batched once per microtask, so the host can drop them. Only
 * `close` rejects outstanding work, or a request's own aborted signal that one. Responses are matched by id;
 * `{ channel, data }` pushes fan to subscribers; a snapshot push (`server.welcome`) is also kept and replayed
 * to a subscriber that arrives after it.
 */
export function createDeviceWireClient(): DeviceWireClient {
	let channel: DeviceChannel | null = null;
	const instance = crypto.randomUUID();
	let nextId = 0;
	let closed = false;
	const pending = new Map<string, Pending>();
	const subscribers = new Map<string, Set<(data: unknown) => void>>();
	const sticky = new Map<string, unknown>();
	const openListeners = new Set<(open: boolean) => void>();
	const announce = (open: boolean): void => {
		for (const listener of openListeners) listener(open);
	};
	const release = (): void => {
		if (channel === null) return;
		channel = null;
		if (!closed) announce(false);
	};
	let acks: string[] = [];
	const ack = (id: string): void => {
		acks.push(id);
		if (acks.length > 1) return;
		queueMicrotask(() => {
			const ids = acks;
			acks = [];
			if (channel?.open) channel.send(JSON.stringify({ ack: ids }));
		});
	};

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
			ack(frame.id);
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
			if (STICKY_CHANNELS.has(frame.channel)) sticky.set(frame.channel, frame.data);
			for (const handler of subscribers.get(frame.channel) ?? []) handler(frame.data);
		}
	};

	return {
		attach(next) {
			if (closed) return;
			const wasOpen = channel !== null;
			channel = next;
			next.onMessage(onMessage);
			next.onClose(() => {
				if (channel === next) release();
			});
			next.send(JSON.stringify({ resume: [...pending.keys()] }));
			for (const entry of pending.values()) next.send(entry.frame);
			if (!wasOpen) announce(true);
		},
		detach: release,
		get open() {
			return channel !== null;
		},
		onOpenChange(listener) {
			openListeners.add(listener);
			return () => void openListeners.delete(listener);
		},
		request(method, params, options = {}) {
			const { signal } = options;
			const id = `${instance}:${++nextId}`;
			const frame = JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) });
			return new Promise((resolve, reject) => {
				if (closed) {
					reject(new RemoteRequestError("remote session closed"));
					return;
				}
				if (signal?.aborted) {
					reject(signal.reason);
					return;
				}
				const forget = (): void => {
					if (!pending.delete(id)) return;
					if (channel?.open) ack(id);
					reject(signal?.reason);
				};
				signal?.addEventListener("abort", forget, { once: true });
				const settle =
					<V>(done: (value: V) => void) =>
					(value: V): void => {
						signal?.removeEventListener("abort", forget);
						done(value);
					};
				pending.set(id, {
					frame,
					resolve: settle(resolve as (value: unknown) => void),
					reject: settle(reject),
				});
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
			if (sticky.has(channelName)) handler(sticky.get(channelName));
			return () => void set?.delete(handler);
		},
		close() {
			closed = true;
			for (const entry of pending.values())
				entry.reject(new RemoteRequestError("remote session closed"));
			pending.clear();
			openListeners.clear();
			channel?.close();
			channel = null;
		},
	};
}
