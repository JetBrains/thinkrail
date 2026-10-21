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
