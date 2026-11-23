import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

export interface ByteRange {
	offset: number;
	length: number;
}

export interface ParsedLine {
	entry: unknown;
	range: ByteRange;
}

export interface ScanResult {
	consumed: number;
	tail: ParsedLine | null;
}

export type EntrySink = (entry: unknown, range: ByteRange) => void;

export interface Yielder {
	due(): boolean;
	pause(): Promise<void>;
}

const NEWLINE = 0x0a;
const CHUNK_BYTES = 1024 * 1024;
const TAIL_HASH_BYTES = 4096;

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/** Yields every `sliceMs`; once `signal` is aborted it is always due and its pause rejects with the reason. */
export function sliceYielder(
	sliceMs: number,
	clock: () => number = () => performance.now(),
	signal?: AbortSignal,
): Yielder {
	let started = clock();
	return {
		due: () => signal?.aborted === true || clock() - started >= sliceMs,
		pause: () =>
			new Promise<void>((resolve, reject) => {
				if (signal?.aborted) {
					reject(signal.reason);
					return;
				}
				setImmediate(() => {
					if (signal?.aborted) {
						reject(signal.reason);
						return;
					}
					started = clock();
					resolve();
				});
			}),
	};
}

export function parseLine(bytes: Uint8Array): unknown {
	const text = decoder.decode(bytes);
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function concat(parts: readonly Uint8Array[], length: number): Uint8Array {
	if (parts.length === 1 && parts[0]) return parts[0];
	const out = new Uint8Array(length);
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

interface RawLine {
	bytes: Uint8Array;
	offset: number;
}

class LineSplitter {
	private parts: Uint8Array[] = [];
	private partsLength = 0;
	private lineOffset: number;

	constructor(start: number) {
		this.lineOffset = start;
	}

	get consumed(): number {
		return this.lineOffset;
	}

	*push(chunk: Uint8Array, base: number): Generator<RawLine> {
		let start = 0;
		let newline = chunk.indexOf(NEWLINE, start);
		while (newline !== -1) {
			const piece = chunk.subarray(start, newline);
			const bytes =
				this.partsLength > 0
					? concat([...this.parts, piece], this.partsLength + piece.length)
					: piece;
			this.parts = [];
			this.partsLength = 0;
			const offset = this.lineOffset;
			this.lineOffset = base + newline + 1;
			yield { bytes, offset };
			start = newline + 1;
			newline = chunk.indexOf(NEWLINE, start);
		}
		if (start < chunk.length) {
			this.parts.push(chunk.subarray(start));
			this.partsLength += chunk.length - start;
		}
	}

	tail(): ParsedLine | null {
		if (this.partsLength === 0) return null;
		const bytes = concat(this.parts, this.partsLength);
		const entry = parseLine(bytes);
		return entry === undefined
			? null
			: { entry, range: { offset: this.lineOffset, length: bytes.length } };
	}
}

export function scanBytes(bytes: Uint8Array, sink: EntrySink): ScanResult {
	const splitter = new LineSplitter(0);
	for (const line of splitter.push(bytes, 0)) {
		const entry = parseLine(line.bytes);
		if (entry !== undefined) sink(entry, { offset: line.offset, length: line.bytes.length });
	}
	return { consumed: splitter.consumed, tail: splitter.tail() };
}

export async function scanFile(
	path: string,
	from: number,
	to: number,
	sink: EntrySink,
	yielder: Yielder,
): Promise<ScanResult> {
	const splitter = new LineSplitter(from);
	const handle = await open(path, "r");
	try {
		let position = from;
		while (position < to) {
			const chunk = new Uint8Array(Math.min(CHUNK_BYTES, to - position));
			const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
			if (bytesRead === 0) break;
			const base = position;
			position += bytesRead;
			for (const line of splitter.push(chunk.subarray(0, bytesRead), base)) {
				const entry = parseLine(line.bytes);
				if (entry !== undefined) sink(entry, { offset: line.offset, length: line.bytes.length });
				if (yielder.due()) await yielder.pause();
			}
		}
	} finally {
		await handle.close();
	}
	return { consumed: splitter.consumed, tail: splitter.tail() };
}

export async function readRange(path: string, range: ByteRange): Promise<Uint8Array> {
	const handle = await open(path, "r");
	try {
		const bytes = new Uint8Array(range.length);
		let at = 0;
		while (at < range.length) {
			const { bytesRead } = await handle.read(bytes, at, range.length - at, range.offset + at);
			if (bytesRead === 0) break;
			at += bytesRead;
		}
		return bytes.subarray(0, at);
	} finally {
		await handle.close();
	}
}

export async function tailHash(path: string, end: number): Promise<string> {
	const offset = Math.max(0, end - TAIL_HASH_BYTES);
	const bytes = await readRange(path, { offset, length: end - offset });
	return createHash("sha256").update(bytes).digest("hex");
}
