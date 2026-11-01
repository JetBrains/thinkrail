import type { DeviceWireClient } from "@thinkrail/remote-client";
import { useEffect, useState } from "react";

export type Loaded<T> =
	| { kind: "loading" }
	| { kind: "ready"; value: T }
	| { kind: "failed"; reason: string };

/** One wire read for a screen; `reload` changing re-issues it while the last value stays on screen. */
export function useHostRequest<T>(
	client: DeviceWireClient | null,
	method: string,
	params: Record<string, unknown>,
	reload = "",
): Loaded<T> {
	const [loaded, setLoaded] = useState<Loaded<T>>({ kind: "loading" });
	const request = JSON.stringify({ method, params, reload });

	useEffect(() => {
		if (!client) return;
		let live = true;
		const { method: name, params: body } = JSON.parse(request) as {
			method: string;
			params: Record<string, unknown>;
		};
		client.request<T>(name, body).then(
			(value) => {
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
