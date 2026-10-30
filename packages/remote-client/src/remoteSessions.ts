import { type SessionStateRecord, WS_CHANNELS } from "@thinkrail/contracts";
import { connectSavedHost, type RemoteConnection } from "./deviceConnector";
import type { DeviceWireClient } from "./deviceWireClient";
import type { SavedHost } from "./hostRegistry";

export interface RemoteSessionItem {
	hostKey: string;
	hostLabel: string;
	record: SessionStateRecord;
}

export interface RemoteSessionsController {
	/** Connects a saved host and begins tracking its sessions. */
	connect(host: SavedHost): Promise<void>;
	/** Every tracked session across all connected hosts (for the mobile session list). */
	items(): RemoteSessionItem[];
	/** The wire client for a connected host — a session screen uses it to stream, send, and approve. */
	clientFor(hostKey: string): DeviceWireClient | null;
	subscribe(listener: () => void): () => void;
	stop(): void;
}

interface HostEntry {
	label: string;
	connection: RemoteConnection;
	sessions: Map<string, SessionStateRecord>;
}

type Connector = (host: SavedHost) => Promise<RemoteConnection>;

/**
 * The lightweight mobile core: holds one wire client per paired host and aggregates their live sessions into a
 * single list. A thin viewer/controller — it tracks session state and streams, not the full IDE. The connector
 * is injected (default `connectSavedHost`) so it is unit-tested with fakes.
 */
export function createRemoteSessions(
	connector: Connector = connectSavedHost,
): RemoteSessionsController {
	const hosts = new Map<string, HostEntry>();
	const listeners = new Set<() => void>();
	const notify = (): void => {
		for (const listener of listeners) listener();
	};

	return {
		async connect(host) {
			if (hosts.has(host.hostKey)) return;
			const connection = await connector(host);
			const sessions = new Map<string, SessionStateRecord>();
			const entry: HostEntry = { label: host.label, connection, sessions };
			hosts.set(host.hostKey, entry);

			connection.client.subscribe(WS_CHANNELS.sessionState, (data) => {
				const record = data as SessionStateRecord;
				sessions.set(record.sessionId, record);
				notify();
			});
			const initial = await connection.client
				.request<SessionStateRecord[]>("session.stateList", {})
				.catch(() => [] as SessionStateRecord[]);
			for (const record of initial) sessions.set(record.sessionId, record);
			notify();
		},
		items() {
			const all: RemoteSessionItem[] = [];
			for (const [hostKey, entry] of hosts) {
				for (const record of entry.sessions.values()) {
					all.push({ hostKey, hostLabel: entry.label, record });
				}
			}
			return all;
		},
		clientFor(hostKey) {
			return hosts.get(hostKey)?.connection.client ?? null;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		stop() {
			for (const entry of hosts.values()) entry.connection.close();
			hosts.clear();
			listeners.clear();
		},
	};
}
