/**
 * Framing for the remote data channel. A WebRTC DataChannel caps one message (WebKit: 64 KiB), but a wire
 * result such as a long transcript is megabytes, so a sender splits any message above `CHANNEL_CHUNK_BYTES`
 * into binary chunk frames: `[0x00, more]` + up to `CHANNEL_CHUNK_BYTES` bytes, `more` = 1 on every chunk
 * but the last. A wire message is JSON and starts with `{`, so the leading zero byte is unambiguous. The
 * channel is ordered and reliable, and a sender emits one message's chunks back to back, so the receiver
 * needs no ids: it concatenates until the last chunk. A receiver given `maxBytes` refuses a reassembled
 * message past it, so a peer cannot grow one without bound.
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

export class ChannelMessageTooLargeError extends Error {
	readonly code = "CHANNEL_MESSAGE_TOO_LARGE";

	constructor(maxBytes: number) {
		super(`a channel message exceeded ${maxBytes} bytes`);
		this.name = "ChannelMessageTooLargeError";
	}
}

/**
 * Reassembles received frames: returns a whole wire message, or `null` while a chunked one is incomplete.
 * Throws `ChannelMessageTooLargeError` once a message passes `maxBytes`; the channel is then unusable.
 */
export function createChannelAssembler(
	maxBytes = Number.POSITIVE_INFINITY,
): (frame: Uint8Array) => Uint8Array | null {
	let parts: Uint8Array[] = [];
	let size = 0;
	return (frame) => {
		const chunked = frame[0] === CHUNK_MARK;
		const part = chunked ? frame.subarray(2) : frame;
		if (size + part.length > maxBytes) {
			parts = [];
			size = 0;
			throw new ChannelMessageTooLargeError(maxBytes);
		}
		if (!chunked) return frame;
		parts.push(part);
		size += part.length;
		if (frame[1] === 1) return null;
		const whole = new Uint8Array(size);
		let offset = 0;
		for (const piece of parts) {
			whole.set(piece, offset);
			offset += piece.length;
		}
		parts = [];
		size = 0;
		return whole;
	};
}
