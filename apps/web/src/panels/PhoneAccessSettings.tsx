import { RiQrCodeLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SettingsGroup, SettingsPageContainer, SettingsRow } from "@thinkrail/ui/settings";
import { PhoneAccessNetwork } from "./PhoneAccessNetwork";
import { PhoneDeviceRow } from "./PhoneDeviceRow";
import { PhonePairingCode } from "./PhonePairingCode";
import { phoneHasNoRoute, phoneReach } from "./phoneAccessState";
import { SettingsNotice } from "./SettingsNotice";
import { SettingsSwitch } from "./SettingsSwitch";
import { type PhoneAccess, usePhoneAccess } from "./usePhoneAccess";

export type { ShownPairing } from "./usePhoneAccess";

export interface PhoneAccessViewProps {
	access: PhoneAccess;
}

export function PhoneAccessView({ access }: PhoneAccessViewProps) {
	const { status, loadFailed, pairing, issuing, expired, pending, busyDevices } = access;
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
							onChange={access.toggle}
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
									onClick={access.reload}
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
								onClick={access.showCode}
							>
								{pairing ? t("settings.phone.newCode") : t("settings.phone.showCode")}
							</Button>
						}
					/>
				) : null}
				{enabled && pairing ? (
					<PhonePairingCode
						layout="row"
						pairing={pairing}
						expired={expired}
						onCopyLink={access.copyLink}
					/>
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
							onRename={access.rename}
							onSetAccess={access.setAccess}
							onRevoke={access.revoke}
						/>
					))
				)}
			</SettingsGroup>
		</SettingsPageContainer>
	);
}

export function PhoneAccessSettings() {
	return <PhoneAccessView access={usePhoneAccess()} />;
}
