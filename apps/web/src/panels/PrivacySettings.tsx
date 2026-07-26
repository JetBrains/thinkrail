import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

/**
 * The "Privacy" settings section: the anonymous-usage-analytics toggle. Server-synced — flipping the
 * switch fires `settings.update { analyticsEnabled }` and the UI converges on the host's
 * `settings.changed` broadcast (no optimistic apply), the same pattern as the theme picker. Only this
 * boolean ever crosses the wire: events are emitted host-side and the anonymous install id never
 * leaves the host (see the server analytics module's spec).
 */
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
				<h3 className="font-medium text-md text-text">Usage analytics</h3>
				<p className="text-hint text-xs">
					Anonymous usage analytics help us understand which features matter. Your choice is saved
					on the host and follows you across devices.
				</p>
			</div>

			<div className="flex items-center justify-between gap-md rounded-[var(--radius-md)] border border-border2 px-md py-sm">
				<div className="flex flex-col gap-0.5">
					<span className="font-medium text-sm text-text">Share anonymous usage analytics</span>
					<span className="text-hint text-xs">
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
						enabled ? "bg-primary" : "bg-border2",
					)}
				>
					<span
						className={cn(
							"absolute top-0.5 left-0.5 size-4 rounded-full bg-bg transition-transform",
							enabled && "translate-x-4",
						)}
					/>
				</button>
			</div>

			<div className="flex flex-col gap-xs text-xs">
				<p className="text-muted">
					<span className="font-medium text-text">What is collected:</span> a random anonymous
					install id, app version and release channel, OS and architecture, when a chat starts (and
					the model/provider it uses), and which providers you sign in to. Custom providers and
					models are reported only as “custom”.
				</p>
				<p className="text-muted">
					<span className="font-medium text-text">Never collected:</span> file paths or names,
					prompts, code, chat transcripts, API keys, hostnames, usernames, or anything typed into
					the app.
				</p>
			</div>
		</section>
	);
}
