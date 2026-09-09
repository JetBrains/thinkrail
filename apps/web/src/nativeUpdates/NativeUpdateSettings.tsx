import {
	RiDownloadCloud2Line as DownloadCloud,
	RiRefreshLine as Refresh,
	RiRestartLine as Restart,
} from "@remixicon/react";
import type { NativeUpdateState } from "@thinkrail/contracts";
import { Button } from "../components/ui/button";

interface NativeUpdateSettingsProps {
	state: NativeUpdateState | null;
	requestError: string | null;
	onCheck(): void;
	onRestart(): void;
	onLater(): void;
}

function statusCopy(state: NativeUpdateState | null): { title: string; detail: string } {
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

export function NativeUpdateSettings({
	state,
	requestError,
	onCheck,
	onRestart,
	onLater,
}: NativeUpdateSettingsProps) {
	const status = state?.status ?? "loading";
	const error = requestError ?? state?.error ?? null;
	const copy = statusCopy(state);
	const ready = status === "ready";
	const checking = status === "checking";
	const downloading = status === "downloading";
	const retry = status === "error" || error !== null;
	const checkLabel =
		status === "disabled" || status === "installing"
			? null
			: checking
				? "Checking…"
				: downloading
					? "Downloading…"
					: retry
						? "Retry"
						: ready
							? null
							: "Check for Updates";
	const progress =
		downloading && typeof state?.progress === "number" && Number.isFinite(state.progress)
			? Math.min(100, Math.max(0, state.progress))
			: null;
	const progressLabel = downloading
		? progress === null
			? "Downloading update…"
			: `Downloading update — ${Math.round(progress)}%`
		: null;
	const toneClass = error
		? "text-feedback-error"
		: ready
			? "text-primary"
			: checking || downloading || status === "installing"
				? "text-feedback-info"
				: "text-text-muted";

	return (
		<section data-testid="settings-updates" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Software updates</h3>
				<p className="text-text-muted tr-text-metadata">
					Updates download in the background and install only when you choose Restart to Update.
				</p>
			</div>

			<div
				data-testid="native-update-status"
				data-status={status}
				className="flex flex-col gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-12"
			>
				<div className="flex items-start gap-8">
					<DownloadCloud aria-hidden="true" className={`mt-2 size-16 shrink-0 ${toneClass}`} />
					<div className="min-w-0 flex-1">
						<p className="tr-title-compact text-text-default">
							{requestError ? "The update request failed" : copy.title}
						</p>
						<p className="text-text-muted tr-text-metadata">
							{requestError ? "Try the action again." : copy.detail}
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
					<p
						data-testid="native-update-error"
						role="alert"
						className="text-feedback-error tr-text-ui"
					>
						{error}
					</p>
				) : null}

				<div className="flex flex-wrap items-center justify-between gap-8 border-border-default border-t pt-8">
					<span data-testid="native-update-version" className="text-text-muted tr-text-metadata">
						{state
							? `Version ${state.version} · ${state.channel} channel`
							: "Version and channel unavailable"}
					</span>
					{state?.availableVersion ? (
						<span className="text-text-muted tr-text-metadata">
							Available: {state.availableVersion}
						</span>
					) : null}
				</div>
			</div>

			<div className="flex flex-wrap justify-end gap-8">
				{checkLabel ? (
					<Button
						variant="outline"
						data-testid="native-update-check"
						disabled={checking || downloading || (state === null && requestError === null)}
						onClick={onCheck}
					>
						<Refresh className="size-14" />
						{checkLabel}
					</Button>
				) : null}
				{ready ? (
					<>
						<Button variant="outline" data-testid="native-update-later" onClick={onLater}>
							Later
						</Button>
						<Button data-testid="native-update-restart" onClick={onRestart}>
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
