import type { RemoteAccessStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "@/store";
import { getTransport } from "@/transport";
import {
	initialPhoneAccess,
	newDevice,
	phoneAccessReducer,
	type ShownPairing,
	shouldAutoIssue,
} from "./phoneAccessState";

export type { ShownPairing } from "./phoneAccessState";

/** While access is on: a phone pairing, a phone (dis)connecting, the network check settling or changing. */
const STATUS_POLL_MS = 2_000;

export interface PhoneAccess {
	status: RemoteAccessStatus | null;
	pairing: ShownPairing | null;
	/** A code is being minted. */
	issuing: boolean;
	/** The phone that just paired from the shown code, until the next code is asked for. */
	justPaired: string | null;
	expired: boolean;
	pending: boolean;
	toggle: (enabled: boolean) => void;
	showCode: () => void;
	copyLink: (link: string) => void;
	revoke: (deviceId: string) => void;
}

async function qrImage(link: string): Promise<string> {
	const svg = await QRCode.toString(link, { type: "svg" });
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Phone access over `remote.*`, shared by Settings → Phone access and the topbar quick panel: reads the
 * status on mount, switches the relay at once, mints a one-time code and, while access is on, polls
 * `remote.status` so a phone that pairs replaces the code with "paired" and a toast, and connected phones and the
 * network check stay current. `autoCode` mints a code as soon as access is on — the quick panel opens straight
 * onto a scannable QR. The transitions live in the
 * pure `phoneAccessReducer`; this hook only runs the requests.
 */
export function usePhoneAccess({ autoCode = false }: { autoCode?: boolean } = {}): PhoneAccess {
	const t = useT();
	const [state, dispatch] = useReducer(phoneAccessReducer, initialPhoneAccess);
	const [expired, setExpired] = useState(false);
	const [pending, setPending] = useState(false);
	const statusRef = useRef<RemoteAccessStatus | null>(null);
	const generationRef = useRef(0);
	useEffect(() => {
		statusRef.current = state.status;
		generationRef.current = state.generation;
	}, [state.status, state.generation]);

	const adopt = useCallback(
		(status: RemoteAccessStatus) => dispatch({ type: "status", status }),
		[],
	);

	const issue = useCallback(
		(auto: boolean): void => {
			const generation = generationRef.current;
			dispatch({ type: "issuing", auto });
			getTransport()
				.request("remote.issueLink", {})
				.then(async (issued) => {
					const pairing = { ...issued, qrSrc: await qrImage(issued.link) };
					dispatch({ type: "issued", pairing, generation });
				})
				.catch(() => {
					dispatch({ type: "issueFailed", generation });
					toast.error(t("settings.phone.pairFailed"));
				});
		},
		[t],
	);

	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("remote.status", {})
			.then((status) => {
				if (!cancelled) adopt(status);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [adopt]);

	useEffect(() => {
		if (autoCode && shouldAutoIssue(state)) issue(true);
	}, [autoCode, state, issue]);

	const { pairing } = state;
	useEffect(() => {
		if (!pairing) return;
		setExpired(Date.now() >= pairing.expiresAt);
		const timer = setInterval(() => setExpired(Date.now() >= pairing.expiresAt), STATUS_POLL_MS);
		return () => clearInterval(timer);
	}, [pairing]);

	const enabled = state.status?.enabled === true;
	useEffect(() => {
		if (!enabled) return;
		const timer = setInterval(() => {
			void getTransport()
				.request("remote.status", {})
				.then((status) => {
					const added = newDevice(statusRef.current, status);
					dispatch({ type: "polled", status });
					if (added) toast.success(t("settings.phone.paired", { name: added.label }));
				})
				.catch(() => {});
		}, STATUS_POLL_MS);
		return () => clearInterval(timer);
	}, [enabled, t]);

	const toggle = (enabled: boolean): void => {
		setPending(true);
		getTransport()
			.request("remote.setEnabled", { enabled })
			.then(adopt)
			.catch(() => toast.error(t("settings.phone.changeFailed")))
			.finally(() => setPending(false));
	};

	const copyLink = (link: string): void => {
		void navigator.clipboard
			?.writeText(link)
			.then(() => toast.success(t("settings.phone.linkCopied")))
			.catch(() => {});
	};

	const revoke = (deviceId: string): void => {
		getTransport()
			.request("remote.revokeDevice", { id: deviceId })
			.then(adopt)
			.catch(() => toast.error(t("settings.phone.revokeFailed")));
	};

	return {
		status: state.status,
		pairing: state.pairing,
		issuing: state.issuing,
		justPaired: state.justPaired,
		expired,
		pending,
		toggle,
		showCode: () => issue(false),
		copyLink,
		revoke,
	};
}
