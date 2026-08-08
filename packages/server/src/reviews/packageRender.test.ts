import { expect, test } from "bun:test";
import type { Review, ReviewComment } from "@thinkrail/contracts";
import { buildTextQuote, hashContent } from "./anchoring";
import { renderPackage } from "./packageRender";

const CONTENT = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
/** The pre-change blob a `side: "base"` anchor points into — deliberately unlike the worktree's. */
const BASE_CONTENT = Array.from({ length: 40 }, (_, i) => `old ${i + 1}`).join("\n");

const review: Review = {
	id: "rev_1",
	workspaceId: "ws1",
	status: "open",
	baseSha: "abc123",
	createdAt: 0,
};

function comment(over: Partial<ReviewComment>): ReviewComment {
	return {
		id: "rc_1",
		reviewId: "rev_1",
		kind: "inline",
		anchor: {
			path: "src/x.ts",
			side: "worktree",
			contentHash: hashContent(CONTENT),
			selectors: [
				{ kind: "lineRange", startLine: 20, endLine: 21 },
				buildTextQuote(CONTENT, 20, 21),
			],
		},
		body: "Rename this.",
		status: "draft",
		anchorState: "anchored",
		createdAt: 0,
		...over,
	};
}

test("renders structured items with stable ids, fragment, bounded context, instructions", () => {
	const text = renderPackage({
		review,
		branch: "feat",
		baseBranch: "main",
		comments: [comment({})],
		readFile: () => CONTENT,
		readBase: () => BASE_CONTENT,
	});
	expect(text).toContain('<review id="rev_1" branch="feat" base="main@abc123" comments="1">');
	expect(text).toContain(
		'<comment id="rc_1" kind="inline" path="src/x.ts" side="worktree" lines="20-21" anchor="anchored">',
	);
	expect(text).toContain("<fragment>\nline 20\nline 21\n</fragment>");
	// ±10 lines of context.
	expect(text).toContain('<context lines="10-31">');
	expect(text).toContain("resolve_comment");
});

test("an outdated comment keeps its fragment but inlines no context", () => {
	const text = renderPackage({
		review,
		branch: "feat",
		baseBranch: "main",
		comments: [comment({ anchorState: "outdated" })],
		readFile: () => null,
		readBase: () => null,
	});
	expect(text).toContain('anchor="outdated"');
	expect(text).toContain("<fragment>");
	expect(text).not.toContain("<context");
});

test("a base-side comment quotes and contextualizes the BASE blob, never the worktree", () => {
	const text = renderPackage({
		review,
		branch: "feat",
		baseBranch: "main",
		comments: [
			comment({
				kind: "diff",
				anchor: {
					path: "src/x.ts",
					side: "base",
					baseRef: "deadbee",
					contentHash: hashContent(BASE_CONTENT),
					selectors: [
						{ kind: "lineRange", startLine: 20, endLine: 21 },
						buildTextQuote(BASE_CONTENT, 20, 21),
					],
				},
				body: "Why was this dropped?",
			}),
		],
		readFile: () => CONTENT,
		readBase: (ref, path) => (ref === "deadbee" && path === "src/x.ts" ? BASE_CONTENT : null),
	});
	expect(text).toContain('side="base" base-ref="deadbee" lines="20-21"');
	expect(text).toContain("<fragment>\nold 20\nold 21\n</fragment>");
	expect(text).toContain('<context lines="10-31" side="base">');
	// The worktree's own line 20 must not leak in as this comment's context.
	expect(text).not.toContain("line 20");
});

test("review-level comments render without anchor attributes", () => {
	const text = renderPackage({
		review,
		branch: "feat",
		baseBranch: "main",
		comments: [comment({ id: "rc_2", kind: "review", anchor: null, body: "No tests at all." })],
		readFile: () => null,
		readBase: () => null,
	});
	expect(text).toContain('<comment id="rc_2" kind="review" anchor="anchored">');
	expect(text).toContain("No tests at all.");
});

test("the header and item lines keep the exact shape the web summary parser pins (chat/reviewPackage.ts)", () => {
	// The chat renders a package as its one-sentence summary by STRUCTURALLY matching these lines; a
	// renderer change that reshapes them silently turns every summary back into raw XML (it already
	// happened once, over an id-prefix detail). Change this test and the web parser TOGETHER.
	const text = renderPackage({
		review,
		branch: "feat",
		baseBranch: "main",
		comments: [comment({})],
		readFile: () => CONTENT,
		readBase: () => BASE_CONTENT,
	});
	expect(text).toMatch(/^<review id="[^"]+" branch="[^"]*" base="[^"]*" comments="\d+">$/m);
	expect(text).toMatch(/^<comment id="[^"]+" kind="[^"]+"[^\n]*>$/m);
});
