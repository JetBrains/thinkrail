import type { TerminalDataPush, TerminalExitPush } from "@thinkrail/contracts";

export interface TerminalPrebindResult {
	frames: TerminalDataPush[];
	/** This PTY lost oldest pre-bind bytes to the browser-side cap. */
	truncated: boolean;
	/** A very short-lived shell can exit before `terminal.attach` returns its id. */
	exit?: TerminalExitPush;
}

export interface TerminalPrebindBuffer {
	/** Consume a data frame only while this instance is waiting for its PTY id. */
	acceptData(frame: TerminalDataPush): boolean;
	/** Consume an exit frame only while this instance is waiting for its PTY id. */
	acceptExit(exit: TerminalExitPush): boolean;
	/** Stop waiting, return only this PTY's buffered events, and clear every other frame. */
	bind(id: string): TerminalPrebindResult;
	/** Permanently stop and clear after creation failure/unmount. */
	stop(): void;
}

const DEFAULT_MAX_CHARS = 1_048_576;
const DEFAULT_MAX_FRAMES = 256;
const DEFAULT_MAX_EXITS = 128;

/**
 * A bounded pre-correlation buffer for terminal pushes that race `terminal.attach`'s response.
 *
 * Terminal pushes are addressed to the page, so before the response names this instance's PTY it sees frames
 * for every terminal. The buffer is deliberately global-capped, records which PTY lost bytes while evicting,
 * and becomes permanently inert on bind/failure; a failed instance can therefore never accumulate another
 * terminal's output for the rest of the tab's life.
 */
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
			// Refresh insertion order for a repeated id, then evict oldest ids under the hard count bound.
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
