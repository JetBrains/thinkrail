export type CaptureFailureReason = "denied" | "no-device" | "failed";

export class CaptureFailure extends Error {
	constructor(readonly reason: CaptureFailureReason) {
		super(`microphone capture failed: ${reason}`);
		this.name = "CaptureFailure";
	}
}

export interface CaptureSink {
	frame: (pcm: ArrayBuffer) => void;
	level: (rms: number) => void;
}

export interface Capture {
	stop: () => void;
}
