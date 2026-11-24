import { expect, test } from "bun:test";
import {
	CHANNEL_CHUNK_BYTES,
	ChannelMessageTooLargeError,
	chunkFrames,
	createChannelAssembler,
} from "./channelFraming";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("a message that fits the channel is sent as is", () => {
	const message = encode('{"id":1}');
	expect(chunkFrames(message)).toBeNull();
	expect(createChannelAssembler()(message)).toBe(message);
});

test("a large message splits into bounded chunks and reassembles byte-exact, multibyte text included", () => {
	const text = JSON.stringify({ result: "привет 😀 ".repeat(CHANNEL_CHUNK_BYTES / 4) });
	const frames = chunkFrames(encode(text)) ?? [];
	expect(frames.length).toBeGreaterThan(2);
	for (const frame of frames) expect(frame.length).toBeLessThanOrEqual(CHANNEL_CHUNK_BYTES + 2);
	const assemble = createChannelAssembler();
	const results = frames.map(assemble);
	expect(results.slice(0, -1).every((result) => result === null)).toBe(true);
	expect(decode(results.at(-1) as Uint8Array)).toBe(text);
	expect(assemble(encode('{"next":true}'))).toEqual(encode('{"next":true}'));
});

test("a reassembled message past the cap throws instead of growing", () => {
	const frames = chunkFrames(new Uint8Array(CHANNEL_CHUNK_BYTES * 3)) ?? [];
	const assemble = createChannelAssembler(CHANNEL_CHUNK_BYTES * 2);
	expect(assemble(frames[0] as Uint8Array)).toBeNull();
	expect(assemble(frames[1] as Uint8Array)).toBeNull();
	expect(() => assemble(frames[2] as Uint8Array)).toThrow(ChannelMessageTooLargeError);
	expect(() => createChannelAssembler(4)(encode('{"id":1}'))).toThrow(ChannelMessageTooLargeError);
	const exact = createChannelAssembler(CHANNEL_CHUNK_BYTES * 3);
	expect(frames.map(exact).at(-1)?.length).toBe(CHANNEL_CHUNK_BYTES * 3);
});
