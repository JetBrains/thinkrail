import type {
	Review,
	ReviewAnchor,
	ReviewComment,
	ReviewFixComment,
	ReviewFixDetails,
	ReviewSelector,
} from "@thinkrail/contracts";
import { lineRangeOf, textQuoteOf } from "./anchoring";

export function toReviewFixComment(comment: ReviewComment): ReviewFixComment {
	const range = comment.anchor ? lineRangeOf(comment.anchor) : undefined;
	return {
		id: comment.id,
		kind: comment.kind,
		body: comment.body,
		...(comment.anchor?.path ? { path: comment.anchor.path } : {}),
		...(range ? { startLine: range.startLine, endLine: range.endLine } : {}),
	};
}

export function buildReviewFixDetails(input: {
	itemId: string;
	itemTitle: string;
	reviewId?: string;
	note?: string;
	comments: ReviewComment[];
}): ReviewFixDetails {
	return {
		itemId: input.itemId,
		itemTitle: input.itemTitle,
		...(input.reviewId ? { reviewId: input.reviewId } : {}),
		...(input.note ? { note: input.note } : {}),
		comments: input.comments.map(toReviewFixComment),
	};
}

export const CONTEXT_LINES = 10;

export interface PackageInput {
	review: Review;
	branch: string;
	baseBranch: string;
	comments: ReviewComment[];
	readFile: (path: string) => string | null;
	readBase: (ref: string, path: string) => string | null;
}

const INSTRUCTIONS = `Address each review comment above.
- Edit the worktree files directly with your normal tools; read any file you need — the fragments above are excerpts, not the whole picture.
- After you have addressed a comment (by an edit, or by an answer when no change is needed), call resolve_comment with its id and a one-line note of what you did.
- If a comment is unclear or you disagree, reply in the conversation instead of editing, and do NOT resolve it.
- A comment marked outdated includes the fragment as it was when the comment was written — verify against the current file first.
- A comment with a locator instead of a fragment names a position by geometry or document node rather than by lines (an image region in normalized 0..1 coordinates of the rendered size — for an SVG that is its root viewport, so invert the viewport-to-viewBox transform, viewBox origin and preserveAspectRatio included (the default xMidYMid meet letterboxes a viewBox whose aspect differs from width/height), to find the elements under it — or a document node such as a notebook cell): open the file with your own tools to see it.
- A comment with side="base" points at the PRE-change version of the file: its lines and fragment index base-ref, not the worktree. It is a remark about what the change removed or replaced — find the corresponding place in the current file before editing.`;

function contextBlock(content: string, startLine: number, endLine: number): string {
	const lines = content.split("\n");
	const from = Math.max(1, startLine - CONTEXT_LINES);
	const to = Math.min(lines.length, endLine + CONTEXT_LINES);
	return lines.slice(from - 1, to).join("\n");
}

function escapeValue(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/\r/g, "&#13;")
		.replace(/\n/g, "&#10;");
}

function attr(name: string, value: string | number): string {
	return `${name}="${escapeValue(String(value))}"`;
}

function anchorKind(anchor: ReviewAnchor | null): "region" | "structural" | "line" | "file" {
	if (anchor?.selectors.some((s) => s.kind === "region")) return "region";
	if (anchor?.selectors.some((s) => s.kind === "structural")) return "structural";
	if (anchor && lineRangeOf(anchor)) return "line";
	return "file";
}

function fraction(value: number): string {
	return String(Math.round(value * 1000) / 1000);
}

function locatorOf(selector: ReviewSelector, anchor: ReviewAnchor): string | null {
	const path = escapeValue(anchor.path);
	if (selector.kind === "region") {
		const page = selector.page === undefined ? "" : ` page=${selector.page}`;
		const hash = escapeValue(anchor.contentHash ?? "unknown");
		return `image region x=${fraction(selector.x)} y=${fraction(selector.y)} w=${fraction(selector.width)} h=${fraction(selector.height)}${page} of ${path} (sha256 ${hash})`;
	}
	if (selector.kind === "structural")
		return `${escapeValue(selector.scheme)} ${escapeValue(selector.ref)} of ${path}`;
	return null;
}

function locatorLines(anchor: ReviewAnchor): string[] {
	return anchor.selectors.flatMap((selector) => {
		const locator = locatorOf(selector, anchor);
		return locator === null ? [] : [`<locator>${locator}</locator>`];
	});
}

function renderComment(comment: ReviewComment, input: PackageInput): string {
	const anchor = comment.anchor;
	const range = anchor ? lineRangeOf(anchor) : undefined;
	const attrs = [
		attr("id", comment.id),
		attr("kind", comment.kind),
		...(anchor ? [attr("path", anchor.path), attr("side", anchor.side)] : []),
		...(anchor?.baseRef ? [attr("base-ref", anchor.baseRef)] : []),
		...(range ? [attr("lines", `${range.startLine}-${range.endLine}`)] : []),
		attr("anchor", comment.anchorState),
		attr("anchor-kind", anchorKind(anchor)),
	];
	const parts = [`<comment ${attrs.join(" ")}>`];
	if (anchor) parts.push(...locatorLines(anchor));
	const quote = anchor ? textQuoteOf(anchor) : undefined;
	if (quote?.exact) parts.push(`<fragment>\n${quote.exact}\n</fragment>`);
	if (anchor && range && comment.anchorState !== "outdated") {
		const content =
			anchor.side === "base"
				? anchor.baseRef
					? input.readBase(anchor.baseRef, anchor.path)
					: null
				: input.readFile(anchor.path);
		if (content !== null) {
			const from = Math.max(1, range.startLine - CONTEXT_LINES);
			const to = Math.min(content.split("\n").length, range.endLine + CONTEXT_LINES);
			const scope = anchor.side === "base" ? ` side="base"` : "";
			parts.push(
				`<context ${attr("lines", `${from}-${to}`)}${scope}>\n${contextBlock(content, range.startLine, range.endLine)}\n</context>`,
			);
		}
	}
	parts.push(`<text>\n${comment.body}\n</text>`, "</comment>");
	return parts.join("\n");
}

export function renderPackage(input: PackageInput): string {
	const { review, comments } = input;
	const header = `<review ${attr("id", review.id)} ${attr("branch", input.branch)} ${attr("base", `${input.baseBranch}@${review.baseSha}`)} ${attr("comments", comments.length)}>`;
	const intro =
		comments.length === 1
			? "The user left the following review comment. It is a structured review item anchored to the workspace's files."
			: `The user reviewed the current changes and left ${comments.length} comments. They are structured review items anchored to the workspace's files.`;
	return [
		intro,
		"",
		header,
		"",
		...comments.map((comment) => renderComment(comment, input)),
		"",
		`<instructions>\n${INSTRUCTIONS}\n</instructions>`,
		"</review>",
	].join("\n");
}
