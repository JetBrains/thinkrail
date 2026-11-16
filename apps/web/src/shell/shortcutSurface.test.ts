import { expect, test } from "bun:test";
import { localScopesOf, shortcutSurfaceOf } from "./shortcutSurface";

const inside = (...ancestors: string[]) => ({
	closest: (selector: string) =>
		selector.split(", ").some((part) => ancestors.includes(part)) ? ({} as Element) : null,
});

test("the focused element names the surface the cheatsheet lists first", () => {
	expect(shortcutSurfaceOf(inside('[data-key-scope="trees"]'))).toBe("trees");
	expect(shortcutSurfaceOf(inside('[data-key-scope="tabs"]'))).toBe("tabs");
	expect(shortcutSurfaceOf(inside('[role="tab"]', '[role="tablist"]'))).toBeNull();
	expect(shortcutSurfaceOf(inside('[role="treeitem"]', '[role="tree"]'))).toBeNull();
	expect(shortcutSurfaceOf(inside('[data-testid="changes-review"]'))).toBe("review");
	expect(shortcutSurfaceOf(inside("[data-review-surface]"))).toBe("review");
	expect(shortcutSurfaceOf(inside('[data-testid="review-thread-card"]'))).toBe("review");
	expect(shortcutSurfaceOf(inside('[data-testid="chat-composer"]'))).toBe("composer");
	expect(shortcutSurfaceOf(inside("[data-transcript-feed]"))).toBe("transcript");
	expect(shortcutSurfaceOf(inside('[data-testid="history-overlay"]'))).toBe("history");
	expect(shortcutSurfaceOf(inside(".xterm"))).toBe("terminal");
	expect(shortcutSurfaceOf(inside("[data-rail-entry]"))).toBe("panels");
	expect(shortcutSurfaceOf(inside("[data-rail-action]"))).toBeNull();
	expect(shortcutSurfaceOf(inside())).toBeNull();
	expect(shortcutSurfaceOf(null)).toBeNull();
});

test("a feature surface outranks a tree or tab strip around it", () => {
	expect(
		shortcutSurfaceOf(inside('[data-key-scope="trees"]', '[data-testid="changes-review"]')),
	).toBe("review");
	expect(shortcutSurfaceOf(inside(".xterm", '[role="tabpanel"]'))).toBe("terminal");
	expect(shortcutSurfaceOf(inside('[data-key-scope="tabs"]', "[data-review-surface]"))).toBe(
		"review",
	);
});

type FakeNode = {
	matches: (selector: string) => boolean;
	getAttribute: (name: string) => string | null;
	parentElement: FakeNode | null;
};

const chain = (...nodes: { selector?: string; keyScope?: string }[]): FakeNode | null =>
	nodes.reduceRight<FakeNode | null>(
		(parentElement, { selector = "", keyScope }) => ({
			matches: (candidate) => selector !== "" && candidate.split(", ").includes(selector),
			getAttribute: (name) => (name === "data-key-scope" ? (keyScope ?? null) : null),
			parentElement,
		}),
		null,
	);

test("local scopes run from the focused element outward, declared scopes included", () => {
	expect(
		localScopesOf(
			chain({ selector: '[role="treeitem"]' }, { selector: '[role="tree"]', keyScope: "trees" }),
		),
	).toEqual(["trees"]);
	expect(
		localScopesOf(
			chain(
				{ selector: "[data-review-surface]" },
				{},
				{ selector: '[data-testid="changes-review"]' },
			),
		),
	).toEqual(["review.surface", "review"]);
	expect(
		localScopesOf(
			chain(
				{ keyScope: "ask-user-question.card" },
				{ selector: "[data-transcript-feed]" },
				{ keyScope: "ask-user-question.card" },
			),
		),
	).toEqual(["ask-user-question.card", "transcript"]);
	expect(localScopesOf(chain({ selector: '[data-testid="search-palette"]' }))).toEqual(["palette"]);
	expect(localScopesOf(chain({}))).toEqual([]);
	expect(localScopesOf(null)).toEqual([]);
});

test("only the workbench's tab strip and the app's trees are scopes tabs and trees, not every ARIA tab or tree", () => {
	expect(
		localScopesOf(
			chain(
				{ selector: '[role="tab"]' },
				{ selector: '[role="tablist"]', keyScope: "tabs" },
				{ selector: '[role="tabpanel"]' },
			),
		),
	).toEqual(["tabs"]);
	expect(
		localScopesOf(
			chain(
				{ selector: '[role="tab"]' },
				{ selector: '[role="tablist"]' },
				{ keyScope: "ask-user-question.card" },
				{ selector: '[role="tabpanel"]' },
			),
		),
	).toEqual(["ask-user-question.card"]);
	expect(
		localScopesOf(chain({ selector: '[role="treeitem"]' }, { selector: '[role="tree"]' })),
	).toEqual([]);
});
