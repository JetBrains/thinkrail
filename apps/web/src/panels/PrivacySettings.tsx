import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";
import type { ReactNode } from "react";
import { SettingsGroup, SettingsPage, SettingsRow } from "@/settingsKit";
import { selectAnalyticsConsentSupported, useAppStore } from "@/store";
import { saveSettings } from "./saveSettings";
import { isConfigDefault } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";
import { useAnalyticsConsent } from "./useAnalyticsConsent";

function PrivacyPage({ children }: { children: ReactNode }) {
	const t = useT();
	return (
		<SettingsPage
			title={t("settings.nav.privacy")}
			description={t("panels.analytics.description")}
			testId="settings-privacy"
		>
			<SettingsGroup title={t("settings.privacy.title")}>{children}</SettingsGroup>
		</SettingsPage>
	);
}

export function PrivacySettings() {
	const t = useT();
	const supported = useAppStore(selectAnalyticsConsentSupported);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	if (protocolVersion === null) {
		return (
			<PrivacyPage>
				<SettingsRow
					{...settingProps(t, SETTING.usageAnalytics)}
					description={t("settings.privacy.connectToManage")}
				/>
			</PrivacyPage>
		);
	}
	return supported ? <AdditionalAnalyticsSettings /> : <LegacyPrivacySettings />;
}

function AdditionalAnalyticsSettings() {
	const t = useT();
	const enabled = useAppStore((s) => s.analyticsEnabled);
	const { pending, error, save } = useAnalyticsConsent();

	return (
		<PrivacyPage>
			<SettingsRow
				{...settingProps(t, SETTING.usageAnalytics)}
				reset={{
					changed: !isConfigDefault("analyticsEnabled", enabled),
					onReset: () => void save(DEFAULT_CONFIG.analyticsEnabled),
					disabled: pending,
				}}
				control={
					<Switch
						checked={enabled}
						disabled={pending}
						label={t(SETTING.usageAnalytics.label)}
						testId="analytics-toggle"
						tabIndex={0}
						onCheckedChange={(next) => void save(next)}
					/>
				}
			/>
			<p className="py-12 text-text-muted tr-text-metadata">
				{t("panels.analytics.reportDetails")}
			</p>
			{error ? (
				<p role="alert" className="pb-12 text-feedback-error tr-text-metadata">
					{error}
				</p>
			) : null}
		</PrivacyPage>
	);
}

function LegacyPrivacySettings() {
	const t = useT();
	const enabled = useAppStore((s) => s.analyticsEnabled);
	const label = t("settings.privacy.share");

	const setEnabled = (analyticsEnabled: boolean) => {
		void saveSettings({ analyticsEnabled }, t("settings.privacy.changeFailed"));
	};

	return (
		<PrivacyPage>
			<SettingsRow
				settingId={SETTING.usageAnalytics.id}
				label={label}
				reset={{
					changed: !isConfigDefault("analyticsEnabled", enabled),
					onReset: () => setEnabled(DEFAULT_CONFIG.analyticsEnabled),
				}}
				control={
					<Switch
						checked={enabled}
						label={label}
						testId="analytics-toggle"
						tabIndex={0}
						onCheckedChange={setEnabled}
					/>
				}
			/>
		</PrivacyPage>
	);
}
