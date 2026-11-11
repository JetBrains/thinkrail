import type { SpeechEngineState, SpeechStatus } from "@thinkrail/contracts";

export type SpeechPublisher = (status: SpeechStatus) => void;

const INITIAL: SpeechStatus = {
	supported: false,
	install: { status: "not-installed" },
	runtime: null,
	engine: "stopped",
	diskBytes: 0,
	downloadBytes: { multilingual: 0, english: 0 },
};

let current: SpeechStatus = INITIAL;
let publish: SpeechPublisher | null = null;

export function setSpeechPublisher(fn: SpeechPublisher | null): void {
	publish = fn;
}

export function speechStatus(): SpeechStatus {
	return current;
}

export function updateSpeechStatus(patch: Partial<SpeechStatus>): void {
	current = { ...current, ...patch };
	publish?.(current);
}

export function setEngineState(engine: SpeechEngineState): void {
	if (current.engine === engine) return;
	updateSpeechStatus({ engine });
}

export function resetSpeechStatusForTests(): void {
	current = INITIAL;
	publish = null;
}
