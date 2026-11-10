import {
	RiCheckboxCircleFill,
	RiEyeLine,
	RiFileCopyLine,
	RiQrCodeLine,
	RiRefreshLine,
	RiSmartphoneLine,
} from "@remixicon/react";
import { REMOTE_ACCESS_PROTOCOL_VERSION, type RemoteAccessStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { useCallback, useEffect, useId, useState } from "react";
import { type PhoneRoute, phoneHasNoRoute, phoneReach } from "../panels/phoneAccessState";
import { SettingsSwitch } from "../panels/SettingsSwitch";
import { type ShownPairing, usePhoneAccess } from "../panels/usePhoneAccess";
import { SettingsSection, useAppStore } from "../store";
import { getTransport } from "../transport";

const ROUTE_NAME = {
	lan: "shell.phone.routeLan",
	tailscale: "shell.phone.routeTailscale",
	public: "shell.phone.routePublic",
	relay: "shell.phone.routeRelay",
	nostr: "shell.phone.routeNostr",
} as const satisfies Record<PhoneRoute, string>;

function clockTime(epochMs: number): string {
	return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export interface PhoneAccessPanelProps {
	headingId: string;
	status: RemoteAccessStatus | null;
	pairing: ShownPairing | null;
	issuing: boolean;
	justPaired: string | null;
	expired: boolean;
	pending: boolean;
	onToggle: (enabled: boolean) => void;
	onShowCode: () => void;
	onCopyLink: (link: string) => void;
	onRevoke: (deviceId: string) => void;
	onOpenSettings: () => void;
}

/** The props-only quick panel: the relay switch, the one-time QR while on, and paired phones with Disconnect. */
export function PhoneAccessPanel({
	headingId,
	status,
	pairing,
	issuing,
	justPaired,
	expired,
	pending,
	onToggle,
	onShowCode,
	onCopyLink,
	onRevoke,
	onOpenSettings,
}: PhoneAccessPanelProps) {
	const t = useT();
	const enabled = status?.enabled ?? false;
	const devices = status?.devices ?? [];
	const reach = phoneReach(status);
	const checking = reach?.publicCheck?.state === "checking";

	return (
		<div className="flex w-288 flex-col">
			<div className="flex items-center gap-12 border-border-muted border-b px-12 py-8">
				<h2
					id={headingId}
					className="m-0 min-w-0 flex-1 truncate tr-title-section text-text-default"
				>
					{t("settings.phone.title")}
				</h2>
				<SettingsSwitch
					checked={enabled}
					disabled={pending || status === null}
					label={t("settings.phone.enable")}
					testId="phone-quick-toggle"
					onChange={onToggle}
				/>
			</div>

			{!enabled ? (
				<p className="m-0 px-12 py-12 tr-text-metadata text-text-muted">
					{t("shell.phone.offHint")}
				</p>
			) : phoneHasNoRoute(status) ? (
				<p
					data-testid="phone-quick-no-network"
					className="m-0 px-12 py-12 tr-text-metadata text-feedback-warning"
				>
					{t("settings.phone.noNetwork")}
				</p>
			) : (
				<div
					data-testid="phone-quick-code"
					data-expired={expired}
					className="flex flex-col items-center gap-8 border-border-muted border-b px-12 py-12"
				>
					{pairing ? (
						<>
							<img
								src={pairing.qrSrc}
								alt={t("settings.phone.qrAlt")}
								className={`size-192 rounded-sm ${expired ? "opacity-30" : ""}`}
							/>
							<p className="m-0 text-center tr-text-metadata text-text-muted">
								{expired
									? t("settings.phone.expired")
									: t("shell.phone.scanUntil", { time: clockTime(pairing.expiresAt) })}
							</p>
							<div className="flex items-center gap-8">
								<Button
									variant="outline"
									size="m"
									iconLeft={RiRefreshLine}
									data-testid="phone-quick-new-code"
									onClick={onShowCode}
								>
									{t("settings.phone.newCode")}
								</Button>
								<IconButton
									variant="ghost"
									size="m"
									icon={RiFileCopyLine}
									label={t("settings.phone.copyLink")}
									tooltip={t("settings.phone.copyLink")}
									data-testid="phone-quick-copy-link"
									onClick={() => onCopyLink(pairing.link)}
								/>
							</div>
						</>
					) : issuing ? (
						<>
							<div className="size-192 rounded-sm bg-container-content-bg" />
							<p className="m-0 text-center tr-text-metadata text-text-muted">
								{t("shell.phone.making")}
							</p>
						</>
					) : (
						<>
							{justPaired ? (
								<p
									data-testid="phone-quick-paired"
									className="m-0 flex items-center gap-8 tr-text-ui text-text-default"
								>
									<RiCheckboxCircleFill aria-hidden className="size-16 shrink-0 text-primary" />
									{t("settings.phone.paired", { name: justPaired })}
								</p>
							) : null}
							<Button
								variant="outline"
								size="m"
								iconLeft={RiQrCodeLine}
								data-testid="phone-quick-show-code"
								onClick={onShowCode}
							>
								{justPaired ? t("shell.phone.pairAnother") : t("settings.phone.showCode")}
							</Button>
						</>
					)}
					{reach ? (
						<p
							data-testid="phone-quick-reach"
							data-anywhere={reach.anywhere}
							className="m-0 text-center tr-text-metadata text-text-muted"
						>
							{checking
								? t("shell.phone.reachChecking")
								: reach.anywhere
									? t("shell.phone.reachVia", {
											routes: reach.routes.map((route) => t(ROUTE_NAME[route])).join(" · "),
										})
									: t("shell.phone.reachLanOnly")}
						</p>
					) : null}
				</div>
			)}

			{devices.length > 0 ? (
				<div className="flex flex-col py-4" data-testid="phone-quick-devices">
					<span className="px-12 pt-4 pb-2 tr-text-eyebrow text-text-subtle">
						{t("settings.phone.devices")}
					</span>
					<ul className="m-0 list-none p-0">
						{devices.map((device) => (
							<li
								key={device.id}
								data-testid={`phone-quick-device-${device.id}`}
								data-connected={device.connected}
								className="flex h-panel-row items-center gap-8 px-12"
							>
								<RiSmartphoneLine
									aria-hidden
									className={`size-14 shrink-0 ${device.connected ? "text-feedback-success" : "text-text-muted"}`}
								/>
								<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">
									{device.label}
								</span>
								{device.access === "read" ? (
									<span
										role="img"
										aria-label={t("shell.phone.readOnly")}
										title={t("shell.phone.readOnly")}
										data-testid={`phone-quick-read-only-${device.id}`}
										className="flex shrink-0"
									>
										<RiEyeLine aria-hidden className="size-14 text-text-muted" />
									</span>
								) : null}
								{device.connected ? (
									<span className="shrink-0 tr-text-metadata text-text-muted">
										{t("shell.phone.connected")}
									</span>
								) : null}
								<Button
									variant="ghost"
									tone="danger"
									size="s"
									data-testid={`phone-quick-revoke-${device.id}`}
									onClick={() => onRevoke(device.id)}
								>
									{t("shell.phone.disconnect")}
								</Button>
							</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="border-border-muted border-t px-4 py-4">
				<Button
					variant="ghost"
					size="m"
					className="w-full"
					data-testid="phone-quick-settings"
					onClick={onOpenSettings}
				>
					{t("shell.phone.allSettings")}
				</Button>
			</div>
		</div>
	);
}

/** Mounted only while the popover is open, so the status read and the pairing poll stop when it closes. */
function PhoneAccessPopoverBody({
	headingId,
	onStatus,
	onOpenSettings,
}: {
	headingId: string;
	onStatus: (status: RemoteAccessStatus) => void;
	onOpenSettings: () => void;
}) {
	const access = usePhoneAccess({ autoCode: true });
	useEffect(() => {
		if (access.status) onStatus(access.status);
	}, [access.status, onStatus]);
	return (
		<PhoneAccessPanel
			headingId={headingId}
			status={access.status}
			pairing={access.pairing}
			issuing={access.issuing}
			justPaired={access.justPaired}
			expired={access.expired}
			pending={access.pending}
			onToggle={access.toggle}
			onShowCode={access.showCode}
			onCopyLink={access.copyLink}
			onRevoke={access.revoke}
			onOpenSettings={onOpenSettings}
		/>
	);
}

/**
 * The topbar's phone-access shortcut: a QR icon (tinted while access is on) opening a quick panel to switch
 * the relay on or off without `--remote`, show a pairing QR at once, and disconnect paired phones. Renders
 * only against a host that speaks `remote.*`.
 */
export function PhoneAccessTopbar() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const connection = useAppStore((state) => state.status);
	const supported = protocolVersion !== null && protocolVersion >= REMOTE_ACCESS_PROTOCOL_VERSION;
	const [open, setOpen] = useState(false);
	const [enabled, setEnabled] = useState(false);
	const headingId = useId();
	const adoptStatus = useCallback((status: RemoteAccessStatus) => setEnabled(status.enabled), []);

	useEffect(() => {
		if (!supported || connection !== "connected") return;
		let current = true;
		getTransport()
			.request("remote.status", {})
			.then((status) => {
				if (current) setEnabled(status.enabled);
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [supported, connection]);

	if (!supported) return null;
	const label = enabled ? t("shell.phone.buttonOn") : t("shell.phone.button");

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<IconButton
					variant={enabled ? "soft-primary" : "ghost"}
					size="m"
					icon={RiQrCodeLine}
					label={label}
					tooltip={label}
					selected={open}
					data-testid="open-phone-access"
					data-active={enabled}
				/>
			</PopoverTrigger>
			<PopoverContent align="end" data-testid="phone-access-popover" aria-labelledby={headingId}>
				<PhoneAccessPopoverBody
					headingId={headingId}
					onStatus={adoptStatus}
					onOpenSettings={() => {
						setOpen(false);
						useAppStore.getState().openSettings(SettingsSection.Phone);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
