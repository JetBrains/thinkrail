import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function PrivacySettings() {
	const enabled = useAppStore((s) => s.analyticsEnabled);

	const toggle = () => {
		getTransport()
			.request("settings.update", { config: { analyticsEnabled: !enabled } })
			.catch(() => toast.error("Couldn't change the analytics setting"));
	};

	return (
		<section data-testid="settings-privacy" className="flex flex-col gap-lg">
			<div className="flex flex-col gap-xs">
				<h3 className="tr-title-section text-text-default">Usage analytics</h3>
				<p className="text-text-muted tr-text-metadata">
					Anonymous usage analytics help us understand which features matter. Your choice is saved
					on the host and follows you across devices.
				</p>
			</div>

			<div className="flex items-center justify-between gap-md rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-md py-sm">
				<div className="flex flex-col gap-0.5">
					<span className="tr-title-compact text-text-default">
						Share anonymous usage analytics
					</span>
					<span className="text-text-muted tr-text-metadata">
						{enabled ? "On — thank you for helping improve ThinkRail." : "Off — nothing is sent."}
					</span>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={enabled}
					aria-label="Share anonymous usage analytics"
					data-testid="analytics-toggle"
					data-active={enabled}
					onClick={toggle}
					className={cn(
						"relative h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
						enabled ? "bg-primary" : "bg-border-default",
					)}
				>
					<span
						className={cn(
							"absolute top-0.5 left-0.5 size-4 rounded-full bg-container-workspace-bg transition-transform",
							enabled && "translate-x-4",
						)}
					/>
				</button>
			</div>

			<div className="flex flex-col gap-xs tr-text-metadata">
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
