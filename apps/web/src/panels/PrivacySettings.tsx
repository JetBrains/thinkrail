import { selectAnalyticsConsentSupported, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { ANALYTICS_DESCRIPTION, AnalyticsPreferences } from "./AnalyticsPreferences";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";
import { useAnalyticsConsent } from "./useAnalyticsConsent";

export function PrivacySettings() {
	const supported = useAppStore(selectAnalyticsConsentSupported);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	if (protocolVersion === null) {
		return (
			<div data-testid="settings-privacy" className={SETTINGS_ROWS_CONTAINER}>
				<div className="flex items-center justify-between gap-12 border-border-muted border-b py-12">
					<span className="tr-text-ui text-text-default">Usage analytics</span>
					<span className="text-text-muted tr-text-metadata">Connect to the host to manage</span>
				</div>
			</div>
		);
	}
	return supported ? <AdditionalAnalyticsSettings /> : <LegacyPrivacySettings />;
}

function AdditionalAnalyticsSettings() {
	const enabled = useAppStore((s) => s.analyticsEnabled);
	const { pending, error, save } = useAnalyticsConsent();

	return (
		<div data-testid="settings-privacy" className={SETTINGS_ROWS_CONTAINER}>
			<div className="flex flex-col gap-2 pb-8">
				<h3 className="tr-title-section text-text-default">Usage analytics</h3>
				<p className="tr-text-metadata text-text-muted">{ANALYTICS_DESCRIPTION}</p>
			</div>
			<AnalyticsPreferences enabled={enabled} disabled={pending} onChange={save} />
			{error && (
				<p role="alert" className="tr-text-metadata text-feedback-error py-12">
					{error}
				</p>
			)}
		</div>
	);
}

function LegacyPrivacySettings() {
	const enabled = useAppStore((s) => s.analyticsEnabled);

	const setEnabled = (analyticsEnabled: boolean) => {
		getTransport()
			.request("settings.update", { config: { analyticsEnabled } })
			.catch(() => toast.error("Couldn't change the analytics setting"));
	};

	return (
		<div data-testid="settings-privacy" className={SETTINGS_ROWS_CONTAINER}>
			<div className="flex flex-col gap-2 pb-8">
				<h3 className="tr-title-section text-text-default">Usage analytics</h3>
				<p className="tr-text-metadata text-text-muted">{ANALYTICS_DESCRIPTION}</p>
			</div>
			<SettingsRow
				label="Share anonymous usage analytics"
				control={
					<SettingsSwitch
						checked={enabled}
						label="Share anonymous usage analytics"
						testId="analytics-toggle"
						onChange={setEnabled}
					/>
				}
			/>
		</div>
	);
}
