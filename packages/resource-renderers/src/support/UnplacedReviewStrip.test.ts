import { expect, test } from "bun:test";
import type { ResourceRenderer, ReviewThread, SurfaceReview } from "../registry";
import { focusedUnplacedEntry, unplacedReviewEntries } from "./UnplacedReviewStrip";

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
		commenting: { onSave: async () => {}, onSend: async () => {} },
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

test("a capability-matching thread the renderer did not place is unplaced", () => {
	const worktree = surface([thread("collapsed", 2), thread("rendered", 10)]);
	const entries = unplacedReviewEntries([worktree], renderer, "diff", new Set(["rendered"]));
	expect(entries.map((entry) => entry.thread.id)).toEqual(["collapsed"]);
});

test("a focus request on an unplaced thread is routed to the strip", () => {
	const collapsed = thread("collapsed", 2);
	const entries = unplacedReviewEntries(
		[surface([collapsed], collapsed.id)],
		renderer,
		"diff",
		new Set(),
	);
	expect(focusedUnplacedEntry(entries)?.thread.id).toBe(collapsed.id);
});
