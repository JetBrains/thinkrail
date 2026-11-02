import {
	parseSpeechClientMessage,
	SPEECH_SAMPLE_RATE,
	type SpeechClientMessage,
	type SpeechErrorCode,
	type SpeechServerMessage,
} from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import { logger } from "../log";
import { ensureEngine, holdEngine } from "./engine";
import { engineInputs } from "./install";
import { PHRASE_BOOST, speechPhrases, type VocabularySource } from "./vocabulary";

const log = logger("speech");

/** Audio buffered while the engine starts: enough for a long first sentence, then dropped. */
const MAX_PENDING_BYTES = SPEECH_SAMPLE_RATE * 2 * 30;
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_UPSTREAM_BUFFER_BYTES = 4 * 1024 * 1024;
const COMMIT_TIMEOUT_MS = 8_000;
const VOCABULARY_TIMEOUT_MS = 1_500;
const LANGUAGE_TAG = /\s*<[a-z]{2,3}-[A-Z]{2}>\s*$/;

/** What a dictation is scoped to; the host resolves it into project words. */
export interface SpeechScope {
	workspaceId?: string;
	sessionId?: string;
}

export type VocabularyResolver = (scope: SpeechScope) => Promise<VocabularySource>;

let resolveVocabulary: VocabularyResolver | null = null;

export function setSpeechVocabularyResolver(fn: VocabularyResolver | null): void {
	resolveVocabulary = fn;
}

/** The slice of a host socket the relay writes to. */
export interface SpeechClientSocket {
	send(message: string): unknown;
	close(): void;
}

async function vocabularyFor(scope: SpeechScope): Promise<string[]> {
	if (!resolveVocabulary) return [];
	const timeout = Bun.sleep(VOCABULARY_TIMEOUT_MS).then(() => null);
	try {
		const source = await Promise.race([resolveVocabulary(scope), timeout]);
		return source ? speechPhrases(source) : [];
	} catch {
		return [];
	}
}

function errorCode(err: unknown): SpeechErrorCode {
	const code = errorCodeOf(err);
	return code === "SPEECH_NOT_INSTALLED" || code === "SPEECH_ENGINE_FAILED"
		? code
		: "SPEECH_ENGINE_FAILED";
}

function clean(text: string): string {
	return text.replace(LANGUAGE_TAG, "");
}

/** One dictation: a client start → the engine's realtime socket → a client `ended`. */
class Dictation {
	private upstream: WebSocket | null = null;
	private pending: Uint8Array<ArrayBuffer>[] = [];
	private pendingBytes = 0;
	private partial = "";
	private stopping = false;
	private finished = false;
	private commitTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly release = holdEngine();

	constructor(
		private readonly socket: SpeechClientSocket,
		private readonly onFinished: () => void,
	) {}

	private send(message: SpeechServerMessage): void {
		try {
			this.socket.send(JSON.stringify(message));
		} catch {}
	}

	async begin(scope: SpeechScope): Promise<void> {
		const inputs = engineInputs();
		if (!inputs) {
			this.fail("SPEECH_NOT_INSTALLED");
			return;
		}
		let endpoint: Awaited<ReturnType<typeof ensureEngine>>;
		let phrases: string[];
		try {
			[endpoint, phrases] = await Promise.all([ensureEngine(inputs), vocabularyFor(scope)]);
		} catch (err) {
			this.fail(errorCode(err));
			return;
		}
		if (this.finished) return;
		const url = new URL(endpoint.realtimeUrl);
		url.searchParams.set("api_key", endpoint.apiKey);
		const upstream = new WebSocket(url);
		upstream.binaryType = "arraybuffer";
		this.upstream = upstream;
		upstream.onopen = () => {
			if (this.finished) return;
			upstream.send(
				JSON.stringify({
					type: "session.update",
					session: {
						sample_rate: SPEECH_SAMPLE_RATE,
						language: inputs.language,
						...(phrases.length > 0 ? { speech_contexts: [{ phrases, boost: PHRASE_BOOST }] } : {}),
					},
				}),
			);
			for (const frame of this.pending) upstream.send(frame);
			this.pending = [];
			this.pendingBytes = 0;
			this.send({ type: "ready" });
			if (this.stopping) this.commit();
		};
		upstream.onmessage = (event) => this.upstreamEvent(event.data);
		upstream.onerror = () => this.fail("SPEECH_ENGINE_FAILED");
		upstream.onclose = () => {
			if (!this.finished) this.fail("SPEECH_ENGINE_FAILED");
		};
	}

