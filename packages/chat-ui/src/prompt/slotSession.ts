export interface TemplateSlot {
	start: number;
	end: number;
	group: number;
	filled: boolean;
	edited?: boolean;
}

export interface ParsedTemplate {
	text: string;
	slots: TemplateSlot[];
}

const SLOT_PATTERN = /\$\{(\d+):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g;

const ARGUMENTS_MARKER = "⟨arguments⟩";

function hintMarkerWord(argumentHint: string | undefined, n: number): string {
	const word = argumentHint?.trim().split(/\s+/).filter(Boolean)[n - 1];
	const stripped = word?.replace(/[[\]]/g, "");
	return stripped || `arg${n}`;
}

function groupFor(key: string, seen: Map<string, number>): number {
	const existing = seen.get(key);
	if (existing !== undefined) return existing;
	const group = seen.size;
	seen.set(key, group);
	return group;
}

function rangeKey(rangeN: string, rangeL: string | undefined): string {
	if (rangeL !== undefined) return `args:${rangeN}:${rangeL}`;
	return Number(rangeN) <= 1 ? "args" : `args:${rangeN}`;
}

export function parseTemplateSlots(body: string, argumentHint?: string): ParsedTemplate {
	let text = "";
	let cursor = 0;
	const slots: TemplateSlot[] = [];
	const groups = new Map<string, number>();

	for (const match of body.matchAll(SLOT_PATTERN)) {
		const [full = "", defN, defValue = "", rangeN, rangeL, simple] = match;
		text += body.slice(cursor, match.index);
		cursor = match.index + full.length;

		if (defN !== undefined) {
			const start = text.length;
			text += defValue;
			const group = groupFor(`pos:${defN}`, groups);
			slots.push({ start, end: start + defValue.length, group, filled: true });
		} else if (rangeN !== undefined) {
			const start = text.length;
			text += ARGUMENTS_MARKER;
			const group = groupFor(rangeKey(rangeN, rangeL), groups);
			slots.push({ start, end: start + ARGUMENTS_MARKER.length, group, filled: false });
		} else if (simple === "ARGUMENTS" || simple === "@") {
			const start = text.length;
			text += ARGUMENTS_MARKER;
			const group = groupFor("args", groups);
			slots.push({ start, end: start + ARGUMENTS_MARKER.length, group, filled: false });
		} else if (simple !== undefined) {
			const marker = `⟨${hintMarkerWord(argumentHint, Number(simple))}⟩`;
			const start = text.length;
			text += marker;
			const group = groupFor(`pos:${simple}`, groups);
			slots.push({ start, end: start + marker.length, group, filled: false });
		}
	}
	text += body.slice(cursor);
	return { text, slots };
}

export function stripUntouchedSlots(text: string, slots: TemplateSlot[]): string {
	const cuts = slots
		.filter((slot) => !slot.filled)
		.slice()
		.sort((a, b) => a.start - b.start);

	let out = "";
	let cursor = 0;
	for (const cut of cuts) {
		if (cut.start < cursor) continue;
		out += text.slice(cursor, cut.start);
		cursor = Math.max(cursor, cut.end);
	}
	out += text.slice(cursor);

	return out.replace(/[ \t]{2,}/g, " ");
}

function mapOffset(
	pos: number,
	editStart: number,
	editEnd: number,
	insertedLen: number,
	isSlotStart: boolean,
): number {
	if (isSlotStart && pos === editStart && editStart === editEnd && insertedLen > 0) {
		return pos + insertedLen;
	}
	if (pos <= editStart) return pos;
	if (pos >= editEnd) return pos + insertedLen - (editEnd - editStart);
	return editStart + insertedLen;
}

export function shiftSlots(
	slots: TemplateSlot[],
	editStart: number,
	removedLen: number,
	insertedLen: number,
): TemplateSlot[] {
	const editEnd = editStart + removedLen;
	return slots.map((slot) => ({
		...slot,
		start: mapOffset(slot.start, editStart, editEnd, insertedLen, true),
		end: mapOffset(slot.end, editStart, editEnd, insertedLen, false),
	}));
}

export function mirrorSlotGroup(
	value: string,
	slots: TemplateSlot[],
	sourceIdx: number,
): { value: string; slots: TemplateSlot[] } {
	const source = slots[sourceIdx];
	if (!source) return { value, slots };
	const text = value.slice(source.start, source.end);
	let nextValue = value;
	let nextSlots = slots;
	for (let i = 0; i < nextSlots.length; i++) {
		if (i === sourceIdx) continue;
		const sib = nextSlots[i];
		if (!sib || sib.group !== source.group) continue;
		if (nextValue.slice(sib.start, sib.end) === text) continue;
		nextValue = nextValue.slice(0, sib.start) + text + nextValue.slice(sib.end);
		nextSlots = shiftSlots(nextSlots, sib.start, sib.end - sib.start, text.length).map((s, si) =>
			si === i ? { ...s, filled: true } : s,
		);
	}
	return { value: nextValue, slots: nextSlots };
}

export type SlotHighlightState = "plain" | "unfilled" | "filled" | "active";

export interface SlotSegment {
	text: string;
	state: SlotHighlightState;
}

export function highlightSegments(
	value: string,
	slots: TemplateSlot[],
	activeIdx: number,
): SlotSegment[] {
	const ordered = slots
		.map((slot, index) => ({ slot, index }))
		.sort((a, b) => a.slot.start - b.slot.start);

	const segments: SlotSegment[] = [];
	let cursor = 0;
	for (const { slot, index } of ordered) {
		if (slot.start > cursor) {
			segments.push({ text: value.slice(cursor, slot.start), state: "plain" });
		}
		const state: SlotHighlightState =
			index === activeIdx ? "active" : slot.filled ? "filled" : "unfilled";
		segments.push({ text: value.slice(slot.start, slot.end), state });
		cursor = Math.max(cursor, slot.end);
	}
	if (cursor < value.length || segments.length === 0) {
		segments.push({ text: value.slice(cursor), state: "plain" });
	}
	return segments;
}

export function mirrorAllGroups(
	value: string,
	slots: TemplateSlot[],
): { value: string; slots: TemplateSlot[] } {
	let nextValue = value;
	let nextSlots = slots;
	for (let i = 0; i < nextSlots.length; i++) {
		if (nextSlots[i]?.edited) {
			({ value: nextValue, slots: nextSlots } = mirrorSlotGroup(nextValue, nextSlots, i));
		}
	}
	return { value: nextValue, slots: nextSlots };
}

export interface TemplateSlotSessionState {
	slots: TemplateSlot[];
	activeIndex: number;
}

export interface TemplateSlotSessionTransition {
	value: string;
	session: TemplateSlotSessionState | null;
	selection: { start: number; end: number };
}

function diffValues(
	oldValue: string,
	newValue: string,
	newCaret: number,
): { editStart: number; removedLen: number; insertedLen: number } {
	const maxPrefix = Math.min(newCaret, oldValue.length, newValue.length);
	let prefix = 0;
	while (prefix < maxPrefix && oldValue[prefix] === newValue[prefix]) prefix++;

	const maxSuffix = Math.min(oldValue.length - prefix, newValue.length - prefix);
	let suffix = 0;
	while (
		suffix < maxSuffix &&
		oldValue[oldValue.length - 1 - suffix] === newValue[newValue.length - 1 - suffix]
	) {
		suffix++;
	}

	return {
		editStart: prefix,
		removedLen: oldValue.length - prefix - suffix,
		insertedLen: newValue.length - prefix - suffix,
	};
}

function touches(slot: TemplateSlot, editStart: number, editEnd: number): boolean {
	return editStart < slot.end && editEnd > slot.start;
}

export function beginTemplateSlotSession(parsed: ParsedTemplate): TemplateSlotSessionTransition {
	const first = parsed.slots[0];
	return {
		value: parsed.text,
		session: first ? { slots: parsed.slots, activeIndex: 0 } : null,
		selection: first
			? { start: first.start, end: first.end }
			: { start: parsed.text.length, end: parsed.text.length },
	};
}

export function applyTemplateSlotEdit(
	oldValue: string,
	newValue: string,
	newCaret: number,
	session: TemplateSlotSessionState,
): TemplateSlotSessionState | null {
	const { editStart, removedLen, insertedLen } = diffValues(oldValue, newValue, newCaret);
	if (editStart === 0 && removedLen === oldValue.length) return null;

	const editEnd = editStart + removedLen;
	const active = session.slots[session.activeIndex];
	const growing =
		removedLen === 0 && insertedLen > 0 && active !== undefined && active.end === editStart;
	const slots = shiftSlots(session.slots, editStart, removedLen, insertedLen).map((slot, index) => {
		const grown =
			growing && index === session.activeIndex
				? {
						...slot,
						end: slot.end + insertedLen,
						filled: true,
						edited: true,
					}
				: slot;
		const original = session.slots[index];
		return original && touches(original, editStart, editEnd)
			? { ...grown, filled: true, edited: true }
			: grown;
	});
	return { ...session, slots };
}

export function stepTemplateSlotSession(
	value: string,
	session: TemplateSlotSessionState,
	direction: 1 | -1,
): TemplateSlotSessionTransition {
	const current = session.slots[session.activeIndex];
	const mirrored = current?.edited
		? mirrorSlotGroup(value, session.slots, session.activeIndex)
		: { value, slots: session.slots };
	const activeIndex =
		(((session.activeIndex + direction) % mirrored.slots.length) + mirrored.slots.length) %
		mirrored.slots.length;
	const target = mirrored.slots[activeIndex];
	return {
		value: mirrored.value,
		session: { slots: mirrored.slots, activeIndex },
		selection: target
			? { start: target.start, end: target.end }
			: { start: mirrored.value.length, end: mirrored.value.length },
	};
}

export function finalizeTemplateSlotSession(
	value: string,
	session: TemplateSlotSessionState | null,
): string {
	if (!session) return value;
	const mirrored = mirrorAllGroups(value, session.slots);
	return stripUntouchedSlots(mirrored.value, mirrored.slots);
}
