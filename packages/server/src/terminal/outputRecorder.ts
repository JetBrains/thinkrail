/**
 * A bounded rolling record of one PTY's output, replayed into a fresh xterm when a client attaches.
 *
 * A shell survives every remount, but the painted screen does not — a remount builds a new xterm with an empty
 * buffer, so without this a surviving shell comes back behind a blank terminal and looks dead. Every comparable
 * implementation replays: VS Code's pty host records raw bytes (`persistentSessionScrollback`), Zed's daemon
 * snapshots the grid, the tmux-backed brokers keep a ring buffer for reconnecting clients.
 *
 * Raw bytes rather than a serialized grid, deliberately: xterm's own parser re-derives the screen, so we never
 * have to model modes we don't yet support.
 */

/** Fallback window when no size is supplied — `AppConfig.terminalReplayKb` is the real source. */
export const DEFAULT_RECORDER_MAX_CHARS = 64 * 1024;

/**
 * DEC private modes worth restoring explicitly.
 *
 * The window is a *tail*: whatever set these may have scrolled out of it, and applying a replay without them
 * leaves the fresh xterm disagreeing with the live shell — arrow keys emitting the wrong bytes, a cursor drawn
 * that the program thinks it hid, paste arriving unbracketed. Only modes actually observed are re-emitted, so
 * a terminal that never touched one keeps xterm's default for it.
 */
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

/** Alt-screen switches. Entering suspends recording; the replay is what the *normal* buffer last held. */
const ALT_BUFFER_MODES: ReadonlySet<number> = new Set([47, 1047, 1049]);

/** The escape byte, named rather than written into the patterns below — a bare control character in a regex
 * literal is indistinguishable from a typo, which is exactly what the lint rule against them is for. */
const ESC = "\u001b";

/** `CSI ? <params> h|l` — the only form that carries the private modes above. */
const PRIVATE_MODE_RE = new RegExp(`${ESC}\\[\\?([0-9;]+)([hl])`, "g");

/**
 * A trailing fragment that could still become a private-mode sequence once the next read arrives.
 *
 * PTY reads are arbitrary byte boundaries, not message boundaries: `ESC [ ? 1 0 4 9 h` can be split across two
 * of them. Matching per-read would miss the switch and record a full-screen app's bytes — the one thing the
 * recorder promises to exclude. Anything longer than a plausible sequence is not held back, so a lone `ESC` in
 * ordinary output cannot stall the recorder.
 */
const PARTIAL_MODE_RE = new RegExp(`${ESC}(?:\\[\\??[0-9;]{0,16})?$`);

export interface OutputRecorder {
	/** Feed one raw read from the PTY. */
	push(chunk: string): void;
	/** Bytes to write into a fresh xterm so it shows what this shell last painted; empty when nothing to show. */
	snapshot(): string;
	/** Seed a revived terminal with the output its predecessor left behind (see `reviveTerminalSessions`). */
	restore(recorded: string): void;
	dispose(): void;
}

export interface OutputRecorderOptions {
	maxChars?: number;
}

/**
 * Trim to a line boundary so a replay never opens mid-line — and, more importantly, never mid-escape-sequence.
 * A sequence cut in half is parsed as literal garbage by the receiving terminal. Escape sequences never contain
 * a newline, so the first byte after one is always a safe place to start.
 */
function trimToLineStart(text: string, overBy: number): string {
	const boundary = text.indexOf("\n", overBy - 1);
	// No newline left to cut at: drop the whole thing rather than emit a fragment of a sequence.
	return boundary === -1 ? "" : text.slice(boundary + 1);
}

export function createOutputRecorder(options: OutputRecorderOptions = {}): OutputRecorder {
	const maxChars = options.maxChars ?? DEFAULT_RECORDER_MAX_CHARS;
	let recorded = "";
	/** Explicitly observed private modes and their last value; unobserved modes keep xterm's default. */
	const modes = new Map<number, boolean>();
	let inAltBuffer = false;
	let disposed = false;
	/** A trailing byte run that may still complete into a mode sequence on the next read. */
	let carry = "";

	/** Apply one private-mode sequence's parameters, reporting whether it switched the alt screen. */
	const applyModes = (params: string, enabled: boolean): void => {
		// `CSI ? 1000 ; 1006 h` sets several at once.
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

	/**
	 * Walk the stream, appending only the segments written while the normal screen was showing.
	 *
	 * Split at each alt-screen transition rather than judging a whole read at once: an enter and an exit can
	 * share one read (a short `vim` session), and output either side of a switch belongs to different screens.
	 */
	const consume = (text: string): void => {
		let cursor = 0;
		PRIVATE_MODE_RE.lastIndex = 0;
		let match = PRIVATE_MODE_RE.exec(text);
		while (match !== null) {
			const before = inAltBuffer;
			// The bytes up to this sequence belong to whichever screen was showing before it. The sequence
			// itself is never recorded: replaying `?1049h` would flip the fresh terminal to the alt screen and
			// show nothing at all, and the modes worth restoring are re-emitted by `snapshot`'s preamble.
			if (!before) append(text.slice(cursor, match.index));
			applyModes(match[1] ?? "", match[2] === "h");
			cursor = match.index + match[0].length;
			match = PRIVATE_MODE_RE.exec(text);
		}
		if (!inAltBuffer) append(text.slice(cursor));
	};

	return {
		push(chunk) {
			// A zero budget is "replay off" (AppConfig.terminalReplayKb = 0): record nothing at all rather than
			// keep a window that trimToLineStart would empty anyway.
			if (disposed || maxChars <= 0 || chunk === "") return;
			// A full-screen app (vim, htop, lazygit) owns the alt screen, and replaying a torn-off slice of one
			// paints garbage no live process will correct — so the alt screen is never recorded and the window
			// keeps what the normal buffer last showed, which is what the user sees again on `:q` anyway.
			const text = carry + chunk;
			carry = "";
			// Hold back a trailing fragment that may still become a mode sequence, so a switch split across two
			// reads is still seen.
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
			// Normalize the pen first: the tail may begin inside a colour run whose SGR scrolled out, which would
			// otherwise inherit whatever the fresh xterm happened to have.
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
