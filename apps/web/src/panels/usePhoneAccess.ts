import type { RemoteAccessStatus, RemoteDeviceAccess, WsParams } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "@/store";
import { getTransport } from "@/transport";
import {
	createLatestGate,
	initialPhoneAccess,
	newDevice,
	phoneAccessReducer,
	type ShownPairing,
	shouldAutoIssue,
} from "./phoneAccessState";

export type { ShownPairing } from "./phoneAccessState";

/** The `remote.*` requests whose reply is the whole new status. */
type StatusMethod =
	| "remote.status"
	| "remote.setEnabled"
	| "remote.revokeDevice"
	| "remote.renameDevice"
	| "remote.setDeviceAccess";

/** While access is on: a phone pairing, a phone (dis)connecting, the network check settling or changing. */
const STATUS_POLL_MS = 2_000;

export interface PhoneAccess {
	status: RemoteAccessStatus | null;
	/** The first status read failed; `reload` tries again. */
	loadFailed: boolean;
	pairing: ShownPairing | null;
	/** A code is being minted. */
	issuing: boolean;
	/** The phone that just paired from the shown code, until the next code is asked for. */
	justPaired: string | null;
	expired: boolean;
	pending: boolean;
	/** Paired phones with a rename, access change or revoke in flight. */
	busyDevices: ReadonlySet<string>;
	reload: () => void;
	toggle: (enabled: boolean) => void;
	showCode: () => void;
	copyLink: (link: string) => void;
	revoke: (deviceId: string) => void;
	rename: (deviceId: string, label: string) => void;
	setAccess: (deviceId: string, access: RemoteDeviceAccess) => void;
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
	const [busyDevices, setBusyDevices] = useState<ReadonlySet<string>>(() => new Set());
	const [loadAttempt, setLoadAttempt] = useState(0);
	const statusRef = useRef<RemoteAccessStatus | null>(null);
	const generationRef = useRef(0);
	const issuingRef = useRef(false);
	const pendingRef = useRef(false);
	const busyRef = useRef(new Set<string>());
	const [gate] = useState(createLatestGate);
	useEffect(() => {
		generationRef.current = state.generation;
		issuingRef.current = state.issuing;
	}, [state.generation, state.issuing]);

	const requestStatus = useCallback(
		<M extends StatusMethod>(
			method: M,
			params: WsParams<M>,
			event: "status" | "polled" = "status",
		): Promise<void> => {
			const ticket = gate.ticket();
			return getTransport()
				.request(method, params)
				.then((status) => {
					if (!gate.accept(ticket)) return;
					const added = event === "polled" ? newDevice(statusRef.current, status) : null;
					statusRef.current = status;
					dispatch({ type: event, status });
					if (added) toast.success(t("settings.phone.paired", { name: added.label }));
				});
		},
		[gate, t],
	);

	const issue = useCallback(
		(auto: boolean): void => {
			if (issuingRef.current) return;
			issuingRef.current = true;
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
		if (loadAttempt > 0) dispatch({ type: "reload" });
		requestStatus("remote.status", {}).catch(() => dispatch({ type: "loadFailed" }));
	}, [requestStatus, loadAttempt]);

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
			requestStatus("remote.status", {}, "polled").catch(() => {});
		}, STATUS_POLL_MS);
		return () => clearInterval(timer);
	}, [enabled, requestStatus]);

	const toggle = (enabled: boolean): void => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		requestStatus("remote.setEnabled", { enabled })
			.catch(() => toast.error(t("settings.phone.changeFailed")))
			.finally(() => {
				pendingRef.current = false;
				setPending(false);
			});
	};

	const copyLink = (link: string): void => {
		const copied =
			navigator.clipboard?.writeText(link) ?? Promise.reject(new Error("no clipboard"));
		copied
			.then(() => toast.success(t("settings.phone.linkCopied")))
			.catch(() => toast.error(t("settings.phone.copyFailed")));
	};

	const onDevice = (deviceId: string, run: () => Promise<void>, failure: string): void => {
		if (busyRef.current.has(deviceId)) return;
		busyRef.current.add(deviceId);
		setBusyDevices(new Set(busyRef.current));
		run()
			.catch(() => toast.error(failure))
			.finally(() => {
				busyRef.current.delete(deviceId);
				setBusyDevices(new Set(busyRef.current));
			});
	};

	const revoke = (deviceId: string): void =>
		onDevice(
			deviceId,
			() => requestStatus("remote.revokeDevice", { id: deviceId }),
			t("settings.phone.revokeFailed"),
		);

	const rename = (deviceId: string, label: string): void =>
		onDevice(
			deviceId,
			() => requestStatus("remote.renameDevice", { id: deviceId, label }),
			t("settings.phone.renameFailed"),
		);

	const setAccess = (deviceId: string, access: RemoteDeviceAccess): void =>
		onDevice(
			deviceId,
			() => requestStatus("remote.setDeviceAccess", { id: deviceId, access }),
			t("settings.phone.accessFailed"),
		);

	return {
		status: state.status,
		loadFailed: state.loadFailed,
		pairing: state.pairing,
		issuing: state.issuing,
		justPaired: state.justPaired,
		expired,
		pending,
		busyDevices,
		reload: () => setLoadAttempt((attempt) => attempt + 1),
		toggle,
		showCode: () => issue(false),
		copyLink,
		revoke,
		rename,
		setAccess,
	};
}
