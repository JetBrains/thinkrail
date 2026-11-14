const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;
const CSI = 0x9b;
const ST = 0x9c;
const OSC = 0x9d;
const STRING_INTRODUCERS = new Set([0x90, 0x98, OSC, 0x9e, 0x9f]);

const within = (code: number, low: number, high: number): boolean => code >= low && code <= high;
const isControl = (code: number): boolean => code === ESC || within(code, 0x80, 0x9f);

function sequenceEnd(text: string, at: number): number | undefined {
	let code = text.charCodeAt(at);
	let i = at + 1;
	if (code === ESC) {
		const next = text.charCodeAt(i);
		if (!within(next, 0x40, 0x5f)) {
			while (within(text.charCodeAt(i), 0x20, 0x2f)) i++;
			return within(text.charCodeAt(i), 0x30, 0x7e) ? i + 1 : undefined;
		}
		code = next + 0x40;
		i++;
	}
	if (code === CSI) {
		while (within(text.charCodeAt(i), 0x30, 0x3f)) i++;
		while (within(text.charCodeAt(i), 0x20, 0x2f)) i++;
		return within(text.charCodeAt(i), 0x40, 0x7e) ? i + 1 : undefined;
	}
	if (!STRING_INTRODUCERS.has(code)) return i;
	for (; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === ST || (c === BEL && code === OSC)) return i + 1;
		if (c === ESC) return text.charCodeAt(i + 1) === BACKSLASH ? i + 2 : undefined;
		if (isControl(c)) return undefined;
	}
	return undefined;
}

export function stripAnsi(text: string): string {
	if (typeof text !== "string") return text;
	let out = "";
	let from = 0;
	for (let i = 0; i < text.length; i++) {
		if (!isControl(text.charCodeAt(i))) continue;
		out += text.slice(from, i);
		from = sequenceEnd(text, i) ?? i + 1;
		i = from - 1;
	}
	return from === 0 ? text : out + text.slice(from);
}
