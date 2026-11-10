import type { ServerWebSocket } from "bun";

interface TestFilter {
	kinds?: number[];
	"#p"?: string[];
	since?: number;
}

interface TestEvent {
	id: string;
	kind: number;
	created_at: number;
	tags: string[][];
}

export interface TestNostrRelay {
	readonly url: string;
	/** Events the relay has forwarded, for assertions. */
	readonly forwarded: number;
	stop(): void;
}

function matches(filter: TestFilter, event: TestEvent): boolean {
	if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
	if (filter.since !== undefined && event.created_at < filter.since) return false;
	const wanted = filter["#p"];
	if (wanted && !event.tags.some((tag) => tag[0] === "p" && wanted.includes(tag[1] ?? ""))) {
		return false;
	}
	return true;
}

/**
 * A minimal in-process NIP-01 relay for tests: it forwards events to matching subscriptions and stores
 * nothing, the way a public relay treats ephemeral kinds. Signatures are checked by the receiving pool.
 */
export function startTestNostrRelay(): TestNostrRelay {
	type Data = { subs: Map<string, TestFilter> };
	const sockets = new Set<ServerWebSocket<Data>>();
	let forwarded = 0;
	const server = Bun.serve<Data>({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request, srv) {
			if (srv.upgrade(request, { data: { subs: new Map() } })) return undefined;
			return new Response("nostr test relay");
		},
		websocket: {
			open(ws) {
				sockets.add(ws);
			},
			close(ws) {
				sockets.delete(ws);
			},
			message(ws, raw) {
				let message: unknown[];
				try {
					message = JSON.parse(String(raw)) as unknown[];
				} catch {
					return;
				}
				const [type, ...rest] = message;
				if (type === "REQ") {
					const [id, ...filters] = rest as [string, ...TestFilter[]];
					ws.data.subs.set(id, filters[0] ?? {});
					ws.send(JSON.stringify(["EOSE", id]));
				} else if (type === "CLOSE") {
					ws.data.subs.delete(rest[0] as string);
				} else if (type === "EVENT") {
					const event = rest[0] as TestEvent;
					ws.send(JSON.stringify(["OK", event.id, true, ""]));
					for (const socket of sockets) {
						for (const [id, filter] of socket.data.subs) {
							if (matches(filter, event)) {
								forwarded += 1;
								socket.send(JSON.stringify(["EVENT", id, event]));
							}
						}
					}
				}
			},
		},
	});
	return {
		url: `ws://127.0.0.1:${server.port}`,
		get forwarded() {
			return forwarded;
		},
		stop() {
			for (const socket of sockets) socket.close();
			server.stop(true);
		},
	};
}
