import {
	parseSpeechServerMessage,
	type SpeechClientMessage,
	type SpeechErrorCode,
} from "@thinkrail/contracts";
import {
	type Capture,
	CaptureFailure,
	type CaptureFailureReason,
	type CaptureSink,
} from "./captureTypes";
import { type DictationAnchor, dictationText, spokenText } from "./text";

export type DictationPhase = "idle" | "connecting" | "listening" | "stopping";
export type DictationError = SpeechErrorCode | CaptureFailureReason;

export interface DictationSnapshot {
	ownerId: string | null;
	phase: DictationPhase;
	/** The input's RMS level, 0–1, for the listening meter. */
	level: number;
	/** The last dictation's failure and the field it belonged to, until the next start. */
	error: { ownerId: string; code: DictationError } | null;
}

export interface DictationScope {
	workspaceId?: string;
	sessionId?: string;
}

/** The field a dictation writes into, read at start and written on every partial and final. */
export interface DictationTarget {
	ownerId: string;
	anchor: () => DictationAnchor;
	write: (text: string, caret: number) => void;
	scope?: DictationScope;
}

/** The browser half of a `/speech` socket, narrowed for tests. */
export interface SpeechSocketLike {
	readonly readyState: number;
	binaryType: BinaryType;
	onopen: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
	send: (data: string | ArrayBuffer) => void;
	close: () => void;
}

export interface DictationDeps {
	openSocket: () => SpeechSocketLike;
	startCapture: (sink: CaptureSink) => Promise<Capture>;
}

const OPEN = 1;
/** Counted from the host's `ready`: a cold engine may spend far longer loading the model. */
const STOP_TIMEOUT_MS = 12_000;
const MAX_EARLY_FRAMES = 250;

const IDLE: DictationSnapshot = { ownerId: null, phase: "idle", level: 0, error: null };

/**
 * The one dictation a page runs at a time: microphone → `/speech` socket → the target field.
 * Starting another one ends the current one first; recognized text is always kept.
 */
export function createDictationController(deps: DictationDeps) {
	let snapshot: DictationSnapshot = IDLE;
	const listeners = new Set<() => void>();
	let current: { end: (error?: DictationError) => void; stop: () => void; ownerId: string } | null =
		null;

	const publish = (next: Partial<DictationSnapshot>) => {
		snapshot = { ...snapshot, ...next };
		for (const listener of listeners) listener();
	};

	function start(target: DictationTarget): void {
		current?.end();
		const anchor = target.anchor();
		const finals: string[] = [];
		let partial = "";
		let capture: Capture | null = null;
		let ended = false;
		let stopTimer: ReturnType<typeof setTimeout> | null = null;
		let ready = false;
		const early: ArrayBuffer[] = [];
		const socket = deps.openSocket();
		socket.binaryType = "arraybuffer";

		const send = (message: SpeechClientMessage) => {
			if (socket.readyState === OPEN) socket.send(JSON.stringify(message));
		};
		const render = () => {
			const { text, caret } = dictationText(anchor, spokenText(finals, partial));
			target.write(text, caret);
		};
		const end = (error?: DictationError) => {
			if (ended) return;
			ended = true;
			if (stopTimer) clearTimeout(stopTimer);
			capture?.stop();
			capture = null;
			socket.onmessage = null;
			socket.onclose = null;
			socket.onerror = null;
			socket.close();
			if (partial.trim()) {
				finals.push(partial.trim());
				partial = "";
				render();
			}
			if (current?.end === end) current = null;
			publish({
				ownerId: null,
				phase: "idle",
				level: 0,
				error: error ? { ownerId: target.ownerId, code: error } : null,
			});
		};
		const stop = () => {
			if (ended || snapshot.phase === "stopping") return;
			capture?.stop();
			capture = null;
			publish({ phase: "stopping", level: 0 });
			if (socket.readyState !== OPEN) {
				end();
				return;
			}
			send({ type: "stop" });
			if (ready) armStopFallback();
		};
		const armStopFallback = () => {
			stopTimer ??= setTimeout(() => end(), STOP_TIMEOUT_MS);
		};
		current = { end, stop, ownerId: target.ownerId };
		publish({ ownerId: target.ownerId, phase: "connecting", level: 0, error: null });

		socket.onopen = () => {
			if (ended) return;
			send({ type: "start", ...target.scope });
			for (const frame of early.splice(0)) socket.send(frame);
			if (snapshot.phase === "stopping") send({ type: "stop" });
		};
		socket.onmessage = (event) => {
			const message = parseSpeechServerMessage(event.data);
			if (!message || ended) return;
			if (message.type === "ready") {
				ready = true;
				if (snapshot.phase === "connecting") publish({ phase: "listening" });
				else if (snapshot.phase === "stopping") armStopFallback();
			} else if (message.type === "partial") {
				partial = message.text;
				render();
			} else if (message.type === "final") {
				finals.push(message.text);
				partial = "";
				render();
			} else if (message.type === "error") {
				end(message.code);
			} else {
				end();
			}
		};
		socket.onclose = () => end(snapshot.phase === "stopping" ? undefined : "SPEECH_ENGINE_FAILED");
		socket.onerror = () => end("SPEECH_ENGINE_FAILED");

		void deps
			.startCapture({
				frame: (pcm) => {
					if (ended || snapshot.phase === "stopping") return;
					if (socket.readyState === OPEN) socket.send(pcm);
					else if (early.length < MAX_EARLY_FRAMES) early.push(pcm);
				},
				level: (level) => {
					if (!ended && snapshot.phase !== "stopping") publish({ level: Math.min(1, level * 4) });
				},
			})
			.then(
				(started) => {
					if (ended || snapshot.phase === "stopping") started.stop();
					else capture = started;
				},
				(err: unknown) => end(err instanceof CaptureFailure ? err.reason : "failed"),
			);
	}

	return {
		start,
		/** Ends `ownerId`'s dictation (or any) after the engine commits what it heard. */
		stop(ownerId?: string): void {
			if (current && (ownerId === undefined || current.ownerId === ownerId)) current.stop();
		},
		snapshot: (): DictationSnapshot => snapshot,
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export type DictationController = ReturnType<typeof createDictationController>;
