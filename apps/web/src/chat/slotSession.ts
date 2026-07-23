// Parses pi's prompt-template placeholder grammar (`$1..$n`, `$@`/`$ARGUMENTS`, `${N:-default}`,
// `${@:N}`, `${@:N:L}` — pi's grammar, single owner; verified against the installed
// `@earendil-works/pi-coding-agent`'s own `substituteArgs` regex (`dist/core/prompt-templates.js`) and
// its `docs/prompt-templates.md`, and see `packages/server/src/templates/`, which walks the same
// template dirs but never evaluates the grammar either) into visible text + editable slot ranges for the
// composer's future Tab-through slot session (Task B5). This module only ever PARSES — no args exist
// client-side (the user fills slots interactively), so there is nothing here to *evaluate*; that stays
// pi's, server-side, via `PromptOptions.expandPromptTemplates` (defaults to `true`) — the same
// in-session expansion that already runs a typed-through `/name args` prompt today, with or without this
// module. pi has **no escape syntax**: a lone `$` that doesn't start a recognized placeholder is always
// just a literal `$` passed through untouched (see `parseTemplateSlots`'s doc for the `$$1` case this
// implies). Pure: no React, no store/transport, no `pi` import of any kind — plain strings and offsets
// in, plain strings and offsets out.

/**
 * One editable range inside `ParsedTemplate.text` — a placeholder pi's grammar expanded, tracked by
 * plain offsets (a plain textarea, no contentEditable in V1; `shiftSlots` re-tracks these across edits).
 * `group` ties sibling ranges together so the composer can mirror an edit across them on slot exit — two
 * slots share a `group` iff they're the same conceptual argument slot (pi would treat them as one
 * mirrored value). Internally, each distinct placeholder form gets a fresh, opaque `group` number the
 * first time it's seen, in appearance order (see `groupFor`) — the number itself carries no meaning
 * beyond equality:
 *  - positional `$N` and `${N:-default}` share one group per `N`. `N` ≥ 0 is valid syntax — pi evaluates
 *    `$0` as always-blank (there's no argument 0), but it's still its own distinct positional slot, never
 *    the same group as any of the all-arguments forms below.
 *  - the plain "all arguments" spellings — `$@`, `$ARGUMENTS`, and `${@:N}` with N ≤ 1 — are pi-verified
 *    aliases of each other (pi clamps N ≤ 1 to "from the start", so they're the same value for any args)
 *    and share one group.
 *  - an unlimited `${@:N}` with N ≥ 2 gets its own group per distinct `N` (a different start position is
 *    generally a different value, so `${@:2}` and `${@:3}` never share).
 *  - a length-limited `${@:N:L}` gets its own group per distinct `N:L` pair, for *any* `N` — the limit
 *    changes the value even when N ≤ 1 (a truncated slice of "all arguments" isn't "all arguments"), so
 *    it never joins the plain all-arguments group either.
 */
export interface TemplateSlot {
	start: number;
	end: number;
	group: number;
	/** shown marker or prefilled default */
	filled: boolean;
}

/**
 * The result of expanding one template body: the visible text plus its editable slot ranges. `slots` is
 * the **sole source of truth** for where the editable ranges are — never re-derive positions by scanning
 * `text` for the `⟨…⟩` marker glyphs; a template body may legitimately contain those characters itself.
 */
export interface ParsedTemplate {
	text: string;
	slots: TemplateSlot[];
}

