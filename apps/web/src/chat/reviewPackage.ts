// Recognizes the review context package a review send fires as its (first or follow-up) USER message
// (server: `reviews/packageRender.renderPackage`), so the transcript can open with a human summary —
// "Sent 3 review comments on script.ts" — instead of a wall of structured XML. Pure text parsing over
// the package's own stable markers (the `<review …>` header + `<comment …>` items); anything that
// doesn't match renders as the ordinary user bubble it is.

export interface ReviewPackageSummary {
	/** How many review items the package carries (from the comment items themselves). */
	count: number;
	/** Distinct files the comments anchor to, in package order (empty = review-level notes only). */
	files: string[];
}

/** Parse a user message as a review package; `null` when it isn't one. The match is STRUCTURAL —
 * the header line + comment item lines exactly as `packageRender` writes them — never an id prefix
 * (an id scheme detail already drifted once and silently turned every summary back into raw XML). */
export function parseReviewPackage(text: string): ReviewPackageSummary | null {
	if (!/^<review id="[^"]+" branch="[^"]*" base="[^"]*" comments="\d+">$/m.test(text)) return null;
	const comments = [...text.matchAll(/^<comment id="[^"]+" kind="[^"]+"[^\n]*>$/gm)];
	if (comments.length === 0) return null;
	const files: string[] = [];
	for (const [line] of comments) {
		const path = /\spath="([^"]+)"/.exec(line)?.[1];
		if (path && !files.includes(path)) files.push(path);
	}
	return { count: comments.length, files };
}

/** The summary line — "Sent 3 review comments on script.ts". */
export function reviewPackageLabel(summary: ReviewPackageSummary): string {
	const noun = summary.count === 1 ? "review comment" : "review comments";
	const where =
		summary.files.length === 0
			? "the change set"
			: summary.files.length === 1
				? summary.files[0]
				: `${summary.files.length} files`;
	return `Sent ${summary.count} ${noun} on ${where}`;
}
