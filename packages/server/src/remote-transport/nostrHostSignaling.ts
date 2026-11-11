import { encodeHostMessage, parseDeviceMessage } from "@thinkrail/contracts";
import { type NostrSignal, normalizeRelays, openNostrSignal } from "@thinkrail/nostr-signaling";
import type { HostBrokerDeps } from "./hostBrokerClient";
import type { HostSession } from "./hostSession";

const SESSION_TTL_MS = 60_000;
const START_SKEW_SECONDS = 2;
const SWEEP_MS = 15_000;
const MAX_SESSIONS = 32;
const MAX_FRAMES_PER_SESSION = 64;

export interface NostrHostRouterDeps {
	openSession: HostBrokerDeps["openSession"];
	/** Publishes one encoded host frame to a device's Nostr key. */
	send: (to: string, data: string) => void;
	/** The signal may drop its per-peer state: the session is gone. */
	forget: (peer: string) => void;
	now?: () => number;
}

export interface NostrHostRouter {
	/** One decrypted frame from a device's (per-attempt) Nostr key. */
	receive(from: string, data: string): void;
	/** Ends sessions past their signaling window; an open data channel is left running, only forgotten. */
	sweep(): void;
	stop(): void;
	readonly sessionCount: number;
}

export function createNostrHostRouter(deps: NostrHostRouterDeps): NostrHostRouter {
	const now = deps.now ?? Date.now;
	const sessions = new Map<
		string,
		{ session: HostSession; startedAt: number; frames: number; blocked: boolean }
	>();

	const drop = (peer: string, closeSession: boolean): void => {
		const entry = sessions.get(peer);
		if (!entry) return;
		sessions.delete(peer);
		if (closeSession && !entry.blocked) entry.session.close();
		deps.forget(peer);
	};

	return {
		receive(from, data) {
			let entry = sessions.get(from);
			if (!entry) {
				if (sessions.size >= MAX_SESSIONS) return;
				const session = deps.openSession(`nostr:${from}`, (message) =>
					deps.send(from, encodeHostMessage(message)),
				);
				entry = { session, startedAt: now(), frames: 0, blocked: false };
				sessions.set(from, entry);
			}
			if (entry.blocked) return;
			entry.frames += 1;
			if (entry.frames > MAX_FRAMES_PER_SESSION) {
				entry.blocked = true;
				if (!entry.session.opened) entry.session.close();
				return;
			}
			const message = parseDeviceMessage(data);
			if (message) entry.session.receive(message);
			else entry.session.receiveUnreadable();
		},
		sweep() {
			const cutoff = now() - SESSION_TTL_MS;
			for (const [peer, entry] of sessions) {
				if (entry.startedAt <= cutoff) drop(peer, !entry.session.opened);
			}
		},
		stop() {
			for (const peer of [...sessions.keys()]) drop(peer, true);
		},
		get sessionCount() {
			return sessions.size;
		},
	};
}

export interface NostrHostConnection {
	readonly publicKey: string;
	readonly relays: readonly string[];
	connectedRelays(): number;
	stop(): void;
}

export interface NostrHostOptions {
	secretKey: Uint8Array;
	relays: readonly string[];
	openSession: HostBrokerDeps["openSession"];
	/** Injected in tests; a real relay pool by default. */
	openSignal?: typeof openNostrSignal;
}

/** Listens for devices on the host's Nostr key across the given relays and routes each to a `HostSession`. */
export function connectNostrHost(options: NostrHostOptions): NostrHostConnection {
	const relays = normalizeRelays(options.relays);
	let signal: NostrSignal | null = null;
	const router = createNostrHostRouter({
		openSession: options.openSession,
		send: (to, data) => void signal?.send(to, data).catch(() => {}),
		forget: (peer) => signal?.forget(peer),
	});
	signal = (options.openSignal ?? openNostrSignal)({
		secretKey: options.secretKey,
		relays,
		onMessage: (from, data) => router.receive(from, data),
		notBefore: Math.floor(Date.now() / 1000) - START_SKEW_SECONDS,
	});
	const sweeper = setInterval(() => router.sweep(), SWEEP_MS);
	const publicKey = signal.publicKey;
	return {
		publicKey,
		relays,
		connectedRelays: () => signal?.connectedRelays() ?? 0,
		stop() {
			clearInterval(sweeper);
			router.stop();
			signal?.close();
			signal = null;
		},
	};
}
