import type {
	NativeUpdateInstallResult,
	NativeUpdateInstallStep,
	NativeUpdateLogEntry,
	NativeUpdateState,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";

export const INSTALL_STEPS = [
	{ key: "prepared", labelKey: "updates.install.step.prepared" },
	{ key: "stopping", labelKey: "updates.install.step.stopping" },
	{ key: "handoff", labelKey: "updates.install.step.handoff" },
	{ key: "restarting", labelKey: "updates.install.step.restarting" },
] as const satisfies readonly { key: string; labelKey: MessageKey }[];

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

const FAILURE_CAUSES = {
	unreported: ["updates.cause.unreported.title", "updates.cause.unreported.advice"],
	folderInUse: ["updates.cause.folderInUse.title", "updates.cause.folderInUse.advice"],
	swapFailed: ["updates.cause.swapFailed.title", "updates.cause.swapFailed.advice"],
	invalidPackage: ["updates.cause.invalidPackage.title", "updates.cause.invalidPackage.advice"],
	unpackFailed: ["updates.cause.unpackFailed.title", "updates.cause.unpackFailed.advice"],
	closeTimeout: ["updates.cause.closeTimeout.title", "updates.cause.closeTimeout.advice"],
	registerFailed: ["updates.cause.registerFailed.title", "updates.cause.registerFailed.advice"],
	launchFailed: ["updates.cause.launchFailed.title", "updates.cause.launchFailed.advice"],
	unknown: ["updates.cause.unknown.title", "updates.cause.unknown.advice"],
} as const satisfies Record<string, readonly [MessageKey, MessageKey]>;

export type InstallFailureCause = keyof typeof FAILURE_CAUSES;

export function installFailureCause(
	result: Pick<NativeUpdateInstallResult, "outcome" | "failedStep" | "detail">,
): InstallFailureCause {
	if (result.outcome === "unreported") return "unreported";
	switch (result.failedStep) {
		case "swapping":
			return /access\s*denied/i.test(result.detail ?? "") ? "folderInUse" : "swapFailed";
		case "validating":
		case "validating_payload":
			return "invalidPackage";
		case "extracting":
			return "unpackFailed";
		case "waiting_for_parent":
			return "closeTimeout";
		case "integrating":
			return "registerFailed";
		case "launching":
			return "launchFailed";
		default:
			return "unknown";
	}
}

export function installFailureCopy(
	t: Translator,
	result: Pick<NativeUpdateInstallResult, "outcome" | "failedStep" | "detail">,
): InstallFailureCopy {
	const [cause, advice] = FAILURE_CAUSES[installFailureCause(result)];
	return { cause: t(cause), advice: t(advice) };
}

export type InstallRecovery =
	| { kind: "install" | "download" | "check"; label: string; detail: string | null }
	| { kind: "pending"; label: string; detail: null };

export function installRecovery(t: Translator, state: NativeUpdateState): InstallRecovery | null {
	const version = state.availableVersion;
	switch (state.status) {
		case "ready":
			return {
				kind: "install",
				label: t("updates.recovery.install"),
				detail: version ? t("updates.recovery.installDetail", { version }) : null,
			};
		case "available":
			return {
				kind: "download",
				label: t("updates.recovery.download"),
				detail: version ? t("updates.recovery.downloadDetail", { version }) : null,
			};
		case "idle":
		case "error":
			return { kind: "check", label: t("updates.recovery.check"), detail: null };
		case "checking":
			return { kind: "pending", label: t("updates.recovery.checking"), detail: null };
		case "downloading":
			return {
				kind: "pending",
				label:
					typeof state.progress === "number"
						? t("updates.recovery.downloadingPercent", { percent: Math.round(state.progress) })
						: t("updates.recovery.downloading"),
				detail: null,
			};
		case "preparing":
			return { kind: "pending", label: t("updates.recovery.preparing"), detail: null };
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
