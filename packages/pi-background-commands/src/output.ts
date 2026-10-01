import { StringDecoder } from "node:string_decoder";
import type { BackgroundCommandOutput } from "./types";

export function tail(text: string, maxBytes: number, maxLines: number): BackgroundCommandOutput {
	const bytes = Buffer.from(text, "utf8");
	let start = Math.max(0, bytes.length - maxBytes);
	while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
	const bounded = bytes.subarray(start).toString("utf8");
	let lines = 1;
	let lineStart = 0;
	for (let i = bounded.length - 1; i >= 0; i--) {
		if (bounded[i] === "\n" && ++lines > maxLines) {
			lineStart = i + 1;
			break;
		}
	}
	return { text: bounded.slice(lineStart), truncated: start > 0 || lineStart > 0 };
}

export function boundedError(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= 4096) return text;
	const suffix = " [truncated]";
	let end = 4096 - suffix.length;
	while (((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
	return bytes.subarray(0, end).toString("utf8") + suffix;
}

export class OutputTail {
	private decoder = new StringDecoder("utf8");
	private value: BackgroundCommandOutput | undefined = { text: "", truncated: false };
	private accepting = true;

	append(data: Buffer): void {
		if (!this.accepting) return;
		for (let offset = 0; offset < data.length; offset += 8192) {
			this.appendText(this.decoder.write(data.subarray(offset, offset + 8192)));
		}
	}

	finish(): void {
		if (!this.accepting) return;
		this.accepting = false;
		this.appendText(this.decoder.end());
	}

	clear(): void {
		this.accepting = false;
		this.decoder = new StringDecoder("utf8");
		this.value = undefined;
	}

	get snapshot(): BackgroundCommandOutput | undefined {
		return this.value ? { ...this.value } : undefined;
	}

	private appendText(text: string): void {
		if (!this.value || !text) return;
		const bounded = tail(this.value.text + text, 50 * 1024, 2000);
		this.value = { text: bounded.text, truncated: this.value.truncated || bounded.truncated };
	}
}
