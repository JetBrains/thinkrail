/**
 * The 1-based line range in `after` that differs from `before` (contiguous span via common prefix/suffix
 * trim). Returns null when the two are identical. Used to locate the changed region in the rendered doc so
 * the review block can be spliced into the document flow at the right spot.
 */
export function changedLineRange(
	before: string,
	after: string,
): { start: number; end: number } | null {
	const a = before.split("\n");
	const b = after.split("\n");
	if (before === after) return null;
	let p = 0;
	while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
	let s = 0;
	while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s])
		s += 1;
	const start = p + 1; // 1-based first changed line in `after`
	const end = Math.max(start, b.length - s); // 1-based last changed line in `after`
	return { start, end };
}
