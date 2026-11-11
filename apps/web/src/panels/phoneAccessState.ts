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

/** What the phone-access UI shows, kept pure so every transition is unit-tested without a DOM. */
export interface PhoneAccessState {
	status: RemoteAccessStatus | null;
	/** The one-time code on screen. */
	pairing: ShownPairing | null;
	/** A code is being minted. */
	issuing: boolean;
	/** The first status read failed, so there is nothing to show until a retry. */
	loadFailed: boolean;
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
	/** A fresh status from the host: the first read, a switch, a revoke. */
	| { type: "status"; status: RemoteAccessStatus }
	/** A status read while a code is shown; a device the last status did not have means the code was used. */
	| { type: "polled"; status: RemoteAccessStatus }
	| { type: "issuing"; auto?: boolean }
	| { type: "issued"; pairing: ShownPairing; generation: number }
	| { type: "issueFailed"; generation: number }
	| { type: "loadFailed" }
	| { type: "reload" };

export const initialPhoneAccess: PhoneAccessState = {
	status: null,
	pairing: null,
	issuing: false,
	loadFailed: false,
	justPaired: null,
	autoIssued: false,
	generation: 0,
};

/** The device in `next` that `previous` did not list — the phone that just paired — if any. */
export function newDevice(
	previous: RemoteAccessStatus | null,
	next: RemoteAccessStatus,
): RemotePairedDevice | null {
	const known = new Set((previous?.devices ?? []).map((device) => device.id));
	return next.devices.find((device) => !known.has(device.id)) ?? null;
}

function withStatus(previous: PhoneAccessState, status: RemoteAccessStatus): PhoneAccessState {
	const state = previous.loadFailed ? { ...previous, loadFailed: false } : previous;
	if (status.enabled) return { ...state, status };
	if (!state.status?.enabled && state.status !== null) return { ...state, status };
	return {
		...state,
		status,
		pairing: null,
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
		case "status":
			return withStatus(state, event.status);
		case "polled": {
			const added = newDevice(state.status, event.status);
			const next = withStatus(state, event.status);
			return added && next.pairing ? { ...next, pairing: null, justPaired: added.label } : next;
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
			return { ...state, issuing: false, pairing: event.pairing };
		case "issueFailed":
			return event.generation === state.generation ? { ...state, issuing: false } : state;
		case "loadFailed":
			return state.status === null ? { ...state, loadFailed: true } : state;
		case "reload":
			return { ...state, loadFailed: false };
	}
}

/**
 * Orders replies to requests that each return the whole status: a reply is fresh only when no later-sent
 * request's reply was taken already, so a slow poll never undoes a switch or a revoke.
 */
export function createLatestGate(): { ticket(): number; accept(ticket: number): boolean } {
	let issued = 0;
	let accepted = 0;
	return {
		ticket: () => {
			issued += 1;
			return issued;
		},
		accept: (ticket) => {
			if (ticket <= accepted) return false;
			accepted = ticket;
			return true;
		},
	};
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
