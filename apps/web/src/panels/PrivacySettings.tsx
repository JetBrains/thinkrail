import { useT } from "@thinkrail/locales/react";
import { selectAnalyticsConsentSupported, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { AnalyticsDescription, AnalyticsPreferences } from "./AnalyticsPreferences";
import { PrivacyPolicySentence } from "./PrivacyPolicyLink";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";
import { useAnalyticsConsent } from "./useAnalyticsConsent";

export function PrivacySettings() {
	const t = useT();
	const supported = useAppStore(selectAnalyticsConsentSupported);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	if (protocolVersion === null) {
		return (
			<div data-testid="settings-privacy" className={SETTINGS_ROWS_CONTAINER}>
				<div className="flex items-center justify-between gap-12 border-border-muted border-b py-12">
					<span className="tr-text-ui text-text-default">{t("settings.privacy.title")}</span>
					<span className="text-text-muted tr-text-metadata">
						{t("settings.privacy.connectToManage")}
					</span>
				</div>
				<p className="pt-12 tr-text-metadata text-text-muted">
					<PrivacyPolicySentence />
				</p>
			</div>
		);
	}
	return supported ? <AdditionalAnalyticsSettings /> : <LegacyPrivacySettings />;
}

function AdditionalAnalyticsSettings() {
	const t = useT();
	const enabled = useAppStore((s) => s.analyticsEnabled);
	const { pending, error, save } = useAnalyticsConsent();

	return (
		<div data-testid="settings-privacy" className={SETTINGS_ROWS_CONTAINER}>
			<div className="flex flex-col gap-2 pb-8">
				<h3 className="tr-title-section text-text-default">{t("settings.privacy.title")}</h3>
				<p className="tr-text-metadata text-text-muted">
					<AnalyticsDescription />
				</p>
			</div>
			<AnalyticsPreferences enabled={enabled} disabled={pending} onChange={save} />
			{error && (
				<p role="alert" className="tr-text-metadata text-feedback-error py-12">
					{error}
				</p>
			)}
			<p className="pt-12 tr-text-metadata text-text-muted">
				<PrivacyPolicySentence />
			</p>
		</div>
	);
}

function LegacyPrivacySettings() {
	const t = useT();
	const enabled = useAppStore((s) => s.analyticsEnabled);

	const setEnabled = (analyticsEnabled: boolean) => {
		getTransport()
			.request("settings.update", { config: { analyticsEnabled } })
			.catch(() => toast.error(t("settings.privacy.changeFailed")));
	};

	return (
		<div data-testid="settings-privacy" className={SETTINGS_ROWS_CONTAINER}>
			<div className="flex flex-col gap-2 pb-8">
				<h3 className="tr-title-section text-text-default">{t("settings.privacy.title")}</h3>
				<p className="tr-text-metadata text-text-muted">
					<AnalyticsDescription />
				</p>
			</div>
			<SettingsRow
				label={t("settings.privacy.share")}
				control={
					<SettingsSwitch
						checked={enabled}
						label={t("settings.privacy.share")}
						testId="analytics-toggle"
						onChange={setEnabled}
					/>
				}
			/>
			<p className="pt-12 tr-text-metadata text-text-muted">
				<PrivacyPolicySentence />
			</p>
		</div>
	);
}
