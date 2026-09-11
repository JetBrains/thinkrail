import { SettingsSwitch } from "./SettingsSwitch";

export const ANALYTICS_DESCRIPTION =
	"Basic reporting is always on. You choose whether to share additional usage data.";

export function AnalyticsPreferences({
	enabled,
	disabled,
	onChange,
}: {
	enabled: boolean;
	disabled: boolean;
	onChange: (enabled: boolean) => void;
}) {
	return (
		<div className="flex flex-col gap-16 tr-text-metadata text-text-muted">
			<p>
				<span className="tr-text-emphasis text-text-default">Always-on basics:</span> app launches,
				chat starts (provider and model), message sends (mode), and provider connections.
			</p>
			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<div className="flex flex-col gap-4">
					<span className="tr-title-compact text-text-default">Share additional usage data</span>
					<span>Setup, agent runs, task completions, reviews, and pull-request outcomes.</span>
				</div>
				<SettingsSwitch
					checked={enabled}
					disabled={disabled}
					label="Share additional usage data"
					testId="analytics-toggle"
					onChange={onChange}
				/>
			</div>
			<p>
				Reports use a random installation ID, app type, version and channel, OS, and architecture.
				Custom providers and models are labeled “custom”. No prompts, code, transcripts, file paths,
				credentials, or recordings.
			</p>
		</div>
	);
}
