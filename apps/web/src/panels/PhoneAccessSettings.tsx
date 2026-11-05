import { RiFileCopyLine, RiQrCodeLine, RiSmartphoneLine } from "@remixicon/react";
import type { RemoteAccessStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SettingsGroup, SettingsPageContainer, SettingsRow } from "@thinkrail/ui/settings";
import { PhoneAccessNetwork } from "./PhoneAccessNetwork";
import { phoneReach } from "./phoneAccessState";
import { SettingsNotice } from "./SettingsNotice";
import { SettingsSwitch } from "./SettingsSwitch";
import { type ShownPairing, usePhoneAccess } from "./usePhoneAccess";

export type { ShownPairing } from "./usePhoneAccess";

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
			{reach ? <PhoneAccessNetwork reach={reach} /> : null}
			<SettingsGroup title={t("settings.phone.devices")} testId="phone-access-devices">
				{devices.length === 0 ? (
					<p className="py-12 tr-text-metadata text-text-muted">{t("settings.phone.noDevices")}</p>
				) : (
					devices.map((device) => (
						<div
							key={device.id}
							data-testid={`phone-access-device-${device.id}`}
							data-connected={device.connected}
							className="flex items-center gap-8 border-border-muted border-b py-12"
						>
							<RiSmartphoneLine className="size-14 shrink-0 text-text-muted" />
							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<span className="truncate tr-text-ui text-text-default">{device.label}</span>
								<span className="tr-text-metadata text-text-muted">
									{device.connected ? (
										<span className="text-feedback-success">
											{t("settings.phone.connectedNow")}
											{" · "}
										</span>
									) : null}
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
	const access = usePhoneAccess();
	return (
		<PhoneAccessView
			status={access.status}
			pairing={access.pairing}
			expired={access.expired}
			pending={access.pending}
			onToggle={access.toggle}
			onShowCode={access.showCode}
			onCopyLink={access.copyLink}
			onRevoke={access.revoke}
		/>
	);
}
