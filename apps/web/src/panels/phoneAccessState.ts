import type {
	RemoteAccessStatus,
	RemotePairedDevice,
	RemotePairingLink,
	RemotePublicCheck,
} from "@thinkrail/contracts";

export interface ShownPairing extends RemotePairingLink {
	/** The QR as an image URL; the image carries its own black-on-white so it scans in any theme. */
	qrSrc: string;
}

/** The host's phone-access status as every view follows it: read once per connection, then pushed. */
export interface RemoteStatusSource {
	status: RemoteAccessStatus | null;
	/** The read failed and nothing has arrived since; a retry reads again. */
	loadFailed: boolean;
	/** The phone this status added over the last one on the same connection — the one that just paired. */
	paired: RemotePairedDevice | null;
	/** The connection the status arrived on; a status from another one is no baseline to diff against. */
	generation: number | null;
}

export const initialRemoteStatus: RemoteStatusSource = {
	status: null,
	loadFailed: false,
	paired: null,
	generation: null,
};

/** The device in `next` that `previous` did not list — the phone that just paired — if any. */
export function newDevice(
	previous: RemoteAccessStatus | null,
	next: RemoteAccessStatus,
): RemotePairedDevice | null {
	const known = new Set((previous?.devices ?? []).map((device) => device.id));
	return next.devices.find((device) => !known.has(device.id)) ?? null;
}

/** Takes a status from a read, a push or a change's reply; the one place a newly paired phone is noticed. */
export function foldRemoteStatus(
	previous: RemoteStatusSource,
	status: RemoteAccessStatus,
	generation: number,
): RemoteStatusSource {
	const baseline = previous.generation === generation ? previous.status : null;
	return {
		status,
		loadFailed: false,
		paired: baseline ? newDevice(baseline, status) : null,
		generation,
	};
}

/** A code's lifecycle in one view, kept pure so every transition is unit-tested without a DOM. */
export interface PhoneAccessState {
	/** The last status this view took, for its transitions; the views render the shared one. */
	status: RemoteAccessStatus | null;
	/** The one-time code on screen. */
	pairing: ShownPairing | null;
	/** The shown code's expiry has passed. */
	expired: boolean;
	/** A code is being minted. */
	issuing: boolean;
	/** The phone that paired from the shown code, until the next code is asked for. */
	justPaired: string | null;
	/** A code was already minted on its own for this "on" stretch, so closing it does not mint another. */
	autoIssued: boolean;
	/**
	 * Counts "off" moments. Turning access off restarts the relay with fresh codes, so a code minted before
	 * it (`issued` carrying an older generation) is never shown.
	 */
	generation: number;
}

export type PhoneAccessEvent =
	/** A status from the host; `paired` (from `foldRemoteStatus`) means the shown code was used. */
	| { type: "status"; status: RemoteAccessStatus; paired?: RemotePairedDevice | null }
	| { type: "issuing"; auto?: boolean }
	| { type: "issued"; pairing: ShownPairing; generation: number }
	| { type: "issueFailed"; generation: number }
	| { type: "expired"; link: string };

export const initialPhoneAccess: PhoneAccessState = {
	status: null,
	pairing: null,
	expired: false,
	issuing: false,
	justPaired: null,
	autoIssued: false,
	generation: 0,
};

function withStatus(state: PhoneAccessState, status: RemoteAccessStatus): PhoneAccessState {
	if (status.enabled) return { ...state, status };
	if (!state.status?.enabled && state.status !== null) return { ...state, status };
	return {
		...state,
		status,
		pairing: null,
		expired: false,
		issuing: false,
		justPaired: null,
		autoIssued: false,
		generation: state.generation + 1,
	};
}

export function phoneAccessReducer(
	state: PhoneAccessState,
	event: PhoneAccessEvent,
): PhoneAccessState {
	switch (event.type) {
		case "status": {
			const next = withStatus(state, event.status);
			return event.paired && next.pairing
				? { ...next, pairing: null, expired: false, justPaired: event.paired.label }
				: next;
		}
		case "issuing":
			return {
				...state,
				issuing: true,
				justPaired: null,
				autoIssued: state.autoIssued || event.auto === true,
			};
		case "issued":
			if (event.generation !== state.generation || !state.status?.enabled) return state;
			return { ...state, issuing: false, pairing: event.pairing, expired: false };
		case "issueFailed":
			return event.generation === state.generation ? { ...state, issuing: false } : state;
		case "expired":
			return state.pairing?.link === event.link ? { ...state, expired: true } : state;
	}
}

/**
 * The quick panel opens straight onto a code: once per "on" stretch, when none is shown or being made, and
 * after the internet check has settled so the code carries a public address it finds.
 */
export function shouldAutoIssue(state: PhoneAccessState): boolean {
	const relay = state.status?.relay;
	return (
		state.status?.enabled === true &&
		!phoneHasNoRoute(state.status) &&
		!(relay?.kind === "builtIn" && relay.publicCheck.state === "checking") &&
		!state.pairing &&
		!state.issuing &&
		!state.autoIssued
	);
}

/** How phones reach this host while access is on, derived once for Settings and the quick panel. */
export interface PhoneReach {
	/** The `--relay` URL; the built-in routes below do not apply then. */
	external: string | null;
	/** The built-in relay's port. */
	port: number | null;
	lan: string[];
	tailscale: string[];
	publicCheck: RemotePublicCheck | null;
	/** The public Nostr relays phones on any network signal through: their hosts and how many are live. */
	nostr: { hosts: string[]; connected: number } | null;
	/** The routes a phone has right now, in the order the panel names them. */
	routes: PhoneRoute[];
	/** A phone on another network can connect. */
	anywhere: boolean;
}

export type PhoneRoute = "lan" | "tailscale" | "public" | "relay" | "nostr";

const hostOf = (url: string): string => {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
};

/** Access is on but a phone has no way in: no network address and no live Nostr relay. */
export function phoneHasNoRoute(status: RemoteAccessStatus | null): boolean {
	return (
		status?.enabled === true && status.addresses.length === 0 && !(status.nostr?.connected ?? 0)
	);
}

export function phoneReach(status: RemoteAccessStatus | null): PhoneReach | null {
	if (!status?.enabled || !status.relay) return null;
	const { relay } = status;
	const nostr = status.nostr
		? { hosts: status.nostr.relays.map(hostOf), connected: status.nostr.connected }
		: null;
	const viaNostr: PhoneRoute[] = nostr && nostr.connected > 0 ? ["nostr"] : [];
	if (relay.kind === "external") {
		return {
			external: relay.url,
			port: null,
			lan: [],
			tailscale: [],
			publicCheck: null,
			nostr,
			routes: ["relay", ...viaNostr],
			anywhere: true,
		};
	}
	const of = (route: "lan" | "tailscale"): string[] =>
		status.addresses
			.filter((address) => address.route === route)
			.map((address) => hostOf(address.url));
	const lan = of("lan");
	const tailscale = of("tailscale");
	const { publicCheck } = relay;
	const isPublic = publicCheck.state === "reachable" || publicCheck.state === "interface";
	const routes: PhoneRoute[] = [
		...(lan.length > 0 ? (["lan"] as const) : []),
		...(tailscale.length > 0 ? (["tailscale"] as const) : []),
		...(isPublic ? (["public"] as const) : []),
		...viaNostr,
	];
	return {
		external: null,
		port: relay.port,
		lan,
		tailscale,
		publicCheck,
		nostr,
		routes,
		anywhere: tailscale.length > 0 || isPublic || viaNostr.length > 0,
	};
}
