import { RiFileCopyLine, RiQrCodeLine, RiSmartphoneLine } from "@remixicon/react";
import type { RemoteAccessStatus, RemotePairingLink } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SettingsGroup, SettingsPageContainer, SettingsRow } from "@thinkrail/ui/settings";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/store";
import { getTransport } from "@/transport";
import { SettingsNotice } from "./SettingsNotice";
import { SettingsSwitch } from "./SettingsSwitch";

const PAIRING_POLL_MS = 2_000;

export interface ShownPairing extends RemotePairingLink {
	/** The QR as an image URL; the image carries its own black-on-white so it scans in any theme. */
	qrSrc: string;
}

export interface PhoneAccessViewProps {
	status: RemoteAccessStatus | null;
	pairing: ShownPairing | null;
	expired: boolean;
	pending: boolean;
	onToggle: (enabled: boolean) => void;
	onShowCode: () => void;
	onCopyLink: (link: string) => void;
	onRevoke: (deviceId: string) => void;
}

function clockTime(epochMs: number): string {
	return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function calendarDate(epochMs: number): string {
	return new Date(epochMs).toLocaleDateString([], { dateStyle: "medium" });
}

export function PhoneAccessView({
	status,
	pairing,
	expired,
	pending,
	onToggle,
	onShowCode,
	onCopyLink,
	onRevoke,
}: PhoneAccessViewProps) {
	const t = useT();
	const enabled = status?.enabled ?? false;
	const devices = status?.devices ?? [];

	return (
		<SettingsPageContainer testId="settings-phone">
			<SettingsGroup
				title={t("settings.phone.title")}
				description={t("settings.phone.description")}
			>
				<SettingsRow
					label={t("settings.phone.enable")}
					description={t("settings.phone.enableDescription")}
					control={
						<SettingsSwitch
							checked={enabled}
							disabled={pending || status === null}
							label={t("settings.phone.enable")}
							testId="phone-access-toggle"
							onChange={onToggle}
						/>
					}
				/>
				{enabled && status?.addresses.length === 0 ? (
					<div className="border-border-muted border-b py-12">
						<SettingsNotice variant="warning" testId="phone-access-no-network">
							{t("settings.phone.noNetwork")}
						</SettingsNotice>
					</div>
				) : null}
				{enabled ? (
					<SettingsRow
						label={t("settings.phone.pair")}
						description={t("settings.phone.pairDescription")}
						control={
							<Button
								variant="outline"
								size="m"
								iconLeft={RiQrCodeLine}
								data-testid="phone-access-show-code"
								onClick={onShowCode}
							>
								{pairing ? t("settings.phone.newCode") : t("settings.phone.showCode")}
							</Button>
						}
					/>
				) : null}
				{enabled && pairing ? (
					<div
						data-testid="phone-access-code"
						data-expired={expired}
						className="flex flex-wrap items-center gap-16 border-border-muted border-b py-12"
					>
						<img
							src={pairing.qrSrc}
							alt={t("settings.phone.qrAlt")}
							className="size-192 shrink-0 rounded-sm"
						/>
						<div className="flex min-w-160 flex-1 flex-col gap-8">
							<p className="tr-text-ui text-text-default">{t("settings.phone.scanHint")}</p>
							<p className="tr-text-metadata text-text-muted">
								{expired
									? t("settings.phone.expired")
									: t("settings.phone.expiresAt", { time: clockTime(pairing.expiresAt) })}
							</p>
							<div className="flex">
								<Button
									variant="ghost"
									size="m"
									iconLeft={RiFileCopyLine}
									data-testid="phone-access-copy-link"
									onClick={() => onCopyLink(pairing.link)}
								>
									{t("settings.phone.copyLink")}
								</Button>
							</div>
						</div>
					</div>
				) : null}
			</SettingsGroup>
			<SettingsGroup title={t("settings.phone.devices")} testId="phone-access-devices">
				{devices.length === 0 ? (
					<p className="py-12 tr-text-metadata text-text-muted">{t("settings.phone.noDevices")}</p>
				) : (
					devices.map((device) => (
						<div
							key={device.id}
							data-testid={`phone-access-device-${device.id}`}
							className="flex items-center gap-8 border-border-muted border-b py-12"
						>
							<RiSmartphoneLine className="size-14 shrink-0 text-text-muted" />
							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<span className="truncate tr-text-ui text-text-default">{device.label}</span>
								<span className="tr-text-metadata text-text-muted">
									{t("settings.phone.pairedOn", { date: calendarDate(device.pairedAt) })}
								</span>
							</div>
							<Button
								variant="outline"
								tone="danger"
								size="m"
								data-testid={`phone-access-revoke-${device.id}`}
								onClick={() => onRevoke(device.id)}
							>
								{t("settings.phone.revoke")}
							</Button>
						</div>
					))
				)}
			</SettingsGroup>
		</SettingsPageContainer>
	);
}

export function PhoneAccessSettings() {
	const t = useT();
	const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
	const [pairing, setPairing] = useState<ShownPairing | null>(null);
	const [expired, setExpired] = useState(false);
	const [pending, setPending] = useState(false);
	const knownDevices = useRef<Set<string>>(new Set());

	const adopt = (next: RemoteAccessStatus): void => {
		knownDevices.current = new Set(next.devices.map((device) => device.id));
		setStatus(next);
		if (!next.enabled) setPairing(null);
	};

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
	}, []);

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
	}, [pairing, t]);

	const toggle = (enabled: boolean): void => {
		setPending(true);
		getTransport()
			.request("remote.setEnabled", { enabled })
			.then(adopt)
			.catch(() => toast.error(t("settings.phone.changeFailed")))
			.finally(() => setPending(false));
	};

	const showCode = (): void => {
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

	return (
		<PhoneAccessView
			status={status}
			pairing={pairing}
			expired={expired}
			pending={pending}
			onToggle={toggle}
			onShowCode={showCode}
			onCopyLink={copyLink}
			onRevoke={revoke}
		/>
	);
}
