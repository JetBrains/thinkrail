/**
 * Framing for the remote data channel. A WebRTC DataChannel caps one message (WebKit: 64 KiB), but a wire
 * result such as a long transcript is megabytes, so a sender splits any message above `CHANNEL_CHUNK_BYTES`
 * into binary chunk frames: `[0x00, more]` + up to `CHANNEL_CHUNK_BYTES` bytes, `more` = 1 on every chunk
 * but the last. A wire message is JSON and starts with `{`, so the leading zero byte is unambiguous. The
 * channel is ordered and reliable, and a sender emits one message's chunks back to back, so the receiver
 * needs no ids: it concatenates until the last chunk.
 */
export const CHANNEL_CHUNK_BYTES = 16 * 1024;

const CHUNK_MARK = 0x00;

/** The chunk frames for one encoded wire message, or `null` when it fits one channel message as is. */
export function chunkFrames(message: Uint8Array): Uint8Array<ArrayBuffer>[] | null {
	if (message.length <= CHANNEL_CHUNK_BYTES) return null;
	const frames: Uint8Array<ArrayBuffer>[] = [];
	for (let start = 0; start < message.length; start += CHANNEL_CHUNK_BYTES) {
		const part = message.subarray(start, start + CHANNEL_CHUNK_BYTES);
		const frame = new Uint8Array(part.length + 2);
		frame[0] = CHUNK_MARK;
		frame[1] = start + CHANNEL_CHUNK_BYTES < message.length ? 1 : 0;
		frame.set(part, 2);
		frames.push(frame);
	}
	return frames;
}

/** Reassembles received frames: returns a whole wire message, or `null` while a chunked one is incomplete. */
export function createChannelAssembler(): (frame: Uint8Array) => Uint8Array | null {
	let parts: Uint8Array[] = [];
	return (frame) => {
		if (frame[0] !== CHUNK_MARK) return frame;
		parts.push(frame.subarray(2));
		if (frame[1] === 1) return null;
		const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
		let offset = 0;
		for (const part of parts) {
			whole.set(part, offset);
			offset += part.length;
		}
		parts = [];
		return whole;
	};
}
