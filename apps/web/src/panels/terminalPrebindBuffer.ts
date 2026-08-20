import type { TerminalDataPush, TerminalExitPush } from "@thinkrail/contracts";

export interface TerminalPrebindResult {
	frames: TerminalDataPush[];
	truncated: boolean;
	exit?: TerminalExitPush;
}

export interface TerminalPrebindBuffer {
	acceptData(frame: TerminalDataPush): boolean;
	acceptExit(exit: TerminalExitPush): boolean;
	bind(id: string): TerminalPrebindResult;
	stop(): void;
}

const DEFAULT_MAX_CHARS = 1_048_576;
const DEFAULT_MAX_FRAMES = 256;
const DEFAULT_MAX_EXITS = 128;

export function createTerminalPrebindBuffer(
	maxChars = DEFAULT_MAX_CHARS,
	maxFrames = DEFAULT_MAX_FRAMES,
	maxExits = DEFAULT_MAX_EXITS,
): TerminalPrebindBuffer {
	let waiting = true;
	let chars = 0;
	const frames: TerminalDataPush[] = [];
	const truncatedIds = new Set<string>();
	let truncationTrackingOverflowed = false;
	const exits = new Map<string, TerminalExitPush>();

	const noteTruncated = (id: string): void => {
		if (truncatedIds.has(id)) return;
		if (truncatedIds.size < maxFrames) truncatedIds.add(id);
		else truncationTrackingOverflowed = true;
	};

	const clear = (): void => {
		chars = 0;
		frames.length = 0;
		truncatedIds.clear();
		truncationTrackingOverflowed = false;
		exits.clear();
	};

	const trim = (): void => {
		while (frames.length > maxFrames || chars > maxChars) {
			const oldest = frames[0];
			if (!oldest) return;
			const excessChars = Math.max(0, chars - maxChars);
			if (frames.length <= maxFrames && excessChars > 0 && oldest.data.length > excessChars) {
				frames[0] = { ...oldest, data: oldest.data.slice(excessChars) };
				chars -= excessChars;
				noteTruncated(oldest.id);
				return;
			}
			frames.shift();
			chars -= oldest.data.length;
			noteTruncated(oldest.id);
		}
	};

	return {
		acceptData(frame) {
			if (!waiting) return false;
			frames.push(frame);
			chars += frame.data.length;
			trim();
			return true;
		},
		acceptExit(exit) {
			if (!waiting) return false;
			exits.delete(exit.id);
			exits.set(exit.id, exit);
			while (exits.size > maxExits) {
				const oldestId = exits.keys().next().value;
				if (oldestId === undefined) break;
				exits.delete(oldestId);
			}
			return true;
		},
		bind(id) {
			if (!waiting) return { frames: [], truncated: false };
			waiting = false;
			const exit = exits.get(id);
			const result: TerminalPrebindResult = {
				frames: frames.filter((frame) => frame.id === id),
				truncated: truncatedIds.has(id) || truncationTrackingOverflowed,
				...(exit ? { exit } : {}),
			};
			clear();
			return result;
		},
		stop() {
			waiting = false;
			clear();
		},
	};
}
