// Parses pi's prompt-template placeholder grammar (`$1..$n`, `$@`/`$ARGUMENTS`, `${N:-default}`,
// `${@:N}`, `${@:N:L}`, `$$` escape — pi's grammar, single owner; see `packages/server/src/templates/`,
// which walks the same template dirs but never evaluates the grammar either) into visible text +
// editable slot ranges for the composer's future Tab-through slot session (Task B5). This module only
// ever PARSES — no args exist client-side (the user fills slots interactively), so there is nothing here
// to *evaluate*; that stays pi's, server-side, via `PromptOptions.expandPromptTemplates` (defaults to
// `true`) — the same in-session expansion that already runs a typed-through `/name args` prompt today,
// with or without this module. Pure: no React, no store/transport, no `pi` import of any kind — plain
// strings and offsets in, plain strings and offsets out.

/**
 * One editable range inside `ParsedTemplate.text` — a placeholder pi's grammar expanded, tracked by
 * plain offsets (a plain textarea, no contentEditable in V1; `shiftSlots` re-tracks these across edits).
 * `group` ties sibling ranges together so the composer can mirror an edit across them on slot exit:
 * repeated `$N` (and `${N:-default}` for the same N) share `N` itself; the `⟨arguments⟩`-style forms use
 * `0` for the plain "all arguments" spelling (`$@`/`$ARGUMENTS` — aliases of each other) and `-N` for
 * `${@:N}`/`${@:N:L}` (negative so it can never collide with a positional group, which is always ≥ 1).
 */
export interface TemplateSlot {
	start: number;
	end: number;
	group: number;
	/** shown marker or prefilled default */
	filled: boolean;
}

/** The result of expanding one template body: the visible text plus its editable slot ranges. */
export interface ParsedTemplate {
	text: string;
	slots: TemplateSlot[];
}

// The one scan across the grammar: `$$` escape | `$N` | `${N:-default}` | `$ARGUMENTS` | `$@` |
// `${@:N}` / `${@:N:L}`. Capture groups line up with the branches below: 1 = N for `$N`, 2/3 = N/default
// for `${N:-default}`, 4/5 = N/L for `${@:N(:L)}` (L is read from the match but doesn't affect grouping —
// see the `TemplateSlot.group` doc above).
const SLOT_PATTERN = /\$\$|\$(\d+)|\$\{(\d+):-([^}]*)\}|\$ARGUMENTS|\$@|\$\{@:(\d+)(?::(\d+))?\}/g;

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
 * Expand pi's placeholders into visible text + editable ranges (see {@link TemplateSlot}). `$N` becomes
 * a visible `⟨hint⟩` marker (or `⟨argN⟩` without a usable hint word), `filled: false` — nothing is
 * "there" yet, it's a prompt to fill in. `${N:-default}` inserts the default text itself, `filled: true`
 * — it's already real content, just still selected/editable. `$@`/`$ARGUMENTS`/`${@:N}`/`${@:N:L}` each
 * become one `⟨arguments⟩` marker slot. `$$` collapses to a literal `$` with no slot at all. Parse
 * only — evaluation semantics (what a slot's content actually substitutes to) stay pi's.
 */
export function parseTemplateSlots(body: string, argumentHint?: string): ParsedTemplate {
	let text = "";
	let cursor = 0;
	const slots: TemplateSlot[] = [];

	for (const match of body.matchAll(SLOT_PATTERN)) {
		const [full = "", posArg, defArg, defValue = "", argsFromArg] = match;
		text += body.slice(cursor, match.index);
		cursor = match.index + full.length;

		if (full === "$$") {
			text += "$";
		} else if (posArg !== undefined) {
			const n = Number(posArg);
			const marker = `⟨${hintMarkerWord(argumentHint, n)}⟩`;
			const start = text.length;
			text += marker;
			slots.push({ start, end: start + marker.length, group: n, filled: false });
		} else if (defArg !== undefined) {
			const n = Number(defArg);
			const start = text.length;
			text += defValue;
			slots.push({ start, end: start + defValue.length, group: n, filled: true });
		} else {
			// $ARGUMENTS, $@, ${@:N}, or ${@:N:L} — one ⟨arguments⟩ marker each (never one slot per
			// captured number: the whole construct is a single unit, see the module-doc grouping rule).
			const start = text.length;
			text += ARGUMENTS_MARKER;
			const group = argsFromArg !== undefined ? -Number(argsFromArg) : 0;
			slots.push({ start, end: start + ARGUMENTS_MARKER.length, group, filled: false });
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
