import type { SpeechErrorCode, SpeechModel, SpeechStatus } from "@thinkrail/contracts";
import type { MicAvailability } from "./capture";

export type MicUnavailableReason =
	| "insecure-origin"
	| "unsupported-browser"
	| "unsupported-platform";

export type MicBlockedReason = "denied" | "no-device";

export type MicState =
	| { kind: "hidden" }
	| { kind: "unavailable"; reason: MicUnavailableReason }
	| { kind: "blocked"; reason: MicBlockedReason }
	| { kind: "offer"; model: SpeechModel; downloadBytes: number; failed: SpeechErrorCode | null }
	| { kind: "installing"; receivedBytes: number; totalBytes: number }
	| { kind: "ready" };

export const DEFAULT_SPEECH_MODEL: SpeechModel = "multilingual";

export function micState(
	status: SpeechStatus | null,
	availability: MicAvailability,
	microphoneBlocked: MicBlockedReason | null,
): MicState {
	if (!status) return { kind: "hidden" };
	if (!status.supported) return { kind: "unavailable", reason: "unsupported-platform" };
	if (availability === "insecure-origin") return { kind: "unavailable", reason: "insecure-origin" };
	if (availability === "unsupported") return { kind: "unavailable", reason: "unsupported-browser" };
	const install = status.install;
	if (install.status === "installing") {
		return {
			kind: "installing",
			receivedBytes: install.receivedBytes,
			totalBytes: install.totalBytes,
		};
	}
	if (install.status === "ready" || (install.status === "failed" && install.usable)) {
		return microphoneBlocked ? { kind: "blocked", reason: microphoneBlocked } : { kind: "ready" };
	}
	const model = install.status === "failed" ? install.model : DEFAULT_SPEECH_MODEL;
	return {
		kind: "offer",
		model,
		downloadBytes: status.downloadBytes[model],
		failed: install.status === "failed" ? install.code : null,
	};
}
