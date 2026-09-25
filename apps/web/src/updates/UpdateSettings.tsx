import {
	RiDownloadCloud2Line as DownloadCloud,
	RiRefreshLine as Refresh,
	RiRestartLine as Restart,
} from "@remixicon/react";
import type { HostUpdateNotice, NativeUpdateState } from "@thinkrail/contracts";
import { Button } from "../components/ui/button";
import type { NativeUpdateAction, UpdatesController } from "./useUpdates";

interface UpdateSettingsProps {
	updates: UpdatesController;
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
				title: "ThinkRail is up to date",
				detail: "ThinkRail checks for new releases in the background.",
			};
		case "checking":
			return { title: "Checking for updates", detail: "Looking for a newer release…" };
		case "available":
			return {
				title: state.availableVersion
					? `ThinkRail ${state.availableVersion} is available`
					: "An update is available",
				detail: "Download the update when you're ready.",
			};
		case "downloading":
			return {
				title: state.availableVersion
					? `Downloading ThinkRail ${state.availableVersion}`
					: "Downloading an update",
				detail: "You can keep working while the download finishes.",
			};
		case "preparing":
			return {
				title: "Preparing update",
				detail: "ThinkRail is preparing the downloaded package for installation.",
			};
		case "ready":
			return {
				title: state.availableVersion
					? `ThinkRail ${state.availableVersion} is ready`
					: "An update is ready",
				detail: "Install and restart when you're ready.",
			};
		case "installing":
			return {
				title: "Installing update",
				detail: "ThinkRail will restart to finish installing the update.",
			};
		case "error":
			return {
				title: "The update couldn't be completed",
				detail: "Try the failed action again when you're ready.",
			};
		default:
			return {
				title: "Loading update status",
				detail: "Reading this installation's update channel…",
			};
	}
}

function hostNoticeCopy(
	state: HostUpdateNotice,
	requestFailed: boolean,
): { title: string; detail: string } {
	if (requestFailed || state.status === "failed") {
		return {
			title: "The host update couldn't be completed",
			detail: "Retry the update or use the manual command below.",
		};
	}
	switch (state.status) {
		case "running":
			return {
				title: `Updating ThinkRail to ${state.availableVersion}`,
				detail: "The host remains available while the update runs.",
			};
		case "succeeded":
			return {
				title: `ThinkRail ${state.availableVersion} was installed`,
				detail: "Restart the host manually when you're ready to use the new version.",
			};
		default:
			return {
				title: `ThinkRail ${state.availableVersion} is available`,
				detail:
					state.status === "available"
						? "Run the update when you're ready. The host will keep running afterward."
						: "Update the CLI on the machine that is running this host.",
			};
	}
}

function publicChannel(channel: string | undefined): string | undefined {
	return channel === "canary" ? "nightly" : channel;
}

