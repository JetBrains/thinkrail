export { type MicAvailability, micAvailability } from "./capture";
export { dictation, useDictationSnapshot } from "./dictation";
export { dictationShortcutLabel } from "./hotkey";
export { MicButton, type MicButtonProps, speechErrorKey } from "./MicButton";
export {
	DEFAULT_SPEECH_MODEL,
	type MicState,
	type MicUnavailableReason,
	micState,
} from "./micState";
export type {
	DictationError,
	DictationPhase,
	DictationScope,
	DictationSnapshot,
	DictationTarget,
} from "./session";
export { type DictationAnchor, dictationText, spokenText } from "./text";
