import { SPEECH_SAMPLE_RATE } from "@thinkrail/contracts";

export type CaptureFailureReason = "denied" | "no-device" | "failed";

export class CaptureFailure extends Error {
	readonly reason: CaptureFailureReason;

	constructor(reason: CaptureFailureReason) {
		super(`microphone capture failed: ${reason}`);
		this.name = "CaptureFailure";
		this.reason = reason;
	}
}

export interface CaptureSink {
	frame: (pcm: ArrayBuffer) => void;
	level: (rms: number) => void;
}

export interface Capture {
	stop: () => void;
}

const FRAME_SAMPLES = SPEECH_SAMPLE_RATE / 50;

export type MicAvailability = "available" | "insecure-origin" | "unsupported";

export function micAvailability(): MicAvailability {
	if (typeof window === "undefined") return "unsupported";
	if (!window.isSecureContext) return "insecure-origin";
	if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
		return "unsupported";
	}
	return "available";
}

function failureReason(err: unknown): CaptureFailureReason {
	const name = err instanceof DOMException ? err.name : "";
	if (name === "NotAllowedError" || name === "SecurityError") return "denied";
	if (name === "NotFoundError" || name === "OverconstrainedError") return "no-device";
	return "failed";
}

/**
 * Opens the microphone and streams 16 kHz PCM16 frames to `sink`. Aborting `signal` releases the
 * microphone at once, even while the worklet is still loading, and rejects the start.
 */
export async function startCapture(sink: CaptureSink, signal: AbortSignal): Promise<Capture> {
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				channelCount: 1,
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
			},
		});
	} catch (err) {
		throw new CaptureFailure(failureReason(err));
	}
	let context: AudioContext | null = null;
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		signal.removeEventListener("abort", release);
		for (const track of stream.getTracks()) track.stop();
		void context?.close().catch(() => {});
	};
	const cancelled = () => {
		release();
		return new CaptureFailure("failed");
	};
	if (signal.aborted) throw cancelled();
	signal.addEventListener("abort", release, { once: true });
	let source: MediaStreamAudioSourceNode;
	let node: AudioWorkletNode;
	try {
		context = new AudioContext();
		const { default: workletUrl } = await import("./pcmWorklet.ts?worker&url");
		await context.audioWorklet.addModule(workletUrl);
		if (signal.aborted) throw cancelled();
		source = context.createMediaStreamSource(stream);
		node = new AudioWorkletNode(context, "thinkrail-pcm16", {
			numberOfOutputs: 0,
			processorOptions: { targetRate: SPEECH_SAMPLE_RATE, frameSamples: FRAME_SAMPLES },
		});
	} catch {
		throw cancelled();
	}
	const audio = context;
	node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
		sink.frame(event.data.pcm);
		sink.level(event.data.level);
	};
	source.connect(node);
	if (audio.state === "suspended") await audio.resume().catch(() => {});
	if (signal.aborted) {
		node.port.onmessage = null;
		source.disconnect();
		throw cancelled();
	}
	return {
		stop: () => {
			if (released) return;
			node.port.onmessage = null;
			source.disconnect();
			release();
		},
	};
}