export function UpdateSettings({ updates }: UpdateSettingsProps) {
	const nativeState = updates.source === "native" ? updates.state : null;
	const hostNotice = updates.source === "host" ? updates.state : null;
	const nativeRequestError = updates.source === "native" ? updates.requestError : null;
	const hostRequestFailed = updates.source === "host" && updates.requestFailed;
	const nativeStatus = nativeState?.status ?? "loading";
	const hostStatus = hostNotice?.status;
	const error = nativeRequestError?.message ?? nativeState?.error ?? null;
	const failedAction: NativeUpdateAction | null =
		nativeRequestError?.action ?? nativeState?.failedPhase ?? null;
	const copy = hostNotice
		? hostNoticeCopy(hostNotice, hostRequestFailed)
		: nativeStatusCopy(nativeState);
	const ready = nativeState?.status === "ready";
	const nativeAvailable = nativeState?.status === "available";
	const hostAvailable =
		hostNotice !== null && (hostStatus === undefined || hostStatus === "available");
	const hostRunning = hostStatus === "running";
	const hostSucceeded = hostStatus === "succeeded";
	const hostFailed = hostStatus === "failed" || hostRequestFailed;
	const checking = nativeState?.status === "checking";
	const downloading = nativeState?.status === "downloading";
	const preparing = nativeState?.status === "preparing";
	const installing = nativeState?.status === "installing";
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
		: preparing
			? "Preparing update…"
			: hostRunning
				? "Running update…"
				: null;
	const toneClass =
		error || hostFailed
			? "text-feedback-error"
			: ready || nativeAvailable || hostAvailable || hostSucceeded
				? "text-primary"
				: checking || downloading || preparing || installing || hostRunning
					? "text-feedback-info"
					: "text-text-muted";
	const currentVersion = hostNotice?.currentVersion ?? nativeState?.version;
	const channel = hostNotice?.channel ?? publicChannel(nativeState?.channel);
	const availableVersion = hostNotice?.availableVersion ?? nativeState?.availableVersion;
	const retry =
		updates.source === "native" && failedAction
			? failedAction === "check"
				? updates.checkForUpdates
				: failedAction === "download"
					? updates.downloadUpdate
					: updates.restartToUpdate
			: null;
	const showHostManualGuidance =
		hostNotice !== null &&
		(hostStatus === undefined || hostStatus === "failed" || hostRequestFailed);

	return (
		<section data-testid="settings-updates" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Software updates</h3>
				<p className="text-text-muted tr-text-metadata">
					{updates.source === "native"
						? "ThinkRail checks for updates in the background. Downloads and installation begin only when you choose them."
						: "ThinkRail checks this host for new releases. Updates run on the machine hosting ThinkRail."}
				</p>
			</div>

			<div
				data-testid="update-status"
				data-source={updates.source}
				data-status={updates.source === "native" ? nativeStatus : (hostStatus ?? "legacy")}
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
							{...(downloading && progress !== null ? { value: progress } : {})}
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

				{showHostManualGuidance ? (
					<p
						data-testid="update-command-guidance"
						className="rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-8 text-text-default tr-text-ui"
					>
						Run <code className="tr-code-text text-primary">thinkrail update</code> on the machine
						running the host, then restart ThinkRail.
					</p>
				) : null}

				{hostSucceeded ? (
					<p
						data-testid="update-host-restart-guidance"
						className="rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-8 text-text-default tr-text-ui"
					>
						Restart the ThinkRail host manually to start using version {availableVersion}.
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

			{updates.source === "native" ? (
				<div className="flex flex-wrap justify-end gap-8">
					{updates.state.status === "idle" || checking ? (
						<Button
							variant="outline"
							data-testid="update-check"
							disabled={checking}
							onClick={updates.checkForUpdates}
						>
							<Refresh className="size-14" />
							{checking ? "Checking…" : "Check for Updates"}
						</Button>
					) : null}
					{retry ? (
						<Button variant="outline" data-testid="update-retry" onClick={retry}>
							<Refresh className="size-14" />
							Retry
						</Button>
					) : null}
					{nativeAvailable && failedAction !== "download" ? (
						<Button data-testid="update-download" onClick={updates.downloadUpdate}>
							<DownloadCloud className="size-14" />
							Download
						</Button>
					) : null}
					{ready && failedAction !== "install" ? (
						<Button data-testid="update-restart" onClick={updates.restartToUpdate}>
							<Restart className="size-14" />
							Install &amp; Restart
						</Button>
					) : null}
				</div>
			) : updates.canRun && (hostAvailable || hostFailed) ? (
				<div className="flex flex-wrap justify-end gap-8">
					<Button
						{...(hostFailed ? { variant: "outline" as const } : {})}
						data-testid={hostFailed ? "update-retry" : "update-run-host"}
						onClick={updates.runUpdate}
					>
						{hostFailed ? <Refresh className="size-14" /> : <DownloadCloud className="size-14" />}
						{hostFailed ? "Retry" : "Run Update"}
					</Button>
				</div>
			) : null}

			{ready ? (
				<p className="text-text-muted tr-text-metadata">
					Close Settings to install later. Quitting ThinkRail normally does not install the update.
				</p>
			) : null}
		</section>
	);
}