	audio(raw: Uint8Array): void {
		if (this.finished || this.stopping || raw.byteLength > MAX_FRAME_BYTES) return;
		const frame = new Uint8Array(raw);
		const upstream = this.upstream;
		if (upstream?.readyState === WebSocket.OPEN) {
			if (upstream.bufferedAmount < MAX_UPSTREAM_BUFFER_BYTES) upstream.send(frame);
			return;
		}
		if (this.pendingBytes + frame.byteLength > MAX_PENDING_BYTES) return;
		this.pending.push(frame);
		this.pendingBytes += frame.byteLength;
	}

	stop(): void {
		if (this.finished || this.stopping) return;
		this.stopping = true;
		if (this.upstream?.readyState === WebSocket.OPEN) this.commit();
	}

	/** The fallback runs from the commit, never from the stop: a cold engine may still be loading. */
	private commit(): void {
		this.upstream?.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
		this.commitTimer ??= setTimeout(() => this.finish(), COMMIT_TIMEOUT_MS);
	}

	private upstreamEvent(data: unknown): void {
		if (typeof data !== "string") return;
		let event: unknown;
		try {
			event = JSON.parse(data);
		} catch {
			return;
		}
		if (typeof event !== "object" || event === null) return;
		const type = Reflect.get(event, "type");
		if (type === "conversation.item.input_audio_transcription.delta") {
			const delta = Reflect.get(event, "delta");
			if (typeof delta !== "string" || delta === "") return;
			this.partial += delta;
			this.send({ type: "partial", text: clean(this.partial) });
		} else if (type === "conversation.item.input_audio_transcription.completed") {
			const transcript = Reflect.get(event, "transcript");
			const text = clean(typeof transcript === "string" ? transcript : this.partial).trim();
			this.partial = "";
			if (text) this.send({ type: "final", text });
		} else if (type === "input_audio_buffer.committed") {
			if (this.stopping) this.finish();
		} else if (type === "error") {
			const code = Reflect.get(event, "code");
			log.warn(`speech engine reported an error (${typeof code === "string" ? code : "unknown"})`);
			this.fail("SPEECH_ENGINE_FAILED");
		}
	}

	private fail(code: SpeechErrorCode): void {
		if (this.finished) return;
		this.send({ type: "error", code });
		this.finish();
	}

	/** Ends the dictation exactly once; any partial the engine never completed becomes a final. */
	finish(): void {
		if (this.finished) return;
		this.finished = true;
		if (this.commitTimer) clearTimeout(this.commitTimer);
		const leftover = clean(this.partial).trim();
		if (leftover) this.send({ type: "final", text: leftover });
		this.partial = "";
		this.send({ type: "ended" });
		this.pending = [];
		try {
			this.upstream?.close();
		} catch {}
		this.release();
		this.onFinished();
	}
}

/** One client's `/speech` socket: at most one dictation at a time. */
export interface SpeechRelay {
	message(raw: string | Uint8Array): void;
	close(): void;
}

export function createSpeechRelay(socket: SpeechClientSocket): SpeechRelay {
	let active: Dictation | null = null;
	const control = (message: SpeechClientMessage) => {
		if (message.type === "stop") {
			active?.stop();
			return;
		}
		if (active) {
			socket.send(
				JSON.stringify({ type: "error", code: "SPEECH_BUSY" } satisfies SpeechServerMessage),
			);
			return;
		}
		const dictation = new Dictation(socket, () => {
			if (active === dictation) active = null;
		});
		active = dictation;
		void dictation.begin({
			...(message.workspaceId !== undefined ? { workspaceId: message.workspaceId } : {}),
			...(message.sessionId !== undefined ? { sessionId: message.sessionId } : {}),
		});
	};
	return {
		message(raw) {
			if (typeof raw !== "string") {
				active?.audio(raw);
				return;
			}
			const message = parseSpeechClientMessage(raw);
			if (message) control(message);
			else
				socket.send(
					JSON.stringify({ type: "error", code: "SPEECH_PROTOCOL" } satisfies SpeechServerMessage),
				);
		},
		close() {
			active?.finish();
			active = null;
		},
	};
}
