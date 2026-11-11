import type { MessageKey } from "@thinkrail/locales";
import type { MicBlockedReason, MicUnavailableReason } from "./micState";
import type { DictationError } from "./session";

export const UNAVAILABLE_LABEL = {
	"insecure-origin": "speech.mic.unavailable.insecureOrigin",
	"unsupported-browser": "speech.mic.unavailable.unsupportedBrowser",
	"unsupported-platform": "speech.mic.unavailable.unsupportedPlatform",
} as const satisfies Record<MicUnavailableReason, MessageKey>;

export const BLOCKED_LABEL = {
	denied: "speech.mic.blocked.denied",
	"no-device": "speech.mic.blocked.noDevice",
} as const satisfies Record<MicBlockedReason, MessageKey>;

const ERROR_MESSAGE = {
	SPEECH_UNSUPPORTED_PLATFORM: "speech.mic.unavailable.unsupportedPlatform",
	SPEECH_NOT_INSTALLED: "speech.error.notInstalled",
	SPEECH_INSTALL_BUSY: "speech.error.installBusy",
	SPEECH_DOWNLOAD_FAILED: "speech.error.downloadFailed",
	SPEECH_CHECKSUM_MISMATCH: "speech.error.checksumMismatch",
	SPEECH_DISK_SPACE: "speech.error.diskSpace",
	SPEECH_ENGINE_FAILED: "speech.error.engineFailed",
	SPEECH_BUSY: "speech.error.busy",
	SPEECH_PROTOCOL: "speech.error.engineFailed",
	denied: "speech.mic.blocked.denied",
	"no-device": "speech.mic.blocked.noDevice",
	failed: "speech.error.microphoneFailed",
} as const satisfies Record<DictationError, MessageKey>;

export function speechErrorKey(code: DictationError): MessageKey {
	return ERROR_MESSAGE[code];
}
