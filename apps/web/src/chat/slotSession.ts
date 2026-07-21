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
 * Map one offset across a `[editStart, editEnd)` → `insertedLen`-chars text edit. A point at or before
 * `editStart` is unaffected; at or after `editEnd` it shifts by the net length delta; a point strictly
 * inside the replaced span collapses to just after the inserted text. That last rule is what makes
 * `shiftSlots` grow/shrink a slot whose interior an edit lands in, rather than leaving it pointing at
 * stale content — applied to both `start` and `end` independently, it also degenerates sensibly for an
 * edit that spans a slot boundary.
 */
function mapOffset(pos: number, editStart: number, editEnd: number, insertedLen: number): number {
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
 * Returns a new array — `slots` is never mutated.
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
		start: mapOffset(slot.start, editStart, editEnd, insertedLen),
		end: mapOffset(slot.end, editStart, editEnd, insertedLen),
	}));
}
