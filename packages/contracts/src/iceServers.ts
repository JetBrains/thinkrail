/**
 * Public STUN servers both peers use to learn their public address, so a phone off the host's network (mobile
 * data, another Wi‑Fi) can still reach it peer-to-peer without any ThinkRail server. A relay that runs TURN
 * adds short-lived TURN credentials to the device's `ready` frame for networks STUN cannot cross.
 */
export const PUBLIC_STUN_URLS: readonly string[] = [
	"stun:stun.l.google.com:19302",
	"stun:stun.cloudflare.com:3478",
];

export interface IceServer {
	urls: string[];
	username?: string;
	credential?: string;
}

const MAX_SERVERS = 8;
const MAX_URLS = 8;
const MAX_FIELD = 512;
const ICE_URL = /^(stun|stuns|turn|turns):/;

function field(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD;
}

function parseIceServer(value: unknown): IceServer | null {
	if (typeof value !== "object" || value === null) return null;
	const { urls, username, credential } = value as Record<string, unknown>;
	if (!Array.isArray(urls) || urls.length === 0 || urls.length > MAX_URLS) return null;
	if (!urls.every((url) => field(url) && ICE_URL.test(url))) return null;
	const server: IceServer = { urls: urls as string[] };
	if (username !== undefined) {
		if (!field(username)) return null;
		server.username = username;
	}
	if (credential !== undefined) {
		if (!field(credential)) return null;
		server.credential = credential;
	}
	return server;
}

/** Validates an untrusted ICE server list; null on any shape, scheme, or bound mismatch. */
export function parseIceServers(value: unknown): IceServer[] | null {
	if (!Array.isArray(value) || value.length > MAX_SERVERS) return null;
	const servers: IceServer[] = [];
	for (const entry of value) {
		const server = parseIceServer(entry);
		if (!server) return null;
		servers.push(server);
	}
	return servers;
}

/** The public STUN servers plus whatever (TURN) servers a relay handed out for this connection. */
export function withPublicStun(extra: readonly IceServer[] = []): IceServer[] {
	return [{ urls: [...PUBLIC_STUN_URLS] }, ...extra];
}
