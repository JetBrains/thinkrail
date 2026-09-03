import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsSwitch } from "./SettingsSwitch";

export function PrivacySettings() {
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
				<p className="text-text-muted tr-text-metadata">
					Anonymous usage analytics help us understand which features matter. Your choice is saved
					on the host and follows you across devices.
				</p>
			</div>

			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<div className="flex flex-col gap-2">
					<span className="tr-title-compact text-text-default">
						Share anonymous usage analytics
					</span>
					<span className="text-text-muted tr-text-metadata">
						{enabled ? "On — thank you for helping improve ThinkRail." : "Off — nothing is sent."}
					</span>
				</div>
				<SettingsSwitch
					checked={enabled}
					label="Share anonymous usage analytics"
					testId="analytics-toggle"
					onChange={setEnabled}
				/>
			</div>

			<div className="flex flex-col gap-4 tr-text-metadata">
				<p className="text-text-muted">
					<span className="tr-text-emphasis text-text-default">What is collected:</span> a random
					anonymous install id, app version and release channel, OS and architecture, when a chat
					starts (and the model/provider it uses), and which providers you sign in to. Custom
					providers and models are reported only as “custom”.
				</p>
				<p className="text-text-muted">
					<span className="tr-text-emphasis text-text-default">Never collected:</span> file paths or
					names, prompts, code, chat transcripts, API keys, hostnames, usernames, or anything typed
					into the app.
				</p>
			</div>
		</section>
	);
}
