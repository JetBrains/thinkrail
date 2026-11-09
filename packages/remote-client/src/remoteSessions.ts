import {
	type RemoteDeviceAccess,
	type ServerWelcome,
	type SessionStateRecord,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import type { RemoteConnectError } from "./connectError";
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
	/** The host's `server.welcome` (protocol version, config), once it has arrived. */
	welcomeFor(hostKey: string): ServerWelcome | null;
	/** What the computer lets this phone do; `write` until it says otherwise (a host before access modes never does). */
	accessFor(hostKey: string): RemoteDeviceAccess;
	subscribe(listener: () => void): () => void;
	/**
	 * Hears a host whose connection ended for good (the computer revoked this phone, …); the host is already
	 * dropped from the controller, so `clientFor` is null and its sessions are gone.
	 */
	onLost(listener: (hostKey: string, error: RemoteConnectError) => void): () => void;
	/** Closes one host's connection and drops its sessions (the phone forgot that computer). */
	disconnect(hostKey: string): void;
	stop(): void;
}

interface HostEntry {
	label: string;
	connection: RemoteConnection;
	sessions: Map<string, SessionStateRecord>;
	welcome: ServerWelcome | null;
	access: RemoteDeviceAccess;
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
	const lostListeners = new Set<(hostKey: string, error: RemoteConnectError) => void>();
	const notify = (): void => {
		for (const listener of listeners) listener();
	};

	return {
		async connect(host) {
			if (hosts.has(host.hostKey)) return;
			const connection = await connector(host);
			const sessions = new Map<string, SessionStateRecord>();
			const entry: HostEntry = {
				label: host.label,
				connection,
				sessions,
				welcome: null,
				access: "write",
			};
			hosts.set(host.hostKey, entry);
			connection.onLost((error) => {
				if (hosts.get(host.hostKey) !== entry) return;
				hosts.delete(host.hostKey);
				notify();
				for (const listener of lostListeners) listener(host.hostKey, error);
			});

			connection.client.subscribe(WS_CHANNELS.serverWelcome, (data) => {
				entry.welcome = data as ServerWelcome;
				notify();
			});
			connection.client.subscribe(WS_CHANNELS.remoteDeviceAccess, (data) => {
				const access = (data as { access?: unknown }).access;
				entry.access = access === "read" ? "read" : "write";
				notify();
			});
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
		welcomeFor(hostKey) {
			return hosts.get(hostKey)?.welcome ?? null;
		},
		accessFor(hostKey) {
			return hosts.get(hostKey)?.access ?? "write";
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		onLost(listener) {
			lostListeners.add(listener);
			return () => void lostListeners.delete(listener);
		},
		disconnect(hostKey) {
			const entry = hosts.get(hostKey);
			if (!entry) return;
			entry.connection.close();
			hosts.delete(hostKey);
			notify();
		},
		stop() {
			for (const entry of hosts.values()) entry.connection.close();
			hosts.clear();
			listeners.clear();
			lostListeners.clear();
		},
	};
}
