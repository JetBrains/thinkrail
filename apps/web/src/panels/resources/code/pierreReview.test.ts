import { expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import type { ResourceRenderer, ReviewThread, SurfaceReview } from "@/resources";
import { focusedUnplacedEntry, unplacedReviewEntries } from "../../UnplacedReviewStrip";
import {
	CROSS_SIDE_MESSAGE,
	diffPlacedThreadIds,
	filePlacedThreadIds,
	renderedDiffLineNumbers,
	selectionComposer,
} from "./pierreReview";

function thread(id: string, line: number): ReviewThread {
	return {
		id,
		anchor: {
			path: "long.ts",
			side: "worktree",
			selectors: [{ kind: "lineRange", startLine: line, endLine: line }],
		},
		body: id,
		status: "draft",
		anchorState: "anchored",
	};
}

function surface(threads: ReviewThread[], focusId?: string): SurfaceReview {
	const focused = focusId ? threads.find((candidate) => candidate.id === focusId) : undefined;
	return {
		threads,
		commenting: {
			onSave: async () => {},
			onSend: async () => {},
		},
		actions: {
			onSendComment: async () => {},
			onDeleteComment: async () => {},
			onUpdateComment: async () => {},
		},
		focus: focused ? { id: focused.id, anchor: focused.anchor } : null,
		onFocusHandled: () => {},
	};
}

const renderer: ResourceRenderer = {
	id: "thinkrail/code",
	label: "Source",
	match: { text: true },
	rank: 100,
	capabilities: {
		view: true,
		diff: true,
		anchors: { view: ["line"], diff: ["line"] },
		mobile: true,
		copy: false,
		layout: false,
		whitespace: false,
	},
};

function collapsedDiff() {
	const original = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
	const modified = original.replace("line 10", "changed 10");
	return parseDiffFromFile(
		{ name: "long.ts", contents: original },
		{ name: "long.ts", contents: modified },
	);
}

test("Pierre placement excludes line annotations inside collapsed unchanged regions", () => {
	const fileDiff = collapsedDiff();
	const collapsed = thread("collapsed", 2);
	const rendered = thread("rendered", 10);
	const worktree = surface([collapsed, rendered]);
	const base = surface([]);
	const lines = renderedDiffLineNumbers(fileDiff);
	const ids = diffPlacedThreadIds(fileDiff, { worktree, base });

	expect(lines.additions.has(2)).toBe(false);
	expect(lines.additions.has(10)).toBe(true);
	expect(ids).toEqual(new Set(["rendered"]));
	const entries = unplacedReviewEntries([worktree], renderer, "diff", ids);
	expect(entries.map((entry) => entry.thread.id)).toEqual(["collapsed"]);
});

test("a focus request on a collapsed line is routed to the unplaced strip", () => {
	const fileDiff = collapsedDiff();
	const collapsed = thread("collapsed", 2);
	const worktree = surface([collapsed], collapsed.id);
	const ids = diffPlacedThreadIds(fileDiff, { worktree, base: surface([]) });
	const entries = unplacedReviewEntries([worktree], renderer, "diff", ids);

	expect(focusedUnplacedEntry(entries)?.thread.id).toBe(collapsed.id);
});

test("a one-sided selection opens a composer on that side; a cross-side selection is blocked, not moved", () => {
	expect(selectionComposer({ start: 7, end: 3, side: "deletions" }, 1)).toMatchObject({
		kind: "composer",
		side: "deletions",
		lineNumber: 7,
		draft: { selectors: [{ kind: "lineRange", startLine: 3, endLine: 7 }], label: "L3–7" },
		label: "Lines 3–7",
	});
	expect(selectionComposer({ start: 2, end: 2 }, 2)).toMatchObject({
		kind: "composer",
		side: "additions",
		label: "Line 2",
	});
	expect(
		selectionComposer({ start: 4, end: 9, side: "deletions", endSide: "additions" }, 3),
	).toEqual({
		kind: "blocked",
		id: 3,
		side: "additions",
		lineNumber: 9,
		message: CROSS_SIDE_MESSAGE,
	});
});

test("a file places only the threads whose end line still exists in the text", () => {
	const thread = (id: string, endLine: number): ReviewThread => ({
		id,
		body: id,
		status: "draft",
		anchorState: "anchored",
		anchor: {
			path: "a.ts",
			side: "worktree",
			contentHash: "h",
			selectors: [{ kind: "lineRange", startLine: endLine, endLine }],
		},
	});
	const whole: ReviewThread = {
		...thread("whole", 1),
		anchor: { ...thread("whole", 1).anchor, selectors: [] },
	};
	expect([
		...filePlacedThreadIds("one\ntwo\nthree\n", [thread("a", 3), thread("b", 4), whole]),
	]).toEqual(["a"]);
	expect([...filePlacedThreadIds("one\ntwo", [thread("a", 2), thread("b", 3)])]).toEqual(["a"]);
	expect([...filePlacedThreadIds("", [thread("a", 1)])]).toEqual([]);
});
