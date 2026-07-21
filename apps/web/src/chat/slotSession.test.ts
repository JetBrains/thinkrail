import { expect, test } from "bun:test";
import type { TemplateSlot } from "./slotSession";
import { parseTemplateSlots, shiftSlots, stripUntouchedSlots } from "./slotSession";

// slotSession parses pi's placeholder grammar into visible text + editable ranges — it never evaluates
// it (no args exist client-side; Task B5's composer slot session drives the user through the ranges
// returned here). See slotSession.ts for the grammar this pins against.

// ---- parseTemplateSlots ----

test("$1 repeated shares one group; no argumentHint falls back to argN", () => {
	const { text, slots } = parseTemplateSlots("fix $1 then fix $1 again");
	expect(text).toBe("fix ⟨arg1⟩ then fix ⟨arg1⟩ again");
	expect(slots).toHaveLength(2);
	expect(slots[0]).toEqual({ start: 4, end: 10, group: 1, filled: false });
	expect(slots[1]).toEqual({ start: 20, end: 26, group: 1, filled: false });
	expect(slots[0]?.group).toBe(slots[1]?.group);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("${2:-src/} pre-fills the default text and is marked filled", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { text, slots } = parseTemplateSlots("copy to ${2:-src/}");
	expect(text).toBe("copy to src/");
	expect(slots).toEqual([{ start: 8, end: 12, group: 2, filled: true }]);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("${N:-default} with an empty default is a zero-length filled slot", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { text, slots } = parseTemplateSlots("note: ${1:-}");
	expect(text).toBe("note: ");
	expect(slots).toEqual([{ start: 6, end: 6, group: 1, filled: true }]);
});

test("$ARGUMENTS becomes one ⟨arguments⟩ marker slot", () => {
	const { text, slots } = parseTemplateSlots("run: $ARGUMENTS");
	expect(text).toBe("run: ⟨arguments⟩");
	expect(slots).toEqual([{ start: 5, end: 16, group: 0, filled: false }]);
});

test("$@ becomes one ⟨arguments⟩ marker slot, sharing $ARGUMENTS's group (they're aliases)", () => {
	const { text, slots } = parseTemplateSlots("run: $@");
	expect(text).toBe("run: ⟨arguments⟩");
	expect(slots).toEqual([{ start: 5, end: 16, group: 0, filled: false }]);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("${@:2} becomes one ⟨arguments⟩ marker slot, grouped apart from $1 and from plain arguments", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { text, slots } = parseTemplateSlots("send $1 and ${@:2}");
	expect(text).toBe("send ⟨arg1⟩ and ⟨arguments⟩");
	expect(slots).toHaveLength(2);
	expect(slots[0]).toEqual({ start: 5, end: 11, group: 1, filled: false });
	expect(slots[1]).toEqual({ start: 16, end: 27, group: -2, filled: false });
	expect(slots[0]?.group).not.toBe(slots[1]?.group);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("${@:2:3} parses the same as ${@:2} — one marker slot; the limit doesn't add a second slot", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { text, slots } = parseTemplateSlots("send ${@:2:3}");
	expect(text).toBe("send ⟨arguments⟩");
	expect(slots).toEqual([{ start: 5, end: 16, group: -2, filled: false }]);
});

test("$$ escapes to a literal $ and creates no slot; offsets after it stay exact", () => {
	const { text, slots } = parseTemplateSlots("cost is $$5, arg: $1");
	expect(text).toBe("cost is $5, arg: ⟨arg1⟩");
	expect(slots).toEqual([{ start: 17, end: 23, group: 1, filled: false }]);
	expect(text.slice(slots[0]?.start, slots[0]?.end)).toBe("⟨arg1⟩");
});

test("marker text uses the Nth argumentHint word, stripped of []-brackets", () => {
	const { text, slots } = parseTemplateSlots("$1 at $2 severity", "[file] [severity]");
	expect(text).toBe("⟨file⟩ at ⟨severity⟩ severity");
	expect(slots).toHaveLength(2);
});

test("a $N beyond the hint's word count falls back to argN", () => {
	const { text } = parseTemplateSlots("$1 $2", "[file]");
	expect(text).toBe("⟨file⟩ ⟨arg2⟩");
});

test("a blank/whitespace-only argumentHint behaves like no hint at all", () => {
	const { text } = parseTemplateSlots("$1", "   ");
	expect(text).toBe("⟨arg1⟩");
});

test("a hint word that strips down to nothing (a bare bracket pair) falls back to argN too", () => {
	const { text } = parseTemplateSlots("$1", "[]");
	expect(text).toBe("⟨arg1⟩");
});

// ---- stripUntouchedSlots ----

test("stripUntouchedSlots removes an unfilled marker and collapses the doubled whitespace it leaves", () => {
	const { text, slots } = parseTemplateSlots("a $1 b");
	expect(text).toBe("a ⟨arg1⟩ b"); // sanity: sits between two single spaces before stripping
	expect(stripUntouchedSlots(text, slots)).toBe("a b");
});

test("stripUntouchedSlots leaves a filled default slot untouched", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { text, slots } = parseTemplateSlots("a ${1:-x} b");
	expect(stripUntouchedSlots(text, slots)).toBe("a x b");
});

test("stripUntouchedSlots strips only the unfilled slot among a mix of filled + unfilled", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { text, slots } = parseTemplateSlots("${1:-keep} then $2");
	// The lone marker sits at the very end behind a single (non-doubled) space, so that one space isn't
	// collapsed — collapsing only ever fires on a *run* of 2+ spaces/tabs, never a single one.
	expect(stripUntouchedSlots(text, slots)).toBe("keep then ");
});

test("stripUntouchedSlots preserves a blank line left by a slot alone on its own line", () => {
	// The newline-preservation case: collapsing must target spaces/tabs only, never eat the newlines
	// flanking a stripped slot — a naive `\s{2,}` collapse would merge the two lines into one.
	const { text, slots } = parseTemplateSlots("line one\n$1\nline two");
	expect(text).toBe("line one\n⟨arg1⟩\nline two");
	expect(stripUntouchedSlots(text, slots)).toBe("line one\n\nline two");
});

test("stripUntouchedSlots collapses only runs of spaces/tabs, not a lone space next to a newline", () => {
	const { text, slots } = parseTemplateSlots("a $1\nb");
	expect(text).toBe("a ⟨arg1⟩\nb");
	expect(stripUntouchedSlots(text, slots)).toBe("a \nb");
});

// ---- shiftSlots ----

const slot = (start: number, end: number): TemplateSlot => ({
	start,
	end,
	group: 1,
	filled: false,
});

test("shiftSlots: an edit before a slot shifts it, leaving its length unchanged", () => {
	const [shifted] = shiftSlots([slot(5, 8)], 0, 0, 3);
	expect(shifted).toEqual({ start: 8, end: 11, group: 1, filled: false });
});

test("shiftSlots: an edit inside a slot grows it by the inserted length", () => {
	const [shifted] = shiftSlots([slot(5, 8)], 6, 0, 4);
	expect(shifted).toEqual({ start: 5, end: 12, group: 1, filled: false });
});

test("shiftSlots: an edit after a slot leaves it untouched", () => {
	const [shifted] = shiftSlots([slot(5, 8)], 10, 0, 5);
	expect(shifted).toEqual({ start: 5, end: 8, group: 1, filled: false });
});

test("shiftSlots: typing over a fully-selected marker resizes the slot to the typed text", () => {
	// "⟨arg1⟩" is 6 chars, selected whole (per the design, a slot is selected on entry) and replaced by
	// typing "index.tsx" (9 chars) — the slot grows to exactly cover the new text.
	const [shifted] = shiftSlots([slot(5, 11)], 5, 6, 9);
	expect(shifted).toEqual({ start: 5, end: 14, group: 1, filled: false });
});

test("shiftSlots: a deletion before a slot shifts it left", () => {
	const [shifted] = shiftSlots([slot(5, 8)], 0, 2, 0);
	expect(shifted).toEqual({ start: 3, end: 6, group: 1, filled: false });
});

test("shiftSlots does not mutate its input", () => {
	const original = slot(5, 8);
	const slots = [original];
	shiftSlots(slots, 0, 0, 1);
	expect(slots[0]).toEqual(original);
});

test("shiftSlots re-tracks every slot in the array independently", () => {
	const shifted = shiftSlots([slot(5, 8), slot(20, 24)], 0, 0, 2);
	expect(shifted[0]).toEqual({ start: 7, end: 10, group: 1, filled: false });
	expect(shifted[1]).toEqual({ start: 22, end: 26, group: 1, filled: false });
});

test("shiftSlots keeps filled/group as-is — it is purely geometric, not a fill-tracking decision", () => {
	const filledSlot: TemplateSlot = { start: 5, end: 8, group: 3, filled: true };
	const [shifted] = shiftSlots([filledSlot], 6, 0, 2);
	expect(shifted).toEqual({ start: 5, end: 10, group: 3, filled: true });
});
