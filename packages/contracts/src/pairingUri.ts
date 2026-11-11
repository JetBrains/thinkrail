const SCHEME = "thinkrail:";
const HOST = "pair";
const VERSION = "1";

/** The host's internet route: its Nostr signaling key and the public relays it listens on. */
export interface PairingNostrRoute {
	/** Hex secp256k1 public key the host's Nostr signaling is addressed by. */
	publicKey: string;
	relays: readonly string[];
}

/**
 * Every route a paired device reaches its host by. The host pushes it over the session (`remote.hostRoutes`)
 * whenever a device connects, so a saved host follows a new Wi‑Fi address or a Nostr route added after pairing.
 */
export interface RemoteHostRoutes {
	signalingUrls: readonly string[];
	nostr?: PairingNostrRoute;
}

const NOSTR_KEY = /^[0-9a-f]{64}$/;
const MAX_ROUTES = 16;

const nostrRouteOf = (key: unknown, relays: readonly unknown[]): PairingNostrRoute | undefined => {
	const urls = relays.filter(
		(relay): relay is string => typeof relay === "string" && relay.length > 0,
	);
	return typeof key === "string" && NOSTR_KEY.test(key) && urls.length > 0
		? { publicKey: key, relays: urls.slice(0, MAX_ROUTES) }
		: undefined;
};

/** Reads a `remote.hostRoutes` push; null when it carries no usable route. */
export function parseRemoteHostRoutes(data: unknown): RemoteHostRoutes | null {
	if (typeof data !== "object" || data === null) return null;
	const { signalingUrls, nostr } = data as { signalingUrls?: unknown; nostr?: unknown };
	const urls = Array.isArray(signalingUrls)
		? signalingUrls
				.filter((url): url is string => typeof url === "string" && /^wss?:\/\//.test(url))
				.slice(0, MAX_ROUTES)
		: [];
	const route =
		typeof nostr === "object" && nostr !== null
			? nostrRouteOf(
					(nostr as { publicKey?: unknown }).publicKey,
					Array.isArray((nostr as { relays?: unknown }).relays)
						? (nostr as { relays: unknown[] }).relays
						: [],
				)
			: undefined;
	if (urls.length === 0 && !route) return null;
	return { signalingUrls: urls, ...(route ? { nostr: route } : {}) };
}

export interface PairingUriParams {
	/** Every relay address the host is reachable at (e.g. its Wi‑Fi and Tailscale addresses); the device uses the first that answers. */
	signalingUrls: readonly string[];
	/** Reaches the host from any network through public Nostr relays; absent when the host turned it off. */
	nostr?: PairingNostrRoute;
	token: string;
	/** base64url raw Ed25519 host public key, so the device can verify who it paired with. */
	hostPublicKey: string;
	projectRef: string;
	/** The computer's name, shown on the device instead of a relay address. */
	hostName?: string;
}

/** Builds the `thinkrail://pair?…` URI encoded into the QR code. */
export function buildPairingUri(params: PairingUriParams): string {
	const query = new URLSearchParams({ v: VERSION });
	for (const url of params.signalingUrls) query.append("s", url);
	query.set("t", params.token);
	query.set("k", params.hostPublicKey);
	query.set("p", params.projectRef);
	if (params.hostName) query.set("n", params.hostName);
	if (params.nostr) {
		query.set("o", params.nostr.publicKey);
		for (const relay of params.nostr.relays) query.append("r", relay);
	}
	return `${SCHEME}//${HOST}?${query.toString()}`;
}

/** Parses a scanned pairing URI, returning null when the scheme, version or any field is wrong. */
export function parsePairingUri(uri: string): PairingUriParams | null {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return null;
	}
	if (url.protocol !== SCHEME || url.host !== HOST || url.searchParams.get("v") !== VERSION) {
		return null;
	}
	const signalingUrls = url.searchParams.getAll("s").filter((value) => value.length > 0);
	const token = url.searchParams.get("t");
	const hostPublicKey = url.searchParams.get("k");
	const projectRef = url.searchParams.get("p");
	const hostName = url.searchParams.get("n");
	const nostrKey = url.searchParams.get("o");
	const nostrRelays = url.searchParams.getAll("r").filter((value) => value.length > 0);
	const nostr = nostrRouteOf(nostrKey, nostrRelays);
	if ((signalingUrls.length === 0 && !nostr) || !token || !hostPublicKey || !projectRef)
		return null;
	return {
		signalingUrls,
		token,
		hostPublicKey,
		projectRef,
		...(hostName ? { hostName } : {}),
		...(nostr ? { nostr } : {}),
	};
}
