import type { RemoteAccessStatus, RemotePairingLink } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/store";
import { getTransport } from "@/transport";

const PAIRING_POLL_MS = 2_000;

export interface ShownPairing extends RemotePairingLink {
	/** The QR as an image URL; the image carries its own black-on-white so it scans in any theme. */
	qrSrc: string;
}

export interface PhoneAccess {
	status: RemoteAccessStatus | null;
	pairing: ShownPairing | null;
	expired: boolean;
	pending: boolean;
	toggle: (enabled: boolean) => void;
	showCode: () => void;
	copyLink: (link: string) => void;
	revoke: (deviceId: string) => void;
}

/**
 * Phone access over `remote.*`, shared by Settings → Phone access and the topbar quick panel: reads the
 * status on mount, switches the relay at once, mints a one-time code and, while one is shown, polls
 * `remote.status` so a phone that pairs closes the code with a toast. `autoCode` mints a code as soon as
 * access is on — the quick panel opens straight onto a scannable QR.
 */
export function usePhoneAccess({ autoCode = false }: { autoCode?: boolean } = {}): PhoneAccess {
	const t = useT();
	const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
	const [pairing, setPairing] = useState<ShownPairing | null>(null);
	const [expired, setExpired] = useState(false);
	const [pending, setPending] = useState(false);
	const knownDevices = useRef<Set<string>>(new Set());
	const autoIssued = useRef(false);

	const adopt = useCallback((next: RemoteAccessStatus): void => {
		knownDevices.current = new Set(next.devices.map((device) => device.id));
		setStatus(next);
		if (!next.enabled) {
			setPairing(null);
			autoIssued.current = false;
		}
	}, []);

	const showCode = useCallback((): void => {
		getTransport()
			.request("remote.issueLink", {})
			.then(async (issued) => {
				const svg = await QRCode.toString(issued.link, { type: "svg" });
				setPairing({
					...issued,
					qrSrc: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
				});
			})
			.catch(() => toast.error(t("settings.phone.pairFailed")));
	}, [t]);

	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("remote.status", {})
			.then((next) => {
				if (!cancelled) adopt(next);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [adopt]);

	useEffect(() => {
		if (!autoCode || !status?.enabled || pairing || autoIssued.current) return;
		autoIssued.current = true;
		showCode();
	}, [autoCode, status?.enabled, pairing, showCode]);

	useEffect(() => {
		if (!pairing) return;
		setExpired(Date.now() >= pairing.expiresAt);
		const timer = setInterval(() => {
			setExpired(Date.now() >= pairing.expiresAt);
			void getTransport()
				.request("remote.status", {})
				.then((next) => {
					const added = next.devices.find((device) => !knownDevices.current.has(device.id));
					adopt(next);
					if (added) {
						setPairing(null);
						toast.success(t("settings.phone.paired", { name: added.label }));
					}
				})
				.catch(() => {});
		}, PAIRING_POLL_MS);
		return () => clearInterval(timer);
	}, [pairing, adopt, t]);

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

	return { status, pairing, expired, pending, toggle, showCode, copyLink, revoke };
}
