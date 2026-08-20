export const DEFAULT_RECORDER_MAX_CHARS = 64 * 1024;

const TRACKED_MODES: ReadonlySet<number> = new Set([
	1, // application cursor keys — arrows send SS3 instead of CSI
	7, // autowrap
	25, // cursor visibility
	1000, // mouse: button events
	1002, // mouse: drag tracking
	1003, // mouse: any-motion tracking
	1006, // mouse: SGR coordinate encoding
	2004, // bracketed paste
]);

const ALT_BUFFER_MODES: ReadonlySet<number> = new Set([47, 1047, 1049]);

const ESC = "\u001b";

const PRIVATE_MODE_RE = new RegExp(`${ESC}\\[\\?([0-9;]+)([hl])`, "g");

const PARTIAL_MODE_RE = new RegExp(`${ESC}(?:\\[\\??[0-9;]{0,16})?$`);

export interface OutputRecorder {
	push(chunk: string): void;
	snapshot(): string;
	restore(recorded: string): void;
	dispose(): void;
}

export interface OutputRecorderOptions {
	maxChars?: number;
}

function trimToLineStart(text: string, overBy: number): string {
	const boundary = text.indexOf("\n", overBy - 1);
	return boundary === -1 ? "" : text.slice(boundary + 1);
}

export function createOutputRecorder(options: OutputRecorderOptions = {}): OutputRecorder {
	const maxChars = options.maxChars ?? DEFAULT_RECORDER_MAX_CHARS;
	let recorded = "";
	const modes = new Map<number, boolean>();
	let inAltBuffer = false;
	let disposed = false;
	let carry = "";

	const applyModes = (params: string, enabled: boolean): void => {
		for (const raw of params.split(";")) {
			const mode = Number.parseInt(raw, 10);
			if (Number.isNaN(mode)) continue;
			if (ALT_BUFFER_MODES.has(mode)) inAltBuffer = enabled;
			else if (TRACKED_MODES.has(mode)) modes.set(mode, enabled);
		}
	};

	const append = (text: string): void => {
		if (text === "") return;
		recorded += text;
		if (recorded.length > maxChars) {
			recorded = trimToLineStart(recorded, recorded.length - maxChars);
		}
	};

	const consume = (text: string): void => {
		let cursor = 0;
		PRIVATE_MODE_RE.lastIndex = 0;
		let match = PRIVATE_MODE_RE.exec(text);
		while (match !== null) {
			const before = inAltBuffer;
			if (!before) append(text.slice(cursor, match.index));
			applyModes(match[1] ?? "", match[2] === "h");
			cursor = match.index + match[0].length;
			match = PRIVATE_MODE_RE.exec(text);
		}
		if (!inAltBuffer) append(text.slice(cursor));
	};

	return {
		push(chunk) {
			if (disposed || maxChars <= 0 || chunk === "") return;
			const text = carry + chunk;
			carry = "";
			const partial = PARTIAL_MODE_RE.exec(text);
			if (partial && partial.index > 0) {
				carry = text.slice(partial.index);
				consume(text.slice(0, partial.index));
				return;
			}
			if (partial && partial.index === 0) {
				carry = text;
				return;
			}
			consume(text);
		},
		snapshot() {
			if (recorded === "") return "";
			const prefix: string[] = [];
			prefix.push("\x1b[0m");
			for (const [mode, enabled] of modes) prefix.push(`\x1b[?${mode}${enabled ? "h" : "l"}`);
			return `${prefix.join("")}${recorded}`;
		},
		restore(previous) {
			if (disposed || maxChars <= 0) return;
			recorded =
				previous.length > maxChars
					? trimToLineStart(previous, previous.length - maxChars)
					: previous;
		},
		dispose() {
			disposed = true;
			recorded = "";
			carry = "";
			modes.clear();
		},
	};
}
