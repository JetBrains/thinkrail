import type { DeviceWireClient } from "@thinkrail/remote-client";
import { useEffect, useState } from "react";

export type Loaded<T> =
	| { kind: "loading" }
	| { kind: "ready"; value: T }
	| { kind: "failed"; reason: string };

const lastValues = new WeakMap<DeviceWireClient, Map<string, { value: unknown }>>();

const remember = (
	client: DeviceWireClient,
	method: string,
	params: Record<string, unknown>,
	value: unknown,
): void => {
	const values = lastValues.get(client) ?? new Map<string, { value: unknown }>();
	values.set(JSON.stringify({ method, params }), { value });
	lastValues.set(client, values);
};

/** One wire read for a screen. A screen opened again starts from the read's last value for this client and refreshes it in place, so returning never flashes a loader; `reload` changing, or a push on a `refreshOn` channel, re-issues it while the last value stays on screen, so rows keyed by id stay put and only new ones appear. */
export function useHostRequest<T>(
	client: DeviceWireClient | null,
	method: string,
	params: Record<string, unknown>,
	reload = "",
	refreshOn: readonly string[] = [],
): Loaded<T> {
	const key = JSON.stringify({ method, params });
	const [loaded, setLoaded] = useState<Loaded<T>>(() => {
		const cached = client ? lastValues.get(client)?.get(key) : undefined;
		return cached ? { kind: "ready", value: cached.value as T } : { kind: "loading" };
	});
	const [pushes, setPushes] = useState(0);
	const channels = refreshOn.join();
	useEffect(() => {
		if (!client || !channels) return;
		const bump = (): void => setPushes((count) => count + 1);
		const unsubscribes = channels.split(",").map((channel) => client.subscribe(channel, bump));
		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe();
		};
	}, [client, channels]);
	const request = JSON.stringify({ method, params, reload, pushes });

	useEffect(() => {
		if (!client) return;
		let live = true;
		const { method: name, params: body } = JSON.parse(request) as {
			method: string;
			params: Record<string, unknown>;
		};
		client.request<T>(name, body).then(
			(value) => {
				remember(client, name, body, value);
				if (live) setLoaded({ kind: "ready", value });
			},
			(error: unknown) => {
				if (live)
					setLoaded({
						kind: "failed",
						reason: error instanceof Error ? error.message : String(error),
					});
			},
		);
		return () => {
			live = false;
		};
	}, [client, request]);

	return loaded;
}
