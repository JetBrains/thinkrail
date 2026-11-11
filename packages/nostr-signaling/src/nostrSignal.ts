import * as nip44 from "nostr-tools/nip44";
import { SimplePool } from "nostr-tools/pool";
import { type Event, finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
	createInOrder,
	type Envelope,
	encodeEnvelope,
	MAX_DATA,
	parseEnvelope,
	SIGNALING_KIND,
} from "./envelope";
import { normalizeRelays } from "./relays";

export interface NostrSignalOptions {
	/** 32-byte secp256k1 secret: the host's derived key, or a fresh one per device attempt. */
	secretKey: Uint8Array;
	relays: readonly string[];
	/** One decrypted frame from `from` (hex public key), in the order that sender sent it. */
	onMessage: (from: string, data: string) => void;
	/** Events older than this are ignored (a relay replaying the subscription's window). */
	maxAgeSeconds?: number;
	/** Unix seconds before which no event is taken, however a relay replays: a restarted host never re-answers attempts addressed to its previous run. */
	notBefore?: number;
	/** How long `ready` waits for a first relay subscription to go live. */
	readyTimeoutMs?: number;
}

export interface NostrSignal {
	/** Hex secp256k1 public key this signal is addressed by. */
	readonly publicKey: string;
	/** Settles once a relay subscription is live; rejects when no relay answered in time. */
	readonly ready: Promise<void>;
	/** Encrypts `data` to `to` and publishes it to every relay; resolves once one relay accepted it. */
	send(to: string, data: string): Promise<void>;
	/** Drops the ordering state kept for a peer whose session ended. */
	forget(peer: string): void;
	/** How many of the relays hold an open connection right now. */
	connectedRelays(): number;
	close(): void;
}

export class NostrUnreachableError extends Error {
	readonly code = "nostr_unreachable";
	readonly relays: readonly string[];
	constructor(relays: readonly string[]) {
		super(`no Nostr relay answered (${relays.join(", ")})`);
		this.relays = relays;
		this.name = "NostrUnreachableError";
	}
}

export const generateNostrSecret = (): Uint8Array => generateSecretKey();
export const nostrPublicKey = (secretKey: Uint8Array): string => getPublicKey(secretKey);

const DEFAULT_MAX_AGE_SECONDS = 60;
const DEFAULT_READY_TIMEOUT_MS = 8_000;
const MAX_SEEN = 2_048;
const RETRY_MS = [2_000, 5_000, 15_000, 60_000];

/**
 * A NIP-44 encrypted, ephemeral-event message channel over a set of Nostr relays, addressed by public key.
 * Every frame goes to all relays and is deduplicated and re-ordered on receipt, so any one relay suffices
 * and a dead or slow one costs nothing. A relay subscription that drops is re-opened with backoff.
 */
export function openNostrSignal(options: NostrSignalOptions): NostrSignal {
	const relays = normalizeRelays(options.relays);
	const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
	const publicKey = getPublicKey(options.secretKey);
	const pool = new SimplePool({ enablePing: true, enableReconnect: true });
	const seen = new Set<string>();
	const inbound = new Map<string, (envelope: Envelope) => void>();
	const outboundSeq = new Map<string, number>();
	const conversationKeys = new Map<string, Uint8Array>();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const subs = new Map<string, { close(): void }>();
	let closed = false;

	const conversationKey = (peer: string): Uint8Array => {
		let key = conversationKeys.get(peer);
		if (!key) {
			key = nip44.getConversationKey(options.secretKey, peer);
			conversationKeys.set(peer, key);
		}
		return key;
	};

	const onEvent = (event: Event): void => {
		if (closed || seen.has(event.id)) return;
		if (seen.size >= MAX_SEEN) seen.clear();
		seen.add(event.id);
		if (event.created_at < Math.floor(Date.now() / 1000) - maxAge) return;
		if (options.notBefore !== undefined && event.created_at < options.notBefore) return;
		let envelope: Envelope | null;
		try {
			envelope = parseEnvelope(nip44.decrypt(event.content, conversationKey(event.pubkey)));
		} catch {
			return;
		}
		if (!envelope) return;
		let deliver = inbound.get(event.pubkey);
		if (!deliver) {
			const from = event.pubkey;
			deliver = createInOrder((data) => {
				if (!closed) options.onMessage(from, data);
			});
			inbound.set(from, deliver);
		}
		deliver(envelope);
	};

	let markReady: () => void = () => {};
	let markUnreachable: () => void = () => {};
	const ready = new Promise<void>((resolve, reject) => {
		markReady = resolve;
		markUnreachable = () => reject(new NostrUnreachableError(relays));
	});
	ready.catch(() => {});
	if (relays.length === 0) markUnreachable();
	const readyTimer = setTimeout(
		markUnreachable,
		options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
	);
	void ready.then(
		() => clearTimeout(readyTimer),
		() => clearTimeout(readyTimer),
	);

	const subscribe = (url: string, attempt: number): void => {
		if (closed) return;
		let dropped = false;
		const sub = pool.subscribeMany(
			[url],
			{
				kinds: [SIGNALING_KIND],
				"#p": [publicKey],
				since: Math.floor(Date.now() / 1000) - maxAge,
			},
			{
				onevent: onEvent,
				// The pool reports a failed connection as EOSE then close, so live means EOSE with no close.
				oneose: () => {
					setTimeout(() => {
						if (!dropped) markReady();
					}, 0);
				},
				onclose: () => {
					dropped = true;
					if (closed) return;
					const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 60_000;
					const timer = setTimeout(() => {
						timers.delete(timer);
						subscribe(url, attempt + 1);
					}, delay);
					timers.add(timer);
				},
			},
		);
		subs.set(url, sub);
	};
	for (const url of relays) subscribe(url, 0);

	return {
		publicKey,
		ready,
		async send(to, data) {
			if (closed) throw new Error("signal closed");
			if (data.length > MAX_DATA) throw new Error("signaling frame too large");
			const seq = outboundSeq.get(to) ?? 0;
			outboundSeq.set(to, seq + 1);
			const event = finalizeEvent(
				{
					kind: SIGNALING_KIND,
					created_at: Math.floor(Date.now() / 1000),
					tags: [["p", to]],
					content: nip44.encrypt(encodeEnvelope({ seq, data }), conversationKey(to)),
				},
				options.secretKey,
			);
			try {
				await Promise.any(pool.publish(relays, event));
			} catch {
				throw new NostrUnreachableError(relays);
			}
		},
		connectedRelays() {
			let open = 0;
			for (const connected of pool.listConnectionStatus().values()) if (connected) open += 1;
			return open;
		},
		forget(peer) {
			inbound.delete(peer);
			outboundSeq.delete(peer);
			conversationKeys.delete(peer);
		},
		close() {
			if (closed) return;
			closed = true;
			clearTimeout(readyTimer);
			markUnreachable();
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
			for (const sub of subs.values()) sub.close();
			pool.destroy();
		},
	};
}
