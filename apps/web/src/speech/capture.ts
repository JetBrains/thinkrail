import { SPEECH_SAMPLE_RATE } from "@thinkrail/contracts";
import {
	type Capture,
	CaptureFailure,
	type CaptureFailureReason,
	type CaptureSink,
} from "./captureTypes";
import workletUrl from "./pcmWorklet.ts?worker&url";

/** 20 ms frames: small enough for low latency, large enough to keep the socket quiet. */
const FRAME_SAMPLES = SPEECH_SAMPLE_RATE / 50;

export type MicAvailability = "available" | "insecure-origin" | "unsupported";

/** Browsers expose the microphone only to secure contexts (HTTPS or localhost). */
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

/** Opens the microphone and streams mono 16 kHz PCM16 frames until stopped. */
export async function startCapture(sink: CaptureSink): Promise<Capture> {
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
	const context = new AudioContext();
	const release = () => {
		for (const track of stream.getTracks()) track.stop();
		void context.close().catch(() => {});
	};
	try {
		await context.audioWorklet.addModule(workletUrl);
	} catch {
		release();
		throw new CaptureFailure("failed");
	}
	const source = context.createMediaStreamSource(stream);
	const node = new AudioWorkletNode(context, "thinkrail-pcm16", {
		numberOfOutputs: 0,
		processorOptions: { targetRate: SPEECH_SAMPLE_RATE, frameSamples: FRAME_SAMPLES },
	});
	node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
		sink.frame(event.data.pcm);
		sink.level(event.data.level);
	};
	source.connect(node);
	if (context.state === "suspended") await context.resume().catch(() => {});
	let stopped = false;
	return {
		stop: () => {
			if (stopped) return;
			stopped = true;
			node.port.onmessage = null;
			source.disconnect();
			release();
		},
	};
}
