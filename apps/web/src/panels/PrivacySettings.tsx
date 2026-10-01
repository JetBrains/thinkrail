import { selectAnalyticsConsentSupported, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { ANALYTICS_DESCRIPTION, AnalyticsPreferences } from "./AnalyticsPreferences";
import { SettingsSwitch } from "./SettingsSwitch";
import { useAnalyticsConsent } from "./useAnalyticsConsent";

export function PrivacySettings() {
	const supported = useAppStore(selectAnalyticsConsentSupported);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	if (protocolVersion === null) {
		return (
			<section data-testid="settings-privacy" className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Usage analytics</h3>
				<p className="text-text-muted tr-text-metadata">Connect to the host to manage analytics.</p>
			</section>
		);
	}
	return supported ? <AdditionalAnalyticsSettings /> : <LegacyPrivacySettings />;
}

function AdditionalAnalyticsSettings() {
	const enabled = useAppStore((s) => s.analyticsEnabled);
	const { pending, error, save } = useAnalyticsConsent();

	return (
		<section data-testid="settings-privacy" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Usage analytics</h3>
				<p className="text-text-muted tr-text-metadata">{ANALYTICS_DESCRIPTION}</p>
			</div>
			<AnalyticsPreferences enabled={enabled} disabled={pending} onChange={save} />
			{error && (
				<p role="alert" className="tr-text-metadata text-feedback-error">
					{error}
				</p>
			)}
		</section>
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
		<section data-testid="settings-privacy" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Usage analytics</h3>
				<p className="text-text-muted tr-text-metadata">{ANALYTICS_DESCRIPTION}</p>
			</div>

			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<span className="tr-title-compact text-text-default">Share anonymous usage analytics</span>
				<SettingsSwitch
					checked={enabled}
					label="Share anonymous usage analytics"
					testId="analytics-toggle"
					onChange={setEnabled}
				/>
			</div>
		</section>
	);
}
