import type {
	NativeUpdateInstallResult,
	NativeUpdateInstallStep,
	NativeUpdateLogEntry,
	NativeUpdateState,
} from "@thinkrail/contracts";

export const INSTALL_STEPS = [
	{ key: "prepared", label: "Update downloaded and prepared" },
	{ key: "stopping", label: "Stopping agents and terminals" },
	{ key: "handoff", label: "Handing off to the installer" },
	{ key: "restarting", label: "Closing ThinkRail, then reopening the new version" },
] as const;

export function installStepIndex(step: NativeUpdateInstallStep | null): number {
	const index = INSTALL_STEPS.findIndex((candidate) => candidate.key === step);
	return index < 0 ? 1 : index;
}

export function installProgress(step: NativeUpdateInstallStep | null): number {
	return Math.round(((installStepIndex(step) + 0.5) / INSTALL_STEPS.length) * 100);
}

export interface InstallFailureCopy {
	cause: string;
	advice: string;
}

export function installFailureCopy(
	result: Pick<NativeUpdateInstallResult, "outcome" | "failedStep" | "detail">,
): InstallFailureCopy {
	if (result.outcome === "unreported") {
		return {
			cause: "The installer didn't report a result",
			advice:
				"ThinkRail closed to install the update, but the installer never reported back. It may have been stopped or blocked. Try again.",
		};
	}
	switch (result.failedStep) {
		case "swapping":
			return /access\s*denied/i.test(result.detail ?? "")
				? {
						cause: "Another program is using ThinkRail's install folder",
						advice:
							"The installer couldn't replace ThinkRail while another program held its folder open. This is usually a background program started from ThinkRail, such as an editor or the JetBrains Central proxy. Close it and try again.",
					}
				: {
						cause: "The installer couldn't replace ThinkRail's files",
						advice:
							"Check that ThinkRail's install folder isn't read-only or locked by another program, then try again.",
					};
		case "validating":
		case "validating_payload":
			return {
				cause: "The downloaded update was invalid",
				advice: "The package didn't pass the installer's checks. Download it again and retry.",
			};
		case "extracting":
			return {
				cause: "The update couldn't be unpacked",
				advice: "Make sure there is enough free disk space, then try again.",
			};
		case "waiting_for_parent":
			return {
				cause: "ThinkRail took too long to close",
				advice: "The installer stopped waiting for ThinkRail to exit. Try again.",
			};
		case "integrating":
			return {
				cause: "The new version couldn't be registered",
				advice:
					"The update was unpacked, but its shortcuts or uninstall entry couldn't be updated, so the installer restored the previous version.",
			};
		case "launching":
			return {
				cause: "The new version didn't start",
				advice: "The installer restored the previous version after the new one failed to start.",
			};
		default:
			return {
				cause: "The installer couldn't finish",
				advice: "The installer stopped and restored the previous version. Try again.",
			};
	}
}

export type InstallRecovery =
	| { kind: "install" | "download" | "check"; label: string; detail: string | null }
	| { kind: "pending"; label: string; detail: null };

export function installRecovery(state: NativeUpdateState): InstallRecovery | null {
	switch (state.status) {
		case "ready":
			return {
				kind: "install",
				label: "Try again",
				detail: state.availableVersion ? `Installs ThinkRail ${state.availableVersion}.` : null,
			};
		case "available":
			return {
				kind: "download",
				label: "Download again",
				detail: state.availableVersion ? `Downloads ThinkRail ${state.availableVersion}.` : null,
			};
		case "idle":
		case "error":
			return { kind: "check", label: "Check again", detail: null };
		case "checking":
			return { kind: "pending", label: "Checking for updates…", detail: null };
		case "downloading":
			return {
				kind: "pending",
				label:
					typeof state.progress === "number"
						? `Downloading ${Math.round(state.progress)}%`
						: "Downloading…",
				detail: null,
			};
		case "preparing":
			return { kind: "pending", label: "Preparing update…", detail: null };
		default:
			return null;
	}
}

export function releaseNotesUrl(version: string): string {
	return `https://github.com/JetBrains/thinkrail/releases/tag/v${encodeURIComponent(version)}`;
}

function twoDigits(value: number): string {
	return String(value).padStart(2, "0");
}

export function logTime(at: number): string {
	const date = new Date(at);
	return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
}

export function formatInstallLog(entries: readonly NativeUpdateLogEntry[]): string {
	return entries
		.map((entry) => `${logTime(entry.at)} ${entry.source.padEnd(9)} ${entry.text}`)
		.join("\n");
}
