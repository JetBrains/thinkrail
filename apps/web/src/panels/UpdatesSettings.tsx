import { RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import type { ReleaseChannel } from "@thinkrail/contracts";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { selectUpdateBusy, selectUpdateFeatureAvailable, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsSwitch } from "./SettingsSwitch";
import { ToggleSegment } from "./ToggleSegment";

function lastCheckedLabel(at: number | undefined): string {
	if (!at) return "Not checked yet";
	const minutes = Math.round((Date.now() - at) / 60_000);
	if (minutes < 1) return "Checked just now";
	if (minutes < 60) return `Checked ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `Checked ${hours} hour${hours === 1 ? "" : "s"} ago`;
	return `Checked on ${new Date(at).toLocaleDateString()}`;
}

export function UpdatesSettings() {
	const status = useAppStore((s) => s.updateStatus);
	const supported = useAppStore(selectUpdateFeatureAvailable);
	const working = useAppStore(selectUpdateBusy);
	const checksEnabled = useAppStore((s) => s.updateChecksEnabled);
	const [pending, setPending] = useState(false);

	const track = (promise: Promise<unknown>, failure: string) => {
		setPending(true);
		promise.catch(() => toast.error(failure)).finally(() => setPending(false));
	};

	const check = () => track(getTransport().request("update.check", {}), "Couldn't check");

	const install = (channel: ReleaseChannel, version?: string) =>
		track(
			getTransport().request("update.install", { channel, ...(version ? { version } : {}) }),
			"Couldn't install the update",
		);

	const setChecksEnabled = (updateChecksEnabled: boolean) => {
		getTransport()
			.request("settings.update", { config: { updateChecksEnabled } })
			.catch(() => toast.error("Couldn't change the update setting"));
	};

	if (!status || !supported) {
		return (
			<section data-testid="settings-updates" className="flex flex-col gap-16">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Updates</h3>
					<p className="text-text-muted tr-text-metadata">
						This host does not report release information.
					</p>
				</div>
			</section>
		);
	}

	const { current, capabilities, phase, available, staged, error } = status;
	const busy = pending || working;

	return (
		<section data-testid="settings-updates" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">This build</h3>
				<p data-testid="update-current" className="text-text-muted tr-text-metadata">
					ThinkRail {current.version} · {current.channel}
					{current.commit ? ` · ${current.commit.slice(0, 7)}` : ""}
				</p>
				{capabilities.install ? null : (
					<p className="text-text-muted tr-text-metadata">
						Running from source — updates are installed by your checkout, not by the app.
					</p>
				)}
			</div>

			{capabilities.install ? (
				<div
					data-testid="update-state"
					data-phase={phase}
					className="flex flex-col gap-8 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8"
				>
					{staged ? (
						<>
							<span className="tr-title-compact text-text-default">
								ThinkRail {staged.version} is installed
							</span>
							<span data-testid="update-restart-hint" className="text-text-muted tr-text-metadata">
								Restart ThinkRail to finish the update — quit it and start it again the way you
								launched it.
							</span>
						</>
					) : available ? (
						<>
							<span className="tr-title-compact text-text-default">
								ThinkRail {available.version} is available
							</span>
							<div className="flex flex-wrap items-center gap-8">
								<Button
									data-testid="update-install"
									disabled={busy}
									onClick={() => install(available.channel, available.version)}
								>
									{phase === "installing" ? "Installing…" : "Install"}
								</Button>
								<a
									data-testid="update-notes"
									href={available.notesUrl}
									target="_blank"
									rel="noopener noreferrer"
									className={buttonVariants({ variant: "ghost", size: "sm" })}
								>
									<ExternalLink className="size-14" />
									What's new
								</a>
							</div>
						</>
					) : (
						<span className="tr-title-compact text-text-default">
							{phase === "checking"
								? "Checking for updates…"
								: working
									? "Update in progress…"
									: "ThinkRail is up to date"}
						</span>
					)}

					{error ? (
						<div className="flex flex-col gap-4">
							<span data-testid="update-error" className="text-feedback-warning tr-text-metadata">
								{error.message}
							</span>
							{error.command ? (
								<code className="rounded-[var(--radius-sm)] bg-container-elevated-bg px-8 py-4 text-text-muted tr-text-metadata">
									{error.command}
								</code>
							) : null}
						</div>
					) : null}

					<div className="flex flex-wrap items-center gap-8">
						<span className="text-text-muted tr-text-metadata">
							{lastCheckedLabel(status.lastCheckedAt)}
						</span>
						<Button
							data-testid="update-check"
							variant="ghost"
							size="sm"
							disabled={busy}
							onClick={check}
						>
							Check now
						</Button>
					</div>
				</div>
			) : null}

			{capabilities.channelSwitch === "in-app" && capabilities.channels.length > 1 ? (
				<div className="flex flex-col gap-8">
					<div className="flex flex-col gap-4">
						<h3 className="tr-title-section text-text-default">Release channel</h3>
						<p className="text-text-muted tr-text-metadata">
							Stable is released deliberately; nightly ships every day and is less tested. Switching
							installs the newest build of that channel — which can be older than the one you run
							now.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-8">
						{capabilities.channels.map((channel) => (
							<ToggleSegment
								key={channel}
								testid={`update-channel-${channel}`}
								label={channel === "stable" ? "Stable" : "Nightly"}
								active={current.channel === channel}
								disabled={busy}
								onClick={() => {
									if (current.channel !== channel) install(channel);
								}}
							/>
						))}
					</div>
				</div>
			) : null}

			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<div className="flex flex-col gap-2">
					<span className="tr-title-compact text-text-default">
						Check for updates automatically
					</span>
					<span className="text-text-muted tr-text-metadata">
						{checksEnabled
							? "On — ThinkRail asks GitHub for the newest release of your channel."
							: "Off — ThinkRail never checks on its own; Check now still works."}
					</span>
				</div>
				<SettingsSwitch
					checked={checksEnabled}
					label="Check for updates automatically"
					testId="update-checks-toggle"
					onChange={setChecksEnabled}
				/>
			</div>
		</section>
	);
}
