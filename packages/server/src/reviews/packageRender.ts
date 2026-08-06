// The structured context package a send hands the agent as its first user message (or follow-up):
// review items with stable ids, fragments + bounded surrounding context — never the full diff (the
// agent reads the worktree with its own tools). Pure: file access comes in as a callback.

import type { Review, ReviewComment } from "@thinkrail/contracts";
import { lineRangeOf, textQuoteOf } from "./anchoring";

/** How many lines of surrounding context each anchored comment inlines on each side of its fragment. */
export const CONTEXT_LINES = 10;

export interface PackageInput {
	review: Review;
	branch: string;
	baseBranch: string;
	comments: ReviewComment[];
	/** A worktree file's current content, or `null` when unreadable/gone. */
	readFile: (path: string) => string | null;
	/** A file's content at a ref — how a `side: "base"` anchor reads its own (pre-change) content. */
	readBase: (ref: string, path: string) => string | null;
}

const INSTRUCTIONS = `Address each review comment above.
- Edit the worktree files directly with your normal tools; read any file you need — the fragments above are excerpts, not the whole picture.
- After you have addressed a comment (by an edit, or by an answer when no change is needed), call resolve_comment with its id and a one-line note of what you did.
- If a comment is unclear or you disagree, reply in the conversation instead of editing, and do NOT resolve it.
- A comment marked outdated includes the fragment as it was when the comment was written — verify against the current file first.
- A comment with side="base" points at the PRE-change version of the file: its lines and fragment index base-ref, not the worktree. It is a remark about what the change removed or replaced — find the corresponding place in the current file before editing.`;

function contextBlock(content: string, startLine: number, endLine: number): string {
	const lines = content.split("\n");
	const from = Math.max(1, startLine - CONTEXT_LINES);
	const to = Math.min(lines.length, endLine + CONTEXT_LINES);
	return lines.slice(from - 1, to).join("\n");
}

function renderComment(comment: ReviewComment, input: PackageInput): string {
	const anchor = comment.anchor;
	const range = anchor ? lineRangeOf(anchor) : undefined;
	const attrs = [
		`id="${comment.id}"`,
		`kind="${comment.kind}"`,
		...(anchor ? [`path="${anchor.path}"`, `side="${anchor.side}"`] : []),
		...(anchor?.baseRef ? [`base-ref="${anchor.baseRef}"`] : []),
		...(range ? [`lines="${range.startLine}-${range.endLine}"`] : []),
		`anchor="${comment.anchorState}"`,
	];
	const parts = [`<comment ${attrs.join(" ")}>`];
	const quote = anchor ? textQuoteOf(anchor) : undefined;
	if (quote?.exact) parts.push(`<fragment>\n${quote.exact}\n</fragment>`);
	if (anchor && range && comment.anchorState !== "outdated") {
		// Each side reads its OWN content: a base anchor's line numbers index the pre-change blob, so
		// pulling worktree lines here would caption the fragment with unrelated code.
		const content =
			anchor.side === "base"
				? anchor.baseRef
					? input.readBase(anchor.baseRef, anchor.path)
					: null
				: input.readFile(anchor.path);
		if (content !== null) {
			const from = Math.max(1, range.startLine - CONTEXT_LINES);
			const scope = anchor.side === "base" ? ` side="base"` : "";
			parts.push(
				`<context lines="${from}-${Math.min(content.split("\n").length, range.endLine + CONTEXT_LINES)}"${scope}>\n${contextBlock(content, range.startLine, range.endLine)}\n</context>`,
			);
		}
	}
	parts.push(`<text>\n${comment.body}\n</text>`, "</comment>");
	return parts.join("\n");
}

/** Render the whole package: header, the structured review items, then the standing instructions. */
export function renderPackage(input: PackageInput): string {
	const { review, comments } = input;
	const header = `<review id="${review.id}" branch="${input.branch}" base="${input.baseBranch}@${review.baseSha}" comments="${comments.length}">`;
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
