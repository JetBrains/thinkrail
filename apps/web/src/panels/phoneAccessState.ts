import type {
	RemoteAccessStatus,
	RemotePairedDevice,
	RemotePairingLink,
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
	| { type: "issueFailed"; generation: number };

export const initialPhoneAccess: PhoneAccessState = {
	status: null,
	pairing: null,
	issuing: false,
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

function withStatus(state: PhoneAccessState, status: RemoteAccessStatus): PhoneAccessState {
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
	}
}

/** The quick panel opens straight onto a code: once per "on" stretch, when none is shown or being made. */
export function shouldAutoIssue(state: PhoneAccessState): boolean {
	return (
		state.status?.enabled === true &&
		state.status.addresses.length > 0 &&
		!state.pairing &&
		!state.issuing &&
		!state.autoIssued
	);
}
