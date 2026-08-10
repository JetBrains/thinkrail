// Recognizes the review context package a review send fires as its (first or follow-up) USER message
// (server: `reviews/packageRender.renderPackage`), so the transcript can open with a human summary —
// "Sent 3 review comments on script.ts" — instead of a wall of structured XML. Pure text parsing over
// the package's own stable markers (the `<review …>` header + `<comment …>` items); anything that
// doesn't match renders as the ordinary user bubble it is.

/** One review comment as the package carries it — what the transcript card's unfold lists. */
export interface ReviewPackageItem {
	/** Anchored file, `null` for a review-level (whole-change-set) note. */
	path: string | null;
	/** Compact line ref ("L2" / "L2–4"), `""` when the comment carries no line range. */
	lineRef: string;
	/** The quoted code fragment the remark anchored to, `null` when the package carries none. */
	fragment: string | null;
	/** The comment's own text. */
	body: string;
}

export interface ReviewPackageSummary {
	/** How many review items the package carries (from the comment items themselves). */
	count: number;
	/** Distinct files the comments anchor to, in package order (empty = review-level notes only). */
	files: string[];
	/** The comments themselves, in package order — the unfold's content. */
	items: ReviewPackageItem[];
}

/** "2-4" → "L2–4", "2-2" → "L2", absent → "". */
function lineRefOf(lines: string | undefined): string {
	const m = lines ? /^(\d+)-(\d+)$/.exec(lines) : null;
	if (!m) return "";
	return m[1] === m[2] ? `L${m[1]}` : `L${m[1]}–${m[2]}`;
}

/** The body of the FIRST `<tag>\n…\n</tag>` block, `null` when absent (non-greedy: fragments and
 * comment text are user/code content — the nearest closer wins, exactly as the renderer nests them). */
function blockOf(tag: string, block: string): string | null {
	const m = new RegExp(`^<${tag}[^\\n]*>\\n([\\s\\S]*?)\\n</${tag}>$`, "m").exec(block);
	return m?.[1] ?? null;
}

/** Parse a user message as a review package; `null` when it isn't one. The match is STRUCTURAL —
 * the header line + comment item blocks exactly as `packageRender` writes them — never an id prefix
 * (an id scheme detail already drifted once and silently turned every summary back into raw XML). */
export function parseReviewPackage(text: string): ReviewPackageSummary | null {
	if (!/^<review id="[^"]+" branch="[^"]*" base="[^"]*" comments="\d+">$/m.test(text)) return null;
	const comments = [
		...text.matchAll(/^<comment (id="[^"]+" kind="[^"]+"[^\n]*)>$\n([\s\S]*?)^<\/comment>$/gm),
	];
	if (comments.length === 0) return null;
	const files: string[] = [];
	const items: ReviewPackageItem[] = [];
	for (const [, attrs = "", block = ""] of comments) {
		const path = /\spath="([^"]+)"/.exec(attrs)?.[1] ?? null;
		if (path && !files.includes(path)) files.push(path);
		items.push({
			path,
			lineRef: lineRefOf(/\slines="([^"]+)"/.exec(attrs)?.[1]),
			fragment: blockOf("fragment", block),
			body: blockOf("text", block) ?? "",
		});
	}
	return { count: comments.length, files, items };
}

/** The summary line — "Sent 3 review comments on script.ts". */
export function reviewPackageLabel(summary: Pick<ReviewPackageSummary, "count" | "files">): string {
	const noun = summary.count === 1 ? "review comment" : "review comments";
	const where =
		summary.files.length === 0
			? "the change set"
			: summary.files.length === 1
				? summary.files[0]
				: `${summary.files.length} files`;
	return `Sent ${summary.count} ${noun} on ${where}`;
}
