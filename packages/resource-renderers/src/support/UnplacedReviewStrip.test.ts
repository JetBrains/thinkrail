import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResourceRenderer, ReviewThread, SurfaceReview } from "../registry";
import { markdownRenderer } from "../renderers/markdown";
import {
	focusedUnplacedEntry,
	UnplacedReviewStrip,
	unplacedReviewEntries,
} from "./UnplacedReviewStrip";

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
	labelKey: "viewer.renderer.source",
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

function stripMarkup(
	selected: ResourceRenderer,
	reviews: SurfaceReview[],
	candidates = [markdownRenderer, renderer],
	intent: "view" | "diff" = "diff",
): string {
	return renderToStaticMarkup(
		createElement(
			TooltipProvider,
			null,
			createElement(UnplacedReviewStrip, {
				reviews,
				renderer: selected,
				intent,
				candidates,
				onSelectRenderer: () => {},
			}),
		),
	);
}

test("an empty rendered diff explains how to start a review in Source", () => {
	const markup = stripMarkup(markdownRenderer, [surface([])]);
	expect(markup).toContain("To add a comment, switch to Source.");
	expect(markup).toContain(">Comment in Source</button>");
	expect(markup).not.toContain("Comments not placed");
});

test("commenting guidance is absent for supported previews and historical diffs", () => {
	expect(stripMarkup(markdownRenderer, [surface([])], undefined, "view")).toBe("");
	expect(stripMarkup(renderer, [surface([])])).toBe("");
	expect(stripMarkup(markdownRenderer, [])).toBe("");
});

test("commenting guidance never offers a renderer without anchor support", () => {
	expect(stripMarkup(markdownRenderer, [surface([])], [markdownRenderer])).toBe("");
});

test("an unsupported preview keeps existing comments alongside the authoring fallback", () => {
	const markup = stripMarkup(markdownRenderer, [surface([thread("Existing feedback", 2)])]);
	expect(markup).toContain("Existing feedback");
	expect(markup).toContain(">Comment in Source</button>");
	expect(markup).toContain("Show in Source");
});
