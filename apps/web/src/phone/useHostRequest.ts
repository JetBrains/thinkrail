import type { DeviceWireClient } from "@thinkrail/remote-client";
import { useCallback, useEffect, useState } from "react";
import { reasonOf } from "./async";

export type Loaded<T> =
	| { kind: "loading" }
	| { kind: "ready"; value: T }
	| { kind: "failed"; reason: string; retry?: () => void };

const lastValues = new WeakMap<DeviceWireClient, Map<string, { value: unknown }>>();

const remember = (client: DeviceWireClient, key: string, value: unknown): void => {
	const values = lastValues.get(client) ?? new Map<string, { value: unknown }>();
	values.set(key, { value });
	lastValues.set(client, values);
};

const cachedFor = (client: DeviceWireClient | null, key: string) =>
	client ? lastValues.get(client)?.get(key) : undefined;

/** A reply, with the client, read (`key`) and issue of it (`request`) it answered. */
export interface Settled<T> {
	client: DeviceWireClient | null;
	key: string;
	request: string;
	loaded: Loaded<T>;
}

/**
 * What a read shows: the last reply while it answered this client and read (a refresh keeps it on screen),
 * else the read's cached value or a loader — never another read's rows; a failure being retried loads again.
 */
export function shownLoaded<T>(
	settled: Settled<T> | null,
	client: DeviceWireClient | null,
	key: string,
	request: string,
	cached: { value: unknown } | undefined,
): Loaded<T> {
	if (!settled || settled.client !== client || settled.key !== key)
		return cached ? { kind: "ready", value: cached.value as T } : { kind: "loading" };
	if (settled.loaded.kind === "failed" && settled.request !== request) return { kind: "loading" };
	return settled.loaded;
}

/** The project a workspace push is about (a workspace, or a removed one's `{ projectId, id }`); undefined for any other payload. */
export function pushedProjectId(data: unknown): string | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const projectId = Reflect.get(data, "projectId");
	return typeof projectId === "string" ? projectId : undefined;
}

/** One wire read for a screen. A screen opened again starts from the read's last value for this client and refreshes it in place, so returning never flashes a loader; `reload` changing, or a push on a `refreshOn` channel that `refreshIf` accepts, re-issues it while the last value stays on screen, so rows keyed by id stay put and only new ones appear. A different client or params start from that read's own last value or a loader; a failure carries `retry`. */
export function useHostRequest<T>(
	client: DeviceWireClient | null,
	method: string,
	params: Record<string, unknown>,
	reload = "",
	refreshOn: readonly string[] = [],
	refreshIf?: (data: unknown) => boolean,
): Loaded<T> {
	const key = JSON.stringify({ method, params });
	const [settled, setSettled] = useState<Settled<T> | null>(null);
	const [pushes, setPushes] = useState(0);
	const [retries, setRetries] = useState(0);
	const retry = useCallback(() => setRetries((count) => count + 1), []);
	const channels = refreshOn.join();
	useEffect(() => {
		if (!client || !channels) return;
		const bump = (data: unknown): void => {
			if (!refreshIf || refreshIf(data)) setPushes((count) => count + 1);
		};
		const unsubscribes = channels.split(",").map((channel) => client.subscribe(channel, bump));
		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe();
		};
	}, [client, channels, refreshIf]);
	const request = `${reload}\n${pushes}\n${retries}`;

	useEffect(() => {
		if (!client) return;
		let live = true;
		const read = JSON.parse(key) as { method: string; params: Record<string, unknown> };
		client.request<T>(read.method, read.params).then(
			(value) => {
				remember(client, key, value);
				if (live) setSettled({ client, key, request, loaded: { kind: "ready", value } });
			},
			(error: unknown) => {
				if (live)
					setSettled({
						client,
						key,
						request,
						loaded: { kind: "failed", reason: reasonOf(error) },
					});
			},
		);
		return () => {
			live = false;
		};
	}, [client, key, request]);

	const shown = shownLoaded<T>(settled, client, key, request, cachedFor(client, key));
	return shown.kind === "failed" ? { ...shown, retry } : shown;
}
