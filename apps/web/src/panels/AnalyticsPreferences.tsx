import { RiShieldCheckLine as ShieldCheck } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { SettingsSwitch } from "./SettingsSwitch";

export function AnalyticsDescription() {
	const t = useT();
	return t("panels.analytics.description");
}

interface AnalyticsPreferenceProps {
	enabled: boolean;
	disabled: boolean;
	onChange: (enabled: boolean) => void;
}

export function AnalyticsSharingSwitch({
	enabled,
	disabled,
	onChange,
	description,
}: AnalyticsPreferenceProps & { description?: string }) {
	const t = useT();
	return (
		<div className="flex items-center justify-between gap-12 rounded-sm bg-control-bg px-12 py-8">
			<div className="flex flex-col gap-4">
				<span className="tr-title-compact text-text-default">
					{t("panels.analytics.shareLabel")}
				</span>
				{description && <span>{description}</span>}
			</div>
			<SettingsSwitch
				checked={enabled}
				disabled={disabled}
				label={t("panels.analytics.shareLabel")}
				testId="analytics-toggle"
				onChange={onChange}
			/>
		</div>
	);
}

export function AnalyticsPreferences(props: AnalyticsPreferenceProps) {
	const t = useT();
	return (
		<div className="flex flex-col gap-16 tr-text-metadata text-text-muted">
			<AnalyticsSharingSwitch {...props} description={t("panels.analytics.shareDescription")} />
			<p>{t("panels.analytics.reportDetails")}</p>
		</div>
	);
}

export function AnalyticsConsentChoice({ enabled, disabled, onChange }: AnalyticsPreferenceProps) {
	const t = useT();
	return (
		<div className="flex w-full flex-col rounded-sm border border-border-default bg-clip-padding bg-container-workspace-bg text-left">
			<div className="flex items-start gap-16 p-16">
				<div className="flex min-w-0 flex-1 flex-col gap-4">
					<span className="tr-title-card text-text-default">
						{t("panels.analytics.shareLabel")}
					</span>
					<span className="text-text-muted tr-text-metadata">
						{t("panels.analytics.shareDescription")}
					</span>
				</div>
				<SettingsSwitch
					checked={enabled}
					disabled={disabled}
					label={t("panels.analytics.shareLabel")}
					testId="analytics-toggle"
					onChange={onChange}
				/>
			</div>
			<p className="flex items-start gap-8 border-border-muted border-t px-16 py-12 text-text-muted tr-text-metadata">
				<ShieldCheck className="mt-2 size-14 shrink-0 text-feedback-success" />
				{t("panels.analyticsConsent.never")}
			</p>
		</div>
	);
}
