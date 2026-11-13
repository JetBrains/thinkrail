import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";

export const CLOSE_OPCODE = 0x8;

export interface ServerFrame {
	opcode: number;
	text: string;
}

export function serverFrames(received: Buffer): ServerFrame[] {
	const frames: ServerFrame[] = [];
	const headerEnd = received.indexOf("\r\n\r\n");
	if (headerEnd < 0) return frames;
	let offset = headerEnd + 4;
	while (offset + 2 <= received.length) {
		const opcode = (received[offset] ?? 0) & 0x0f;
		let length = (received[offset + 1] ?? 0) & 0x7f;
		let header = 2;
		if (length === 126) {
			if (offset + 4 > received.length) break;
			length = received.readUInt16BE(offset + 2);
			header = 4;
		} else if (length === 127) {
			if (offset + 10 > received.length) break;
			length = Number(received.readBigUInt64BE(offset + 2));
			header = 10;
		}
		if (offset + header + length > received.length) break;
		frames.push({
			opcode,
			text: received.subarray(offset + header, offset + header + length).toString(),
		});
		offset += header + length;
	}
	return frames;
}

export async function until(
	condition: () => boolean,
	what: string,
	timeoutMs = 15_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await Bun.sleep(10);
	}
}

export async function stalledClient(
	port: number,
	clientKey: string,
): Promise<{ socket: Socket; received: () => Buffer }> {
	const chunks: Buffer[] = [];
	const socket = connect(port, "127.0.0.1");
	socket.on("data", (chunk: Buffer) => chunks.push(chunk));
	socket.write(
		[
			`GET /ws?client=${clientKey}&protocol=${PROTOCOL_VERSION} HTTP/1.1`,
			`Host: 127.0.0.1:${port}`,
			"Upgrade: websocket",
			"Connection: Upgrade",
			`Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
			"Sec-WebSocket-Version: 13",
			"",
			"",
		].join("\r\n"),
	);
	const received = () => Buffer.concat(chunks);
	await until(
		() => serverFrames(received()).some((frame) => frame.text.includes(WS_CHANNELS.serverWelcome)),
		"the stalled client's welcome",
	);
	socket.pause();
	return { socket, received };
}
