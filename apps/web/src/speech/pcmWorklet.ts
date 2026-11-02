/**
 * Runs on the audio rendering thread: mixes the input to mono, decimates it to the target rate by
 * averaging each output period's input samples (a box filter, enough anti-aliasing for speech), and
 * posts little-endian PCM16 frames of `frameSamples` with their RMS level.
 */

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: { processorOptions?: unknown });
}

interface Options {
	targetRate: number;
	frameSamples: number;
}

class Pcm16Processor extends AudioWorkletProcessor {
	private readonly step: number;
	private readonly frame: Int16Array;
	private filled = 0;
	private elapsed = 0;
	private sum = 0;
	private count = 0;
	private sumSquares = 0;

	constructor(options: { processorOptions: Options }) {
		super(options);
		this.step = sampleRate / options.processorOptions.targetRate;
		this.frame = new Int16Array(options.processorOptions.frameSamples);
	}

	process(inputs: Float32Array[][]): boolean {
		const channels = inputs[0];
		if (!channels || channels.length === 0 || !channels[0]) return true;
		const length = channels[0].length;
		for (let i = 0; i < length; i += 1) {
			let sample = 0;
			for (const channel of channels) sample += channel[i] ?? 0;
			this.sum += sample / channels.length;
			this.count += 1;
			this.elapsed += 1;
			if (this.elapsed >= this.step) {
				this.push(this.sum / this.count);
				this.elapsed -= this.step;
				this.sum = 0;
				this.count = 0;
			}
		}
		return true;
	}

	private push(value: number): void {
		const clamped = Math.max(-1, Math.min(1, value));
		this.frame[this.filled] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
		this.sumSquares += clamped * clamped;
		this.filled += 1;
		if (this.filled < this.frame.length) return;
		const level = Math.sqrt(this.sumSquares / this.frame.length);
		const out = this.frame.slice();
		this.port.postMessage({ pcm: out.buffer, level }, [out.buffer]);
		this.filled = 0;
		this.sumSquares = 0;
	}
}

registerProcessor("thinkrail-pcm16", Pcm16Processor);

export {};
