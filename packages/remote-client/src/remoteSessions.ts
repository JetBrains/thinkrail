import {
	type RemoteDeviceAccess,
	type RemoteHostRoutes,
	type ServerWelcome,
	type SessionStateRecord,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { isTerminalConnectError, RemoteConnectError } from "./connectError";
import { connectSavedHost, type RemoteConnection } from "./deviceConnector";
import type { DeviceWireClient } from "./deviceWireClient";
import { type SavedHost, withRoutes } from "./hostRegistry";
import { createReconnectLoop, type ReconnectLoop } from "./reconnectLoop";

export interface RemoteSessionItem {
	hostKey: string;
	hostLabel: string;
	record: SessionStateRecord;
}

export interface RemoteSessionsController {
	/**
	 * Connects a saved host and begins tracking its sessions; a second call while one is in flight joins it. A
	 * failure rejects, and unless no retry can fix it the controller keeps retrying in the background
	 * (`onRetryFailed` hears each miss) until it connects. A host disconnected meanwhile resolves quietly.
	 */
	connect(host: SavedHost): Promise<void>;
	/** Every tracked session across all connected hosts (for the mobile session list). */
	items(): RemoteSessionItem[];
	/** The wire client for a connected host — a session screen uses it to stream, send, and approve. */
	clientFor(hostKey: string): DeviceWireClient | null;
	/** The host's `server.welcome` (protocol version, config), once it has arrived. */
	welcomeFor(hostKey: string): ServerWelcome | null;
	/** A host whose channel dropped and is coming back on its own; its client stays, requests wait. */
	isReconnecting(hostKey: string): boolean;
	/** What the computer lets this phone do; `write` until it says otherwise (a host before access modes never does). */
	accessFor(hostKey: string): RemoteDeviceAccess;
	subscribe(listener: () => void): () => void;
	/**
	 * Hears a host whose connection ended for good (the computer revoked this phone, …); the host is already
	 * dropped from the controller, so `clientFor` is null and its sessions are gone.
	 */
	onLost(listener: (hostKey: string, error: RemoteConnectError) => void): () => void;
	/** Hears a retry fail: of a host that never connected, or of a live host whose channel is down. */
	onRetryFailed(listener: (hostKey: string, error: unknown) => void): () => void;
	/** Hears a host send its current routes, already merged into the saved host so it can be stored. */
	onRoutes(listener: (host: SavedHost) => void): () => void;
	/** Retries every host that is down now, skipping the backoff (the app came back, the network changed). */
	reconnectNow(): void;
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
	reconnecting: boolean;
}

type Connector = (host: SavedHost) => Promise<RemoteConnection>;

/**
 * The lightweight mobile core: holds one wire client per paired host and aggregates their live sessions into a
 * single list. A thin viewer/controller — it tracks session state and streams, not the full IDE. The connector
 * is injected (default `connectSavedHost`) so it is unit-tested with fakes.
 */
export function createRemoteSessions(
	connector: Connector = connectSavedHost,
	retry: { initialBackoffMs?: number; maxBackoffMs?: number } = {},
): RemoteSessionsController {
	const hosts = new Map<string, HostEntry>();
	const known = new Map<string, SavedHost>();
	const retries = new Map<string, ReconnectLoop>();
	const opening = new Map<string, Promise<void>>();
	/** Bumped when a host is disconnected, so an attempt begun before it never registers. */
	const epochs = new Map<string, number>();
	const epochOf = (hostKey: string): number => epochs.get(hostKey) ?? 0;
	const listeners = new Set<() => void>();
	const lostListeners = new Set<(hostKey: string, error: RemoteConnectError) => void>();
	const retryListeners = new Set<(hostKey: string, error: unknown) => void>();
	const routeListeners = new Set<(host: SavedHost) => void>();
	const notify = (): void => {
		for (const listener of listeners) listener();
	};
	const lost = (hostKey: string, error: RemoteConnectError): void => {
		for (const listener of lostListeners) listener(hostKey, error);
	};
	const stopRetry = (hostKey: string): void => {
		retries.get(hostKey)?.stop();
		retries.delete(hostKey);
	};

	const forget = (hostKey: string): void => {
		known.delete(hostKey);
		epochs.set(hostKey, epochOf(hostKey) + 1);
		opening.delete(hostKey);
		stopRetry(hostKey);
	};

	const attach = async (hostKey: string): Promise<void> => {
		const host = known.get(hostKey);
		if (!host) throw new Error("host forgotten");
		const epoch = epochOf(hostKey);
		const connection = await connector(host);
		if (epochOf(hostKey) !== epoch) {
			connection.close();
			throw new Error("host forgotten");
		}
		const sessions = new Map<string, SessionStateRecord>();
		const entry: HostEntry = {
			label: host.label,
			connection,
			sessions,
			welcome: null,
			access: "write",
			reconnecting: false,
		};
		hosts.set(hostKey, entry);
		connection.onLost((error) => {
			if (hosts.get(hostKey) !== entry) return;
			hosts.delete(hostKey);
			notify();
			lost(hostKey, error);
		});
		connection.onOpenChange((isOpen) => {
			if (hosts.get(hostKey) !== entry) return;
			entry.reconnecting = !isOpen;
			notify();
		});
		connection.onRetryFailed((error) => {
			if (hosts.get(hostKey) !== entry) return;
			for (const listener of retryListeners) listener(hostKey, error);
		});
		connection.onRoutes((routes: RemoteHostRoutes) => {
			const current = known.get(hostKey);
			if (!current || hosts.get(hostKey) !== entry) return;
			const next = withRoutes(current, routes);
			known.set(hostKey, next);
			for (const listener of routeListeners) listener(next);
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
		if (hosts.get(hostKey) !== entry) return;
		for (const record of initial) sessions.set(record.sessionId, record);
		notify();
	};

	/** One attempt per host at a time: a connect during a background retry joins it instead of racing it. */
	const open = (hostKey: string): Promise<void> => {
		const inFlight = opening.get(hostKey);
		if (inFlight) return inFlight;
		const run = attach(hostKey).finally(() => {
			if (opening.get(hostKey) === run) opening.delete(hostKey);
		});
		opening.set(hostKey, run);
		return run;
	};

	const retryInBackground = (hostKey: string): void => {
		if (retries.has(hostKey)) return;
		const loop = createReconnectLoop({
			attempt: () => open(hostKey),
			isTerminal: (error) => isTerminalConnectError(error) || !known.has(hostKey),
			onLost: (error) => {
				retries.delete(hostKey);
				if (error instanceof RemoteConnectError && known.has(hostKey)) lost(hostKey, error);
			},
			onRetryFailed: (error) => {
				for (const listener of retryListeners) listener(hostKey, error);
			},
			onOpenChange: (isOpen) => {
				if (isOpen) stopRetry(hostKey);
			},
			initialBackoffMs: retry.initialBackoffMs ?? 2_000,
			maxBackoffMs: retry.maxBackoffMs ?? 30_000,
		});
		retries.set(hostKey, loop);
		loop.dropped();
	};

	return {
		async connect(host) {
			if (hosts.has(host.hostKey)) return;
			known.set(host.hostKey, host);
			stopRetry(host.hostKey);
			const epoch = epochOf(host.hostKey);
			try {
				await open(host.hostKey);
			} catch (error) {
				if (epochOf(host.hostKey) !== epoch) return;
				if (!isTerminalConnectError(error)) retryInBackground(host.hostKey);
				throw error;
			}
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
		isReconnecting(hostKey) {
			return hosts.get(hostKey)?.reconnecting ?? false;
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
		onRetryFailed(listener) {
			retryListeners.add(listener);
			return () => void retryListeners.delete(listener);
		},
		onRoutes(listener) {
			routeListeners.add(listener);
			return () => void routeListeners.delete(listener);
		},
		reconnectNow() {
			for (const loop of retries.values()) loop.now();
			for (const entry of hosts.values()) entry.connection.reconnectNow();
		},
		disconnect(hostKey) {
			forget(hostKey);
			const entry = hosts.get(hostKey);
			if (!entry) return;
			entry.connection.close();
			hosts.delete(hostKey);
			notify();
		},
		stop() {
			for (const hostKey of new Set([...known.keys(), ...opening.keys(), ...retries.keys()]))
				forget(hostKey);
			for (const entry of hosts.values()) entry.connection.close();
			hosts.clear();
			listeners.clear();
			lostListeners.clear();
			retryListeners.clear();
			routeListeners.clear();
		},
	};
}