// The one scan across the grammar, lifted verbatim from pi's own `substituteArgs` regex
// (`@earendil-works/pi-coding-agent`'s `dist/core/prompt-templates.js`) — pi has no `$$`/escape
// alternative at all, which is why there isn't one here either. Capture groups line up with the branches
// below: 1/2 = N/default for `${N:-default}`, 3/4 = N/L for `${@:N(:L)}`, 5 = the bare form's payload
// ("ARGUMENTS", "@", or a digit string for `$N`).
const SLOT_PATTERN = /\$\{(\d+):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g;

const ARGUMENTS_MARKER = "⟨arguments⟩";

/**
 * The Nth (1-based) word of `argumentHint`, stripped of the `[]` brackets pi's own hint convention wraps
 * words in (e.g. `"[file] [severity]"`). Falls back to `argN` when there's no hint, the hint has fewer
 * than N words, or the Nth word strips down to nothing (e.g. a bare `"[]"`).
 */
function hintMarkerWord(argumentHint: string | undefined, n: number): string {
	const word = argumentHint?.trim().split(/\s+/).filter(Boolean)[n - 1];
	const stripped = word?.replace(/[[\]]/g, "");
	return stripped || `arg${n}`;
}

/**
 * Assigns each distinct value-class `key` (see {@link TemplateSlot}'s `group` doc) a fresh, opaque
 * `group` number the first time it's seen, in appearance order; later matches of the same key reuse it.
 * `seen` is scoped to one `parseTemplateSlots` call — group numbers carry no meaning across calls.
 */
function groupFor(key: string, seen: Map<string, number>): number {
	const existing = seen.get(key);
	if (existing !== undefined) return existing;
	const group = seen.size;
	seen.set(key, group);
	return group;
}

/** The `${@:N}` / `${@:N:L}` value-class key (see {@link TemplateSlot}'s `group` doc): the length limit,
 * when present, always makes its own class; without one, N ≤ 1 clamps to the plain all-arguments class. */
function rangeKey(rangeN: string, rangeL: string | undefined): string {
	if (rangeL !== undefined) return `args:${rangeN}:${rangeL}`;
	return Number(rangeN) <= 1 ? "args" : `args:${rangeN}`;
}

/**
 * Expand pi's placeholders into visible text + editable ranges (see {@link TemplateSlot}). `$N` becomes
 * a visible `⟨hint⟩` marker (or `⟨argN⟩` without a usable hint word), `filled: false` — nothing is
 * "there" yet, it's a prompt to fill in. `${N:-default}` inserts the default text itself, `filled: true`
 * — it's already real content, just still selected/editable. `$@`/`$ARGUMENTS`/`${@:N}`/`${@:N:L}` each
 * become one `⟨arguments⟩` marker slot. Parse only — evaluation semantics (what a slot's content
 * actually substitutes to) stay pi's; in particular, pi has no escape syntax, so a lone `$` that doesn't
 * start a recognized placeholder is always just a literal `$` passed through untouched — e.g. `$$1` is a
 * literal `$` immediately followed by a live `$1` slot, never an escaped `$`.
 */
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

/**
 * On send: strip untouched marker slots (filled=false ranges), collapsing doubled whitespace. Only
 * contiguous runs of spaces/tabs are collapsed (to one space) — a stripped slot's flanking newlines are
 * never touched, so an intentional blank line around a slot-only line survives (it becomes two adjacent
 * `\n`s, not one, and not a space).
 */
export function stripUntouchedSlots(text: string, slots: TemplateSlot[]): string {
	const cuts = slots
		.filter((slot) => !slot.filled)
		.slice()
		.sort((a, b) => a.start - b.start);

	let out = "";
	let cursor = 0;
	for (const cut of cuts) {
		if (cut.start < cursor) continue; // defensive: ignore an out-of-order/overlapping range
		out += text.slice(cursor, cut.start);
		cursor = Math.max(cursor, cut.end);
	}
	out += text.slice(cursor);

	return out.replace(/[ \t]{2,}/g, " ");
}

/**
 * Map one offset across a `[editStart, editEnd)` → `insertedLen`-chars text edit, preserving the
 * invariant `shiftSlots` exists to hold: **slots never overlap after a shift**. A point at or before
 * `editStart` is unaffected; at or after `editEnd` it shifts by the net length delta; a point strictly
 * inside the replaced span collapses to just after the inserted text (this is what makes `shiftSlots`
 * grow/shrink a slot whose interior an edit lands in, rather than leaving it pointing at stale content).
 *
 * `isSlotStart` breaks the one remaining tie, for **zero-width insertions** (`editStart === editEnd`)
 * landing exactly on a point where one slot's `end` meets the next one's `start` with zero gap between
 * them (e.g. a `"$1$2"`-shaped template, no literal text separating the two placeholders). Both
 * `pos <= editStart` (an `end`, unaffected) and `pos >= editEnd` (a `start`, shifted) are simultaneously
 * true at that exact point when `editStart === editEnd` — without a tie-break, the *first* branch always
 * wins, which is correct for the `end` it belongs to but wrong for the coincident `start` right after it:
 * left in place, that `start` would silently absorb whatever was just inserted (the following slot's
 * left edge grows by the insert instead of the slot being pushed out of its way — a real, previously
 * shipped bug: two zero-gap-adjacent slots, filling the first via more than one keystroke, corrupted the
 * second's boundary one character at a time). The fix: a `start` exactly at a zero-width insert's point
 * is always treated as `>= editEnd` (pushed forward, out of the way) rather than `<= editStart`
 * (unaffected) — an `end` at that same point is untouched by this tie-break and still defaults to
 * unaffected, i.e. it does **not** grow on its own. Growing the slot an edit is conceptually "inside"
 * (e.g. the composer's actively-selected slot, as the user keeps typing past its end) is a UI/intent
 * decision this pure module can't make — that stays the composer's job (see `Composer.tsx`'s own
 * `growing` check) and composes correctly on top of this: the composer grows the one slot it knows is
 * active, this function independently guarantees any *other* slot's coincident start gets out of the way,
 * and the two together never overlap.
 */
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

/**
 * Re-track ranges across a text edit at `[editStart, editStart + removedLen)` replaced by `insertedLen`
 * chars: an edit before a slot shifts it (same length); an edit after a slot leaves it untouched; an
 * edit inside a slot grows/shrinks it to match. Purely geometric — it never touches `filled` or `group`.
 * Whether an edit inside a slot should also flip `filled` to `true` is a decision about user intent
 * (did they actually type something, vs. e.g. an external re-render touching the range?) that belongs to
 * the composer's slot session (Task B5), not this parser; this function only ever moves boundaries.
 *
 * **Invariant: slots never overlap after a shift** — including the degenerate case of two zero-gap-
 * adjacent slots (see `mapOffset`'s `isSlotStart` tie-break). Returns a new array — `slots` is never
 * mutated.
 */
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

/**
 * Propagate slot `sourceIdx`'s current text into every OTHER slot sharing its `group`, marking each one
 * `filled: true` as it's overwritten — the same mirroring rule {@link TemplateSlot}'s `group` doc
 * documents (siblings are one conceptual argument; pi would expand them from the same value). A sibling
 * whose text already matches is left untouched — including its `filled` flag, so a sibling a user
 * independently typed the same text into isn't retroactively relabeled "just mirrored." Skips `sourceIdx`
 * itself. Purely geometric composition of `shiftSlots`, one sibling at a time, left to right — safe
 * because mirroring never changes which offsets are `group`-equal, only their text/`filled`.
 *
 * Returns `{ value, slots }` unchanged (same references) when there's nothing to mirror — no group-mate,
 * or every group-mate already agrees — so a caller can cheaply skip the `onChange`/`setSlots` it would
 * otherwise trigger.
 */
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

/** One of the composer backdrop's four tint states for a highlight segment: `"plain"` is ordinary text
 * (outside any slot, no tint); `"unfilled"`/`"filled"` mirror a slot's own `filled` flag; `"active"`
 * overrides both for whichever slot the session is currently sitting on (`Composer`'s `slotIdx`). */
export type SlotHighlightState = "plain" | "unfilled" | "filled" | "active";

/** One run of `value` for the composer's highlight backdrop, tagged with the tint its span should render
 * (see {@link SlotHighlightState}). Ordered left to right; concatenating every `text` reconstructs
 * `value` exactly. */
export interface SlotSegment {
	text: string;
	state: SlotHighlightState;
}

/**
 * Break `value` into ordered segments for the highlight backdrop (see `Composer.tsx`'s backdrop layer):
 * text inside a slot range is `"active"` when its index into `slots` equals `activeIdx`, else
 * `"filled"`/`"unfilled"` per that slot's own `filled` flag; text between/outside slots is `"plain"`.
 * `slots` is assumed non-overlapping and sorted by `start` (it is, post-`shiftSlots` — this function
 * still sorts defensively by `start` before walking, so a caller passing them in `slots` array order
 * rather than left-to-right text order can't produce out-of-order segments). Zero-gap-adjacent slots
 * (the `$1$2` shape — one slot's `end` equals the next one's `start`) never get an empty `"plain"`
 * segment spliced between them: a plain run is only emitted for a strictly positive gap. Pure — no
 * React, just offsets and slices, so the tests can assert the concatenation invariant directly. `activeIdx`
 * is an index into `slots` (matching `Composer`'s own `slotIdx` state), not a text offset; an out-of-range
 * value (e.g. `-1`) simply means no segment is ever marked `"active"`.
 */
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

/**
 * `mirrorSlotGroup` for every already-`filled` slot, in array order — the composer's send path has no
 * single "slot the user just left" the way Tab-stepping does (`Composer.tsx`'s `stepSlot`, the sole other
 * caller of `mirrorSlotGroup`): a direct Send can happen with any subset of slots filled, in any order, so
 * every filled slot needs to propagate to its unfilled group-mates, not just the most recently edited one.
 *
 * When two group-mates are BOTH already filled and disagree (each independently typed into, never
 * mirrored against each other — Tab-stepping's own mirroring would normally prevent this, but a direct
 * Send can still reach it, e.g. pasting into a later slot without ever tabbing back through an earlier
 * one), the earliest one in array order wins: later iterations see the earlier slot's mirrored text
 * already sitting at that group's shared offsets and treat it as agreement, same as any other
 * already-matching sibling. Which literal value "wins" here is inherently arbitrary — the two disagreeing
 * values can't both survive — earliest-wins is just a deterministic, easy-to-explain tie-break.
 */
export function mirrorAllGroups(
	value: string,
	slots: TemplateSlot[],
): { value: string; slots: TemplateSlot[] } {
	let nextValue = value;
	let nextSlots = slots;
	for (let i = 0; i < nextSlots.length; i++) {
		if (nextSlots[i]?.filled) {
			({ value: nextValue, slots: nextSlots } = mirrorSlotGroup(nextValue, nextSlots, i));
		}
	}
	return { value: nextValue, slots: nextSlots };
}
