import {
	type RemoteDeviceAccess,
	type ServerWelcome,
	type SessionStateRecord,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import type { RemoteConnectError } from "./connectError";
import {
	type ConnectionEvents,
	connectRemoteProject,
	connectSavedHost,
	type RemoteConnection,
} from "./deviceConnector";
import type { DeviceWireClient } from "./deviceWireClient";
import { type SavedHost, withRoutes } from "./hostRegistry";

export interface RemoteSessionItem {
	hostKey: string;
	hostLabel: string;
	record: SessionStateRecord;
}

/**
 * Where a host's connection stands: open, on its way (the first attempt, a dropped channel coming back, a retry
 * just asked for), or down with the last attempt's failure — a passing one still being retried, or the refusal
 * that ended it for good.
 */
export type HostConnectionStatus =
	| { kind: "connected" }
	| { kind: "connecting" }
	| { kind: "unreachable"; error: unknown };

/** Everything the controller tracks, as one immutable value: a new one after every change it notifies. */
export interface RemoteSessionsSnapshot {
	/** Every tracked session across all connected hosts. */
	items: RemoteSessionItem[];
	/** Each host's connection status; the same map until a status changes. A host never connected has none. */
	statuses: ReadonlyMap<string, HostConnectionStatus>;
	/** The wire client of each host that has been open. */
	clients: ReadonlyMap<string, DeviceWireClient>;
	/** What each tracked computer lets this phone do. */
	access: ReadonlyMap<string, RemoteDeviceAccess>;
}

export interface RemoteSessionsController {
	/**
	 * Starts connecting a saved host and tracking its sessions; its connection retries on its own until it opens
	 * or is refused for good. For a host already tracked it retries now, and one whose channel is down reads
	 * `connecting` again until that attempt lands or fails.
	 */
	connect(host: SavedHost): void;
	/**
	 * Pairs a computer by its `thinkrail://pair` link and tracks the connection that paired it, so pairing is one
	 * handshake. Resolves with the host to save; rejects when the link or that first attempt fails.
	 */
	pair(link: string, options: { label: string }): Promise<SavedHost>;
	/** The tracked state for a renderer (`useSyncExternalStore`); the same value until the next notify. */
	snapshot(): RemoteSessionsSnapshot;
	/** The wire client of a host that has been open — a session screen uses it to stream, send, and approve. */
	clientFor(hostKey: string): DeviceWireClient | null;
	/** The host's `server.welcome` (protocol version, config), once it has arrived. */
	welcomeFor(hostKey: string): ServerWelcome | null;
	/** What the computer lets this phone do; `write` until it says otherwise (a host before access modes never does). */
	accessFor(hostKey: string): RemoteDeviceAccess;
	subscribe(listener: () => void): () => void;
	/**
	 * Hears a host whose connection ended for good (the computer revoked this phone, …); the host is already
	 * dropped, so `clientFor` is null, its sessions are gone and its status holds the refusal.
	 */
	onLost(listener: (hostKey: string, error: RemoteConnectError) => void): () => void;
	/** Hears a host send its current routes, already merged into the saved host so it can be stored. */
	onRoutes(listener: (host: SavedHost) => void): () => void;
	/** Retries every host that is down now, skipping the backoff (the app came back, the network changed). */
	reconnectNow(): void;
	/** Closes one host's connection and drops its sessions and status (the phone forgot that computer). */
	disconnect(hostKey: string): void;
	stop(): void;
}

interface HostEntry {
	host: SavedHost;
	connection: RemoteConnection;
	/** Opened at least once: until then there is no client to hand out, its requests would only wait. */
	opened: boolean;
	open: boolean;
	sessions: Map<string, SessionStateRecord>;
	welcome: ServerWelcome | null;
	access: RemoteDeviceAccess;
}

type SavedConnector = (host: SavedHost, events: ConnectionEvents) => RemoteConnection;
type Pairer = (
	link: string,
	options: { label: string } & ConnectionEvents,
) => Promise<RemoteConnection>;

const CONNECTED: HostConnectionStatus = { kind: "connected" };
const CONNECTING: HostConnectionStatus = { kind: "connecting" };

/**
 * The lightweight mobile core: holds one connection per paired host, aggregates their live sessions into a
 * single list and tracks how each connection stands. A thin viewer/controller — it tracks session state and
 * streams, not the full IDE. The connectors are injected (default `connectSavedHost` / `connectRemoteProject`)
 * so it is unit-tested with fakes.
 */
export function createRemoteSessions(
	deps: { connect?: SavedConnector; pair?: Pairer } = {},
): RemoteSessionsController {
	const connector = deps.connect ?? connectSavedHost;
	const pairer = deps.pair ?? connectRemoteProject;
	const hosts = new Map<string, HostEntry>();
	let statuses: ReadonlyMap<string, HostConnectionStatus> = new Map();
	let snapshot: RemoteSessionsSnapshot | null = null;
	/** Bumped by `stop`, so a pairing that lands after it is closed instead of tracked. */
	let generation = 0;
	const listeners = new Set<() => void>();
	const lostListeners = new Set<(hostKey: string, error: RemoteConnectError) => void>();
	const routeListeners = new Set<(host: SavedHost) => void>();
	const notify = (): void => {
		snapshot = null;
		for (const listener of listeners) listener();
	};
	const setStatus = (hostKey: string, status: HostConnectionStatus | null): void => {
		if ((statuses.get(hostKey) ?? null) === status) return;
		const next = new Map(statuses);
		if (status) next.set(hostKey, status);
		else next.delete(hostKey);
		statuses = next;
	};
	const isLive = (entry: HostEntry | undefined): entry is HostEntry =>
		entry !== undefined && hosts.get(entry.host.hostKey) === entry;

	const seed = (entry: HostEntry): void => {
		void entry.connection.client
			.request<SessionStateRecord[]>("session.stateList", {})
			.catch(() => [] as SessionStateRecord[])
			.then((initial) => {
				if (!isLive(entry)) return;
				for (const record of initial) entry.sessions.set(record.sessionId, record);
				notify();
			});
	};

	/** The connection's reports, bound to the entry it will belong to; one that is no longer tracked is ignored. */
	const eventsFor = (entryOf: () => HostEntry | undefined): ConnectionEvents => ({
		onOpenChange: (open) => {
			const entry = entryOf();
			if (!isLive(entry)) return;
			entry.open = open;
			setStatus(entry.host.hostKey, open ? CONNECTED : CONNECTING);
			if (open && !entry.opened) {
				entry.opened = true;
				seed(entry);
			}
			notify();
		},
		onRetryFailed: (error) => {
			const entry = entryOf();
			if (!isLive(entry)) return;
			setStatus(entry.host.hostKey, { kind: "unreachable", error });
			notify();
		},
		onLost: (error) => {
			const entry = entryOf();
			if (!isLive(entry)) return;
			const { hostKey } = entry.host;
			hosts.delete(hostKey);
			setStatus(hostKey, { kind: "unreachable", error });
			notify();
			for (const listener of lostListeners) listener(hostKey, error);
		},
		onRoutes: (routes) => {
			const entry = entryOf();
			if (!isLive(entry)) return;
			entry.host = withRoutes(entry.host, routes);
			for (const listener of routeListeners) listener(entry.host);
		},
	});

	const track = (host: SavedHost, connection: RemoteConnection, open: boolean): HostEntry => {
		const entry: HostEntry = {
			host,
			connection,
			opened: open,
			open,
			sessions: new Map(),
			welcome: null,
			access: "write",
		};
		hosts.set(host.hostKey, entry);
		setStatus(host.hostKey, open ? CONNECTED : CONNECTING);
		const { client } = connection;
		client.subscribe(WS_CHANNELS.serverWelcome, (data) => {
			entry.welcome = data as ServerWelcome;
			notify();
		});
		client.subscribe(WS_CHANNELS.remoteDeviceAccess, (data) => {
			const access = (data as { access?: unknown }).access;
			entry.access = access === "read" ? "read" : "write";
			notify();
		});
		client.subscribe(WS_CHANNELS.sessionState, (data) => {
			const record = data as SessionStateRecord;
			entry.sessions.set(record.sessionId, record);
			notify();
		});
		if (open) seed(entry);
		notify();
		return entry;
	};

	const drop = (hostKey: string): boolean => {
		const entry = hosts.get(hostKey);
		entry?.connection.close();
		hosts.delete(hostKey);
		const had = entry !== undefined || statuses.has(hostKey);
		setStatus(hostKey, null);
		return had;
	};

	return {
		connect(host) {
			const entry = hosts.get(host.hostKey);
			if (entry) {
				if (!entry.open && statuses.get(host.hostKey) !== CONNECTING) {
					setStatus(host.hostKey, CONNECTING);
					notify();
				}
				entry.connection.reconnectNow();
				return;
			}
			let created: HostEntry | undefined;
			created = track(
				host,
				connector(
					host,
					eventsFor(() => created),
				),
				false,
			);
		},
		async pair(link, options) {
			let paired: HostEntry | undefined;
			const started = generation;
			const connection = await pairer(link, {
				label: options.label,
				...eventsFor(() => paired),
			});
			if (generation !== started) {
				connection.close();
				throw new Error("remote sessions stopped");
			}
			const host = pairedHost(connection, Date.now());
			drop(host.hostKey);
			paired = track(host, connection, true);
			return host;
		},
		snapshot() {
			if (snapshot) return snapshot;
			const items: RemoteSessionItem[] = [];
			const clients = new Map<string, DeviceWireClient>();
			const access = new Map<string, RemoteDeviceAccess>();
			for (const [hostKey, entry] of hosts) {
				for (const record of entry.sessions.values()) {
					items.push({ hostKey, hostLabel: entry.host.label, record });
				}
				if (entry.opened) clients.set(hostKey, entry.connection.client);
				access.set(hostKey, entry.access);
			}
			snapshot = { items, statuses, clients, access };
			return snapshot;
		},
		clientFor(hostKey) {
			const entry = hosts.get(hostKey);
			return entry?.opened ? entry.connection.client : null;
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
		onRoutes(listener) {
			routeListeners.add(listener);
			return () => void routeListeners.delete(listener);
		},
		reconnectNow() {
			for (const entry of hosts.values()) entry.connection.reconnectNow();
		},
		disconnect(hostKey) {
			if (drop(hostKey)) notify();
		},
		stop() {
			generation += 1;
			for (const entry of hosts.values()) entry.connection.close();
			hosts.clear();
			statuses = new Map();
			snapshot = null;
			listeners.clear();
			lostListeners.clear();
			routeListeners.clear();
		},
	};
}

/** The saved host for a connection that just paired; a link that sent no name is named by its address. */
function pairedHost(connection: RemoteConnection, pairedAt: number): SavedHost {
	return {
		hostKey: connection.hostKey,
		relayUrl: connection.relayUrl,
		relayUrls: connection.relayUrls,
		...(connection.nostr ? { nostr: connection.nostr } : {}),
		label: connection.hostName ?? addressLabel(connection),
		pairedAt,
	};
}

function addressLabel(connection: RemoteConnection): string {
	const url = connection.relayUrl || connection.relayUrls[0] || connection.nostr?.relays[0] || "";
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}
