import { RiShieldCheckLine as ShieldCheck } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";

interface AnalyticsPreferenceProps {
	enabled: boolean;
	disabled: boolean;
	onChange: (enabled: boolean) => void;
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
				<Switch
					checked={enabled}
					disabled={disabled}
					label={t("panels.analytics.shareLabel")}
					testId="analytics-toggle"
					tabIndex={0}
					onCheckedChange={onChange}
				/>
			</div>
			<p className="flex items-start gap-8 border-border-muted border-t px-16 py-12 text-text-muted tr-text-metadata">
				<ShieldCheck className="mt-2 size-14 shrink-0 text-feedback-success" />
				{t("panels.analyticsConsent.never")}
			</p>
		</div>
	);
}
