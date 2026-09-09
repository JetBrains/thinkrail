import type { NativeUpdateState } from "@thinkrail/contracts";
import type { NativeUpdateControllerSnapshot } from "./controller";

export type NativeUpdateTone = "neutral" | "active" | "ready" | "error";

export interface NativeUpdatePresentation {
	status: NativeUpdateState["status"] | "loading";
	title: string;
	detail: string;
	versionLabel: string;
	availableVersion: string | null;
	progress: number | null;
	progressLabel: string | null;
	error: string | null;
	tone: NativeUpdateTone;
	checkLabel: string | null;
	checkDisabled: boolean;
	restartLabel: string | null;
	restartDisabled: boolean;
	showLater: boolean;
	ready: boolean;
}

function statusCopy(
	state: NativeUpdateState | null,
): Pick<NativeUpdatePresentation, "title" | "detail"> {
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

function toneFor(
	status: NativeUpdatePresentation["status"],
	error: string | null,
): NativeUpdateTone {
	if (error) return "error";
	if (status === "ready") return "ready";
	if (status === "checking" || status === "downloading" || status === "installing") {
		return "active";
	}
	return "neutral";
}

export function deriveNativeUpdatePresentation(
	snapshot: NativeUpdateControllerSnapshot,
): NativeUpdatePresentation {
	const { state, pendingAction, actionError } = snapshot;
	const status = state?.status ?? "loading";
	const stateError = state?.status === "error" ? state.error : null;
	const error = actionError ?? stateError;
	const progress =
		state?.status === "downloading" && state.progress !== null && Number.isFinite(state.progress)
			? Math.min(100, Math.max(0, state.progress))
			: null;
	const progressLabel =
		state?.status === "downloading"
			? progress === null
				? "Downloading update…"
				: `Downloading update — ${Math.round(progress)}%`
			: null;
	const copy = statusCopy(state);
	const ready = state?.status === "ready";
	const checking = pendingAction === "check" || state?.status === "checking";
	const downloading = state?.status === "downloading";
	const canOfferCheck =
		state?.status === "idle" || state?.status === "error" || (!state && actionError !== null);
	const checkLabel =
		ready || state?.status === "disabled" || state?.status === "installing"
			? null
			: checking
				? "Checking…"
				: downloading
					? "Downloading…"
					: error
						? "Retry"
						: "Check for Updates";
	return {
		status,
		title: actionError ? "The update request failed" : copy.title,
		detail: actionError ? "Try the action again." : copy.detail,
		versionLabel: state
			? `Version ${state.version} · ${state.channel} channel`
			: "Version and channel unavailable",
		availableVersion: state?.availableVersion ?? null,
		progress,
		progressLabel,
		error,
		tone: toneFor(status, error),
		checkLabel,
		checkDisabled: pendingAction !== null || !canOfferCheck,
		restartLabel: ready
			? pendingAction === "restart"
				? "Restarting…"
				: "Restart to Update"
			: null,
		restartDisabled: pendingAction !== null,
		showLater: ready,
		ready,
	};
}
