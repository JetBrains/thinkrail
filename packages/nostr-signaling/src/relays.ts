/**
 * Public relays verified to forward ephemeral events from unknown keys, in preference order. The pairing link
 * carries the host's list, so changing this default never strands an already-paired phone.
 */
export const DEFAULT_NOSTR_RELAYS: readonly string[] = [
	"wss://relay.snort.social",
	"wss://relay.primal.net",
	"wss://nostr.oxtr.dev",
	"wss://relay.nostr.net",
	"wss://offchain.pub",
];

const MAX_RELAYS = 8;
const MAX_URL = 256;

/** Keeps well-formed, distinct `wss://` relay URLs (plain `ws://` only on loopback, for tests), capped. */
export function normalizeRelays(urls: readonly string[]): string[] {
	const out: string[] = [];
	for (const raw of urls) {
		if (raw.length > MAX_URL) continue;
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			continue;
		}
		const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
		if (url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback)) continue;
		const value = url.toString().replace(/\/$/, "");
		if (!out.includes(value)) out.push(value);
		if (out.length === MAX_RELAYS) break;
	}
	return out;
}
