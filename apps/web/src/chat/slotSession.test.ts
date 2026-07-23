import { expect, test } from "bun:test";
import type { TemplateSlot } from "./slotSession";
import {
	mirrorAllGroups,
	mirrorSlotGroup,
	parseTemplateSlots,
	shiftSlots,
	stripUntouchedSlots,
} from "./slotSession";

// slotSession parses pi's placeholder grammar into visible text + editable ranges — it never evaluates
// it (no args exist client-side; Task B5's composer slot session drives the user through the ranges
// returned here). See slotSession.ts for the grammar this pins against.

// ---- parseTemplateSlots ----

test("$1 repeated shares one group; no argumentHint falls back to argN", () => {
	const { text, slots } = parseTemplateSlots("fix $1 then fix $1 again");
	expect(text).toBe("fix ⟨arg1⟩ then fix ⟨arg1⟩ again");
	expect(slots).toHaveLength(2);
	expect(slots[0]).toEqual({ start: 4, end: 10, group: 0, filled: false });
	expect(slots[1]).toEqual({ start: 20, end: 26, group: 0, filled: false });
	expect(slots[0]?.group).toBe(slots[1]?.group);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("${2:-src/} pre-fills the default text and is marked filled", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { text, slots } = parseTemplateSlots("copy to ${2:-src/}");
	expect(text).toBe("copy to src/");
	expect(slots).toEqual([{ start: 8, end: 12, group: 0, filled: true }]);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("${N:-default} with an empty default is a zero-length filled slot", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { text, slots } = parseTemplateSlots("note: ${1:-}");
	expect(text).toBe("note: ");
	expect(slots).toEqual([{ start: 6, end: 6, group: 0, filled: true }]);
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
	expect(slots[0]).toEqual({ start: 5, end: 11, group: 0, filled: false });
	expect(slots[1]).toEqual({ start: 16, end: 27, group: 1, filled: false });
	expect(slots[0]?.group).not.toBe(slots[1]?.group);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("${@:2:3} still parses to one marker slot — a length limit changes its value-class, not the slot count", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { text, slots } = parseTemplateSlots("send ${@:2:3}");
	expect(text).toBe("send ⟨arguments⟩");
	expect(slots).toEqual([{ start: 5, end: 16, group: 0, filled: false }]);
});

// ---- pi's real $ behavior (no escape syntax exists) ----
// An earlier version of this parser had a $$-escape branch; that was a bug — pi's own substituteArgs
// regex (see slotSession.ts's header comment) has no $-escape alternative at all.

test("a $ that never starts a recognized placeholder is a literal character, unconditionally", () => {
	const { text, slots } = parseTemplateSlots("just $$ dollars");
	expect(text).toBe("just $$ dollars");
	expect(slots).toEqual([]);
});

test("$$1 is a literal $ immediately followed by a live $1 slot — pi has no escape form for $", () => {
	const { text, slots } = parseTemplateSlots("cost is $$1 dollars");
	expect(text).toBe("cost is $⟨arg1⟩ dollars");
	expect(slots).toEqual([{ start: 9, end: 15, group: 0, filled: false }]);
	expect(text.slice(slots[0]?.start, slots[0]?.end)).toBe("⟨arg1⟩");
});

// ---- group scheme: two slots share a group iff they're the same value-class (see TemplateSlot's doc) ----

test("$0 and $ARGUMENTS get DISTINCT groups — $0 is its own positional slot, never an all-args alias", () => {
	const { slots } = parseTemplateSlots("arg0=$0 all=$ARGUMENTS");
	expect(slots).toHaveLength(2);
	expect(slots[0]?.group).not.toBe(slots[1]?.group);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("$@, $ARGUMENTS, and ${@:1} share one group — pi clamps N <= 1 to the same 'from the start' value", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { slots } = parseTemplateSlots("a=$@ b=$ARGUMENTS c=${@:1}");
	expect(slots).toHaveLength(3);
	expect(new Set(slots.map((s) => s.group)).size).toBe(1);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("${@:2} repeated shares one group, same as any repeated placeholder", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { slots } = parseTemplateSlots("x=${@:2} y=${@:2}");
	expect(slots).toHaveLength(2);
	expect(slots[0]?.group).toBe(slots[1]?.group);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("${@:2} and ${@:3} get DISTINCT groups — a different start position is a different value", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { slots } = parseTemplateSlots("x=${@:2} y=${@:3}");
	expect(slots).toHaveLength(2);
	expect(slots[0]?.group).not.toBe(slots[1]?.group);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("${@:2} and ${@:2:3} get DISTINCT groups too — a length limit always makes its own class", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
	const { slots } = parseTemplateSlots("x=${@:2} y=${@:2:3}");
	expect(slots).toHaveLength(2);
	expect(slots[0]?.group).not.toBe(slots[1]?.group);
});

// ---- fidelity: examples verbatim from pi's own bundled docs/prompt-templates.md ----
// Catches future grammar drift against the upstream authority, not just this module's own regex.

test("docs example: 'Create a React component named $1 with features: $@'", () => {
	const { text, slots } = parseTemplateSlots("Create a React component named $1 with features: $@");
	expect(text).toBe("Create a React component named ⟨arg1⟩ with features: ⟨arguments⟩");
	expect(slots).toEqual([
		{ start: 31, end: 37, group: 0, filled: false },
		{ start: 53, end: 64, group: 1, filled: false },
	]);
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
test("docs example: 'Summarize the current state in ${1:-7} bullet points.'", () => {
	const { text, slots } = parseTemplateSlots(
		// biome-ignore lint/suspicious/noTemplateCurlyInString: pi grammar syntax, not a template literal
		"Summarize the current state in ${1:-7} bullet points.",
	);
	expect(text).toBe("Summarize the current state in 7 bullet points.");
	expect(slots).toEqual([{ start: 31, end: 32, group: 0, filled: true }]);
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

// ---- shiftSlots: zero-gap adjacent slots (regression — B5 review) ----
// A "$1$2"-shaped template (no literal text between the placeholders) produces two slots with zero gap:
// `first.end === second.start`. A zero-width insert (pure keystroke, no selection) landing exactly there
// is ambiguous — it could belong to `first` (growing its end) or `second` (pushing its start along). Left
// undifferentiated, the shipped bug always resolved it as "unaffected", which is right for `first.end`
// but silently let `second.start` absorb the inserted text instead of moving out of its way — corrupting
// the sibling's boundary one keystroke at a time. See `slotSession.ts`'s `mapOffset` doc for the fix.

test("shiftSlots: a zero-width insert at a zero-gap boundary pushes the following slot's start forward, never letting it absorb the inserted text", () => {
	const first = slot(0, 6);
	const second = slot(6, 12);
	const [shiftedFirst, shiftedSecond] = shiftSlots([first, second], 6, 0, 3);
	// shiftSlots alone never grows a slot by default — that is the composer's decision (see below) — so
	// `first` is unaffected by this call...
	expect(shiftedFirst).toEqual({ start: 0, end: 6, group: 1, filled: false });
	// ...while `second` is pushed forward by the inserted length, not stolen from.
	expect(shiftedSecond).toEqual({ start: 9, end: 15, group: 1, filled: false });
	// The invariant that actually matters: the two never overlap.
	expect(shiftedSecond?.start).toBeGreaterThanOrEqual(shiftedFirst?.end ?? 0);
});

test("shiftSlots composes with the composer's own active-slot growth to stay non-overlapping across several keystrokes", () => {
	// Simulates `Composer.tsx`'s own post-process for the actively-selected slot: after `shiftSlots`,
	// manually extend the active slot's `end` by the inserted length. `shiftSlots` itself only guarantees
	// the *other* slot's coincident start gets out of the way; growing the active one is layered on top,
	// exactly as production code does it — this pins that the composition never overlaps, keystroke after
	// keystroke, not just on the first one.
	const grow = (slots: TemplateSlot[], editStart: number, insertedLen: number): TemplateSlot[] =>
		shiftSlots(slots, editStart, 0, insertedLen).map((s, i) =>
			i === 0 ? { ...s, end: s.end + insertedLen } : s,
		);

	let slots: TemplateSlot[] = [slot(0, 6), slot(6, 12)];
	slots = grow(slots, 6, 1); // 1st keystroke, landing right at the shared boundary
	expect(slots).toEqual([
		{ start: 0, end: 7, group: 1, filled: false },
		{ start: 7, end: 13, group: 1, filled: false },
	]);
	expect(slots[1]?.start).toBeGreaterThanOrEqual(slots[0]?.end ?? 0);

	slots = grow(slots, 7, 1); // 2nd keystroke, boundary having moved along with the growth
	slots = grow(slots, 8, 1); // 3rd keystroke
	expect(slots).toEqual([
		{ start: 0, end: 9, group: 1, filled: false },
		{ start: 9, end: 15, group: 1, filled: false },
	]);
	expect(slots[1]?.start).toBeGreaterThanOrEqual(slots[0]?.end ?? 0);
});

// ---- mirrorSlotGroup / mirrorAllGroups ----
// A repeated placeholder (same `group`) is one conceptual argument occurring more than once — pi would
// expand every occurrence from the same value, so the composer mirrors a filled slot's text into its
// unfilled (or differently-filled) group-mates. `stepSlot` (Tab-out) and `submit()` (direct Send) both
// need this; these functions are the pure, shared core both call into (see Composer.tsx).

const gslot = (start: number, end: number, group: number, filled: boolean): TemplateSlot => ({
	start,
	end,
	group,
	filled,
});

test("mirrorSlotGroup propagates the source's text into a differing same-group sibling, marking it filled", () => {
	const value = "a=X b=Y";
	const slots = [gslot(2, 3, 0, true), gslot(6, 7, 0, false)];
	const { value: next, slots: nextSlots } = mirrorSlotGroup(value, slots, 0);
	expect(next).toBe("a=X b=X");
	expect(nextSlots[0]).toEqual({ start: 2, end: 3, group: 0, filled: true });
	expect(nextSlots[1]).toEqual({ start: 6, end: 7, group: 0, filled: true });
});

test("mirrorSlotGroup never touches a sibling in a different group", () => {
	const value = "a=X b=Y";
	const slots = [gslot(2, 3, 0, true), gslot(6, 7, 1, false)];
	const { value: next, slots: nextSlots } = mirrorSlotGroup(value, slots, 0);
	expect(next).toBe(value);
	expect(nextSlots[1]).toEqual(slots[1]);
});

test("mirrorSlotGroup is a no-op once every member of a group already agrees — returns the same references", () => {
	const value = "a=X b=X";
	const slots = [gslot(2, 3, 0, true), gslot(6, 7, 0, true)];
	const { value: next, slots: nextSlots } = mirrorSlotGroup(value, slots, 0);
	expect(next).toBe(value);
	expect(nextSlots).toBe(slots);
});

test("mirrorSlotGroup propagates a MULTI-WORD value into every same-group sibling, re-tracking offsets", () => {
	// three occurrences of one placeholder (one group) — the /rename shape at scale
	const { text, slots } = parseTemplateSlots("update $1, then test $1, then ship $1");
	expect(slots).toHaveLength(3);
	expect(new Set(slots.map((s) => s.group)).size).toBe(1); // all one group
	// simulate the user typing a multi-word value into the first occurrence
	const filled = "the auth module";
	const s0 = slots[0];
	if (!s0) throw new Error("expected a first slot");
	const value = text.slice(0, s0.start) + filled + text.slice(s0.end);
	const filledSlots = shiftSlots(slots, s0.start, s0.end - s0.start, filled.length).map((s, i) =>
		i === 0 ? { ...s, filled: true } : s,
	);
	const { value: next, slots: out } = mirrorSlotGroup(value, filledSlots, 0);
	expect(next).toBe("update the auth module, then test the auth module, then ship the auth module");
	// every occurrence carries the full multi-word text, and each slot's range still bounds it exactly
	for (const s of out) expect(next.slice(s.start, s.end)).toBe(filled);
});

test("mirrorAllGroups propagates every already-filled slot's text into its own group's unfilled siblings, and never touches a different group", () => {
	const value = "W.m.M";
	const slots = [gslot(0, 1, 0, true), gslot(2, 3, 1, false), gslot(4, 5, 0, false)];
	const { value: next, slots: nextSlots } = mirrorAllGroups(value, slots);
	expect(next).toBe("W.m.W");
	expect(nextSlots[0]).toEqual({ start: 0, end: 1, group: 0, filled: true });
	expect(nextSlots[1]).toEqual({ start: 2, end: 3, group: 1, filled: false });
	expect(nextSlots[2]).toEqual({ start: 4, end: 5, group: 0, filled: true });
});

test("mirrorAllGroups: when two siblings are independently filled with different text, the earliest in array order wins", () => {
	const value = "a=X b=Y";
	const slots = [gslot(2, 3, 0, true), gslot(6, 7, 0, true)];
	const { value: next, slots: nextSlots } = mirrorAllGroups(value, slots);
	expect(next).toBe("a=X b=X");
	expect(nextSlots.every((s) => s.filled)).toBe(true);
});
