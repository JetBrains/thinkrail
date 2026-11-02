export const SPEECH_MODELS = ["multilingual", "english"] as const;
export type SpeechModel = (typeof SPEECH_MODELS)[number];

export function isSpeechModel(value: unknown): value is SpeechModel {
	return SPEECH_MODELS.some((model) => model === value);
}

/** The host route a client upgrades to for one dictation stream at a time. */
export const SPEECH_SOCKET_ROUTE = "/speech";
/** Clients send mono little-endian PCM16 binary frames at this rate. */
export const SPEECH_SAMPLE_RATE = 16_000;

export const SPEECH_ERROR_CODES = [
	"SPEECH_UNSUPPORTED_PLATFORM",
	"SPEECH_NOT_INSTALLED",
	"SPEECH_INSTALL_BUSY",
	"SPEECH_DOWNLOAD_FAILED",
	"SPEECH_CHECKSUM_MISMATCH",
	"SPEECH_DISK_SPACE",
	"SPEECH_ENGINE_FAILED",
	"SPEECH_BUSY",
	"SPEECH_PROTOCOL",
] as const;
export type SpeechErrorCode = (typeof SPEECH_ERROR_CODES)[number];

export function isSpeechErrorCode(value: unknown): value is SpeechErrorCode {
	return SPEECH_ERROR_CODES.some((code) => code === value);
}

export type SpeechInstallPhase = "runtime" | "model";

export type SpeechInstallState =
	| { status: "not-installed" }
	| {
			status: "installing";
			model: SpeechModel;
			phase: SpeechInstallPhase;
			receivedBytes: number;
			totalBytes: number;
	  }
	| { status: "ready"; model: SpeechModel }
	| {
			status: "failed";
			model: SpeechModel;
			code: SpeechErrorCode;
			/** A previously installed model that still works after a failed switch. */
			usable: SpeechModel | null;
	  };

/** `path` is a user-installed `nemo-speech`; ThinkRail never deletes it. */
export interface SpeechRuntimeInfo {
	source: "managed" | "path";
	version: string;
	backend: string;
}

export type SpeechEngineState = "stopped" | "starting" | "ready" | "failed";

/** Voice input as the host reports it in `ServerWelcome.speech` and on `speech.changed`. */
export interface SpeechStatus {
	supported: boolean;
	install: SpeechInstallState;
	runtime: SpeechRuntimeInfo | null;
	engine: SpeechEngineState;
	/** Bytes ThinkRail's own speech files occupy on the host. */
	diskBytes: number;
	/** What installing each model would download now, given what is already present. */
	downloadBytes: Record<SpeechModel, number>;
}

/**
 * Client → host over the speech socket. `start` opens one dictation; PCM16 binary frames follow;
 * `stop` commits the buffered audio and waits for the last final.
 */
export type SpeechClientMessage =
	| { type: "start"; workspaceId?: string; sessionId?: string }
	| { type: "stop" };

/** Host → client over the speech socket; `partial` replaces the previous partial, `final` commits it. */
export type SpeechServerMessage =
	| { type: "ready" }
	| { type: "partial"; text: string }
	| { type: "final"; text: string }
	| { type: "error"; code: SpeechErrorCode }
	| { type: "ended" };

export function parseSpeechServerMessage(raw: unknown): SpeechServerMessage | null {
	if (typeof raw !== "string") return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const type = Reflect.get(value, "type");
	if (type === "ready" || type === "ended") return { type };
	if (type === "partial" || type === "final") {
		const text = Reflect.get(value, "text");
		return typeof text === "string" ? { type, text } : null;
	}
	if (type === "error") {
		const code = Reflect.get(value, "code");
		return isSpeechErrorCode(code) ? { type, code } : null;
	}
	return null;
}

export function parseSpeechClientMessage(raw: string): SpeechClientMessage | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const type = Reflect.get(value, "type");
	if (type === "stop") return { type };
	if (type !== "start") return null;
	const workspaceId = Reflect.get(value, "workspaceId");
	const sessionId = Reflect.get(value, "sessionId");
	if (workspaceId !== undefined && typeof workspaceId !== "string") return null;
	if (sessionId !== undefined && typeof sessionId !== "string") return null;
	return {
		type,
		...(workspaceId !== undefined ? { workspaceId } : {}),
		...(sessionId !== undefined ? { sessionId } : {}),
	};
}
