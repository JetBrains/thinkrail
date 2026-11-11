import {
	REMOTE_ACCESS_PROTOCOL_VERSION,
	type RemoteAccessStatus,
	type RemoteDeviceAccess,
	WS_CHANNELS,
	type WsParams,
} from "@thinkrail/contracts";
import { t as translate, useT } from "@thinkrail/locales/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { copyText } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import {
	foldRemoteStatus,
	initialPhoneAccess,
	initialRemoteStatus,
	phoneAccessReducer,
	type RemoteStatusSource,
	type ShownPairing,
	shouldAutoIssue,
} from "./phoneAccessState";
import { createKeyedFlight } from "./singleFlight";

export type { ShownPairing } from "./phoneAccessState";

/** The `remote.*` requests whose reply is the whole new status. */
type StatusMethod =
	| "remote.status"
	| "remote.setEnabled"
	| "remote.revokeDevice"
	| "remote.renameDevice"
	| "remote.setDeviceAccess";

export interface PhoneAccess {
	status: RemoteAccessStatus | null;
	/** The status read failed; `reload` tries again. */
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

let source: RemoteStatusSource = initialRemoteStatus;
const listeners = new Set<() => void>();
let followed: ReturnType<typeof getTransport> | null = null;
let readGeneration: number | null = null;

function install(next: RemoteStatusSource): void {
	source = next;
	for (const listener of listeners) listener();
}

function applyStatus(status: RemoteAccessStatus): void {
	const next = foldRemoteStatus(source, status, useAppStore.getState().connectionGeneration);
	install(next);
	if (next.paired) toast.success(translate("settings.phone.paired", { name: next.paired.label }));
}

function requestStatus<M extends StatusMethod>(method: M, params: WsParams<M>): Promise<void> {
	return getTransport().request(method, params).then(applyStatus);
}

function readStatus(): void {
	if (source.loadFailed) install({ ...source, loadFailed: false });
	requestStatus("remote.status", {}).catch(() => {
		if (source.status === null) install({ ...source, loadFailed: true });
	});
}

/** One subscription per transport and one read per connection, however many views follow. */
function follow(generation: number): void {
	const transport = getTransport();
	if (followed !== transport) {
		followed = transport;
		install(initialRemoteStatus);
		transport.subscribe(WS_CHANNELS.remoteStatusChanged, (data) => {
			if (followed === transport) applyStatus(data as RemoteAccessStatus);
		});
	}
	if (readGeneration === generation) return;
	readGeneration = generation;
	readStatus();
}

function listen(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * The host's phone-access status, shared by the topbar, its quick panel and Settings: read once per
 * connection, then kept current by the host's `remote.statusChanged` push and every change's reply.
 */
export function useRemoteAccessStatus(): RemoteStatusSource {
	const supported = useAppStore(
		(state) =>
			state.protocolVersion !== null && state.protocolVersion >= REMOTE_ACCESS_PROTOCOL_VERSION,
	);
	const connected = useAppStore((state) => state.status === "connected");
	const generation = useAppStore((state) => state.connectionGeneration);
	useEffect(() => {
		if (supported && connected) follow(generation);
	}, [supported, connected, generation]);
	return useSyncExternalStore(listen, () => source);
}

async function qrImage(link: string): Promise<string> {
	const svg = await QRCode.toString(link, { type: "svg" });
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Phone access over `remote.*`, shared by Settings → Phone access and the topbar quick panel: follows the
 * shared status, switches the relay at once and mints a one-time code, which a phone pairing from it
 * replaces with "paired". `autoCode` mints a code as soon as access is on — the quick panel opens straight
 * onto a scannable QR. The transitions live in the pure `phoneAccessReducer`; this hook only runs the
 * requests.
 */
export function usePhoneAccess({ autoCode = false }: { autoCode?: boolean } = {}): PhoneAccess {
	const t = useT();
	const shared = useRemoteAccessStatus();
	const [state, dispatch] = useReducer(phoneAccessReducer, shared.status, (status) =>
		status
			? phoneAccessReducer(initialPhoneAccess, { type: "status", status })
			: initialPhoneAccess,
	);
	const [pending, setPending] = useState(false);
	const [busyDevices, setBusyDevices] = useState<ReadonlySet<string>>(() => new Set());
	const [toggleFlight] = useState(() =>
		createKeyedFlight<"toggle">((busy) => setPending(busy.size > 0)),
	);
	const [deviceFlight] = useState(() => createKeyedFlight<string>(setBusyDevices));

	useEffect(() => {
		if (shared.status) dispatch({ type: "status", status: shared.status, paired: shared.paired });
	}, [shared]);

	const { issuing, generation } = state;
	const issue = useCallback(
		(auto: boolean): void => {
			if (issuing) return;
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
		[issuing, generation, t],
	);

	useEffect(() => {
		if (autoCode && shouldAutoIssue(state)) issue(true);
	}, [autoCode, state, issue]);

	const { pairing } = state;
	useEffect(() => {
		if (!pairing) return;
		const timer = setTimeout(
			() => dispatch({ type: "expired", link: pairing.link }),
			Math.max(0, pairing.expiresAt - Date.now()),
		);
		return () => clearTimeout(timer);
	}, [pairing]);

	const toggle = (enabled: boolean): void =>
		toggleFlight("toggle", () =>
			requestStatus("remote.setEnabled", { enabled }).catch(() =>
				toast.error(t("settings.phone.changeFailed")),
			),
		);

	const copyLink = (link: string): void => {
		void copyText(link).then((copied) =>
			copied
				? toast.success(t("settings.phone.linkCopied"))
				: toast.error(t("settings.phone.copyFailed")),
		);
	};

	const onDevice = (deviceId: string, run: () => Promise<void>, failure: string): void =>
		deviceFlight(deviceId, () => run().catch(() => toast.error(failure)));

	return {
		status: shared.status,
		loadFailed: shared.loadFailed,
		pairing,
		issuing,
		justPaired: state.justPaired,
		expired: state.expired,
		pending,
		busyDevices,
		reload: readStatus,
		toggle,
		showCode: () => issue(false),
		copyLink,
		revoke: (deviceId) =>
			onDevice(
				deviceId,
				() => requestStatus("remote.revokeDevice", { id: deviceId }),
				t("settings.phone.revokeFailed"),
			),
		rename: (deviceId, label) =>
			onDevice(
				deviceId,
				() => requestStatus("remote.renameDevice", { id: deviceId, label }),
				t("settings.phone.renameFailed"),
			),
		setAccess: (deviceId, access) =>
			onDevice(
				deviceId,
				() => requestStatus("remote.setDeviceAccess", { id: deviceId, access }),
				t("settings.phone.accessFailed"),
			),
	};
}
