import { useSyncExternalStore } from "react";
import { openSpeechSocket } from "@/transport";
import { startCapture } from "./capture";
import { createDictationController, type DictationSnapshot } from "./session";

/** The page's one dictation controller: a second field starting ends the first. */
export const dictation = createDictationController({ openSocket: openSpeechSocket, startCapture });

export function useDictationSnapshot(): DictationSnapshot {
	return useSyncExternalStore(dictation.subscribe, dictation.snapshot);
}
