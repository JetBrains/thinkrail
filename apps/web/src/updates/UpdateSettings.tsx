import {
	RiDownloadCloud2Line as DownloadCloud,
	RiRefreshLine as Refresh,
	RiRestartLine as Restart,
} from "@remixicon/react";
import type { HostUpdateNotice, NativeUpdateState } from "@thinkrail/contracts";
import { Button } from "../components/ui/button";
import type { UpdatesController } from "./useUpdates";

interface UpdateSettingsProps {
	updates: UpdatesController;
	onLater(): void;
}

function nativeStatusCopy(state: NativeUpdateState | null): { title: string; detail: string } {
	switch (state?.status) {
		case "disabled":
			return {
				title: "Updates are unavailable",
				detail: "This native build is not connected to an update channel.",
			};
		case "idle":
			return {
				title: "Updates are on",
				detail: "ThinkRail checks and downloads updates in the background.",
			};
		case "checking":
			return { title: "Checking for updates", detail: "Looking for a newer release…" };
		case "downloading":
			return {
				title: state.availableVersion
					? `Downloading ThinkRail ${state.availableVersion}`
					: "Downloading an update",
				detail: "You can keep working while the download finishes.",
			};
		case "ready":
			return {
				title: state.availableVersion
					? `ThinkRail ${state.availableVersion} is ready`
					: "An update is ready",
				detail: "Restart when you're ready to install it.",
			};
		case "installing":
			return {
				title: "Restarting to update",
				detail: "ThinkRail will reopen after the update is installed.",
			};
		case "error":
			return {
				title: "The update couldn't be completed",
				detail: "Try again when you're ready.",
			};
		default:
			return {
				title: "Loading update status",
				detail: "Reading this installation's update channel…",
			};
	}
}

function hostNoticeCopy(state: HostUpdateNotice): { title: string; detail: string } {
	return {
		title: `ThinkRail ${state.availableVersion} is available`,
		detail: "Update the CLI on the machine that is running this host.",
	};
}

export function UpdateSettings({ updates, onLater }: UpdateSettingsProps) {
	const nativeState = updates.source === "native" ? updates.state : null;
	const hostNotice = updates.source === "host" ? updates.state : null;
	const nativeRequestError = updates.source === "native" ? updates.requestError : null;
	const nativeStatus = nativeState?.status ?? "loading";
	const error = nativeRequestError ?? nativeState?.error ?? null;
	const copy = hostNotice ? hostNoticeCopy(hostNotice) : nativeStatusCopy(nativeState);
	const ready = nativeState?.status === "ready";
	const available = hostNotice !== null;
	const checking = nativeState?.status === "checking";
	const downloading = nativeState?.status === "downloading";
	const retry = nativeState?.status === "error" || error !== null;
	const checkLabel =
		updates.source === "native"
			? nativeStatus === "disabled" || nativeStatus === "installing"
				? null
				: checking
					? "Checking…"
					: downloading
						? "Downloading…"
						: retry
							? "Retry"
							: ready
								? null
								: "Check for Updates"
			: null;
	const progress =
		downloading &&
		typeof nativeState?.progress === "number" &&
		Number.isFinite(nativeState.progress)
			? Math.min(100, Math.max(0, nativeState.progress))
			: null;
	const progressLabel = downloading
		? progress === null
			? "Downloading update…"
			: `Downloading update — ${Math.round(progress)}%`
		: null;
	const toneClass = error
		? "text-feedback-error"
		: ready || available
			? "text-primary"
			: checking || downloading || nativeStatus === "installing"
				? "text-feedback-info"
				: "text-text-muted";
	const currentVersion = hostNotice?.currentVersion ?? nativeState?.version;
	const channel = hostNotice?.channel ?? nativeState?.channel;
	const availableVersion = hostNotice?.availableVersion ?? nativeState?.availableVersion;

	return (
		<section data-testid="settings-updates" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Software updates</h3>
				<p className="text-text-muted tr-text-metadata">
					{updates.source === "native"
						? "Updates download in the background and install only when you choose Restart to Update."
						: "ThinkRail checks this host for new releases. Install updates from the machine running the host."}
				</p>
			</div>

			<div
				data-testid="update-status"
				data-source={updates.source}
				data-status={updates.source === "native" ? nativeStatus : undefined}
				className="flex flex-col gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-12"
			>
				<div className="flex items-start gap-8">
					<DownloadCloud aria-hidden="true" className={`mt-2 size-16 shrink-0 ${toneClass}`} />
					<div className="min-w-0 flex-1">
						<p className="tr-title-compact text-text-default">
							{nativeRequestError ? "The update request failed" : copy.title}
						</p>
						<p className="text-text-muted tr-text-metadata">
							{nativeRequestError ? "Try the action again." : copy.detail}
						</p>
					</div>
				</div>

				{progressLabel ? (
					<div className="flex flex-col gap-4">
						<progress
							max={100}
							{...(progress === null ? {} : { value: progress })}
							aria-label={progressLabel}
							className="h-4 w-full accent-primary"
						/>
						<span className="text-text-muted tr-text-metadata">{progressLabel}</span>
					</div>
				) : null}

				{error ? (
					<p data-testid="update-error" role="alert" className="text-feedback-error tr-text-ui">
						{error}
					</p>
				) : null}

				{hostNotice ? (
					<p
						data-testid="update-command-guidance"
						className="rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-8 text-text-default tr-text-ui"
					>
						Run <code className="tr-code-text text-primary">thinkrail update</code> on the machine
						running the host, then restart ThinkRail.
					</p>
				) : null}

				<div className="flex flex-wrap items-center justify-between gap-8 border-border-default border-t pt-8">
					<span data-testid="update-version" className="text-text-muted tr-text-metadata">
						{currentVersion && channel
							? updates.source === "host"
								? `Current: ${currentVersion} · ${channel} channel`
								: `Version ${currentVersion} · ${channel} channel`
							: "Version and channel unavailable"}
					</span>
					{availableVersion ? (
						<span className="text-text-muted tr-text-metadata">Available: {availableVersion}</span>
					) : null}
				</div>
			</div>

			<div className="flex flex-wrap justify-end gap-8">
				{checkLabel && updates.source === "native" ? (
					<Button
						variant="outline"
						data-testid="update-check"
						disabled={
							checking || downloading || (nativeState === null && nativeRequestError === null)
						}
						onClick={updates.checkForUpdates}
					>
						<Refresh className="size-14" />
						{checkLabel}
					</Button>
				) : null}
				{ready && updates.source === "native" ? (
					<>
						<Button variant="outline" data-testid="update-later" onClick={onLater}>
							Later
						</Button>
						<Button data-testid="update-restart" onClick={updates.restartToUpdate}>
							<Restart className="size-14" />
							Restart to Update
						</Button>
					</>
				) : null}
			</div>

			{ready ? (
				<p className="text-text-muted tr-text-metadata">
					Later keeps this update ready. Quitting ThinkRail normally does not install it.
				</p>
			) : null}
		</section>
	);
}
