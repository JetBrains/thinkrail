import { RiFileCopyLine, RiQrCodeLine } from "@remixicon/react";
import type { RemoteAccessStatus, RemoteDeviceAccess } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SettingsGroup, SettingsPageContainer, SettingsRow } from "@thinkrail/ui/settings";
import { PhoneAccessNetwork } from "./PhoneAccessNetwork";
import { PhoneDeviceRow } from "./PhoneDeviceRow";
import { phoneHasNoRoute, phoneReach } from "./phoneAccessState";
import { SettingsNotice } from "./SettingsNotice";
import { SettingsSwitch } from "./SettingsSwitch";
import { type ShownPairing, usePhoneAccess } from "./usePhoneAccess";

export type { ShownPairing } from "./usePhoneAccess";

export interface PhoneAccessViewProps {
	status: RemoteAccessStatus | null;
	loadFailed: boolean;
	pairing: ShownPairing | null;
	issuing: boolean;
	expired: boolean;
	pending: boolean;
	busyDevices: ReadonlySet<string>;
	onReload: () => void;
	onToggle: (enabled: boolean) => void;
	onShowCode: () => void;
	onCopyLink: (link: string) => void;
	onRevoke: (deviceId: string) => void;
	onRename: (deviceId: string, label: string) => void;
	onSetAccess: (deviceId: string, access: RemoteDeviceAccess) => void;
}

function clockTime(epochMs: number): string {
	return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function PhoneAccessView({
	status,
	loadFailed,
	pairing,
	issuing,
	expired,
	pending,
	busyDevices,
	onReload,
	onToggle,
	onShowCode,
	onCopyLink,
	onRevoke,
	onRename,
	onSetAccess,
}: PhoneAccessViewProps) {
	const t = useT();
	const enabled = status?.enabled ?? false;
	const devices = status?.devices ?? [];
	const reach = phoneReach(status);

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
				{loadFailed ? (
					<div className="border-border-muted border-b py-12">
						<SettingsNotice
							variant="error"
							testId="phone-access-load-failed"
							action={
								<Button
									variant="outline"
									size="m"
									data-testid="phone-access-reload"
									onClick={onReload}
								>
									{t("common.retry")}
								</Button>
							}
						>
							{t("settings.phone.loadFailed")}
						</SettingsNotice>
					</div>
				) : null}
				{enabled && phoneHasNoRoute(status) ? (
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
								loading={issuing}
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
			{reach ? <PhoneAccessNetwork reach={reach} /> : null}
			<SettingsGroup title={t("settings.phone.devices")} testId="phone-access-devices">
				{status === null ? (
					loadFailed ? null : (
						<p
							data-testid="phone-access-loading"
							className="py-12 tr-text-metadata text-text-muted"
						>
							{t("common.loading")}
						</p>
					)
				) : devices.length === 0 ? (
					<p className="py-12 tr-text-metadata text-text-muted">{t("settings.phone.noDevices")}</p>
				) : (
					devices.map((device) => (
						<PhoneDeviceRow
							key={device.id}
							device={device}
							busy={busyDevices.has(device.id)}
							onRename={onRename}
							onSetAccess={onSetAccess}
							onRevoke={onRevoke}
						/>
					))
				)}
			</SettingsGroup>
		</SettingsPageContainer>
	);
}

export function PhoneAccessSettings() {
	const access = usePhoneAccess();
	return (
		<PhoneAccessView
			status={access.status}
			loadFailed={access.loadFailed}
			pairing={access.pairing}
			issuing={access.issuing}
			expired={access.expired}
			pending={access.pending}
			busyDevices={access.busyDevices}
			onReload={access.reload}
			onToggle={access.toggle}
			onShowCode={access.showCode}
			onCopyLink={access.copyLink}
			onRevoke={access.revoke}
			onRename={access.rename}
			onSetAccess={access.setAccess}
		/>
	);
}
