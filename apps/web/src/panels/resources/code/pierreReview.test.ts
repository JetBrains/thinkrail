import { expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import type { ResourceRenderer, ReviewThread, SurfaceReview } from "@/resources";
import { focusedUnplacedEntry, unplacedReviewEntries } from "../../UnplacedReviewStrip";
import { diffPlacedThreadIds, renderedDiffLineNumbers } from "./pierreReview";

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
		active: false,
	},
	trust: "bundled",
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
