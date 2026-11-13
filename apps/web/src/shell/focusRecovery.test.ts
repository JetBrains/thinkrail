import { describe, expect, test } from "bun:test";
import {
	type FocusContext,
	type FocusLevel,
	type FocusLookup,
	isFocusLost,
	nearestControl,
	resolveFocus,
	WAIT,
} from "./focusRecovery";

interface Page {
	rows?: Record<string, readonly string[]>;
	slots?: readonly string[];
	fallbacks?: readonly string[];
	starts?: readonly string[];
	defaults?: readonly string[];
	sibling?: boolean;
	layerStart?: boolean;
	landing?: boolean;
}

function lookup(page: Page): FocusLookup<string> {
	const has = (list: readonly string[] | undefined, key: string) => list?.includes(key) === true;
	return {
		row: (key, id) => (page.rows?.[key]?.includes(id) ? `row ${key}/${id}` : null),
		slot: (slot) => (has(page.slots, slot) ? `slot ${slot}` : null),
		fallback: (key) => (has(page.fallbacks, key) ? `fallback ${key}` : null),
		listStart: (key) => (has(page.starts, key) ? `start ${key}` : null),
		listDefault: (key) => (has(page.defaults, key) ? `default ${key}` : null),
		listShown: (key) => page.rows?.[key] !== undefined,
		nearestSibling: () => (page.sibling ? "sibling" : null),
		layerStart: () => (page.layerStart ? "layer start" : null),
		regionLanding: () => (page.landing ? "landing" : null),
	};
}

const level = (
	listKey: string,
	rowId: string | null,
	nextRowId: string | null = null,
	previousRowId: string | null = null,
): FocusLevel => ({ listKey, rowId, nextRowId, previousRowId });

const context = (overrides: Partial<FocusContext> = {}): FocusContext => ({
	levels: [],
	slot: null,
	anchored: false,
	inLayer: false,
	...overrides,
});

describe("focus recovery resolution", () => {
	test("the same row coming back wins over every neighbour", () => {
		const lost = context({ levels: [level("files", "b", "c", "a")] });
		expect(resolveFocus(lost, lookup({ rows: { files: ["a", "b", "c"] } }), false)).toBe(
			"row files/b",
		);
	});

	test("a replacement with the same slot takes focus when no row came back", () => {
		const lost = context({ slot: "outline-toggle" });
		expect(resolveFocus(lost, lookup({ slots: ["outline-toggle"], landing: true }), false)).toBe(
			"slot outline-toggle",
		);
	});

	test("a removed row moves to the next row, else the previous, else the list's fallback", () => {
		const lost = context({ levels: [level("mcp", "b", "c", "a")], inLayer: true });
		expect(resolveFocus(lost, lookup({ rows: { mcp: ["a", "c"] } }), false)).toBe("row mcp/c");
		expect(resolveFocus(lost, lookup({ rows: { mcp: ["a"] } }), false)).toBe("row mcp/a");
		expect(resolveFocus(lost, lookup({ rows: { mcp: [] }, fallbacks: ["mcp"] }), false)).toBe(
			"fallback mcp",
		);
		expect(resolveFocus(lost, lookup({ rows: { mcp: [] }, starts: ["mcp"] }), false)).toBe(
			"start mcp",
		);
	});

	test("an emptied inner list hands over to its containing row before the outer neighbours", () => {
		const lost = context({
			levels: [level("files:pkg", "pkg/a", null, null), level("files:", "pkg", "z", "docs")],
		});
		expect(resolveFocus(lost, lookup({ rows: { "files:": ["docs", "pkg", "z"] } }), false)).toBe(
			"row files:/pkg",
		);
		expect(resolveFocus(lost, lookup({ rows: { "files:": ["docs", "z"] } }), false)).toBe(
			"row files:/z",
		);
	});

	test("the outermost list's focus default comes after every row", () => {
		const lost = context({ levels: [level("files:", "a")] });
		expect(
			resolveFocus(lost, lookup({ rows: { "files:": [] }, defaults: ["files:"] }), false),
		).toBe("default files:");
	});

	test("waits while the list re-renders, then falls through once the grace is over", () => {
		const lost = context({ levels: [level("templates:global", "a", "b")] });
		const skeleton = lookup({ landing: true });
		expect(resolveFocus(lost, skeleton, false)).toBe(WAIT);
		expect(resolveFocus(lost, skeleton, true)).toBe("landing");
		expect(resolveFocus(lost, lookup({ rows: { "templates:global": ["b"] } }), false)).toBe(
			"row templates:global/b",
		);
	});

	test("a control disabled in place moves to its nearest enabled sibling before the list's fallbacks", () => {
		const lost = context({ levels: [level("review", null)], anchored: true });
		const page = { rows: { review: [] }, starts: ["review"], sibling: true, landing: true };
		expect(resolveFocus(lost, lookup(page), false)).toBe("sibling");
		expect(resolveFocus(lost, lookup({ ...page, sibling: false }), false)).toBe("start review");
	});

	test("a control disabled inside a row lands on that row first", () => {
		const lost = context({ levels: [level("hunks", "h1", "h2")], anchored: true });
		expect(
			resolveFocus(lost, lookup({ rows: { hunks: ["h1", "h2"] }, sibling: true }), false),
		).toBe("row hunks/h1");
	});

	test("the safety net is the region's landing target, or the dialog's first control", () => {
		expect(resolveFocus(context(), lookup({ landing: true }), false)).toBe("landing");
		expect(
			resolveFocus(context({ inLayer: true }), lookup({ landing: true, layerStart: true }), false),
		).toBe("layer start");
		expect(resolveFocus(context({ inLayer: true }), lookup({ landing: true }), false)).toBeNull();
	});
});

describe("focus loss", () => {
	test("is lost only when the recorded element stopped being focusable and focus rests nowhere", () => {
		expect(isFocusLost("none", false)).toBe(true);
		expect(isFocusLost("layer", false)).toBe(true);
		expect(isFocusLost("recorded", false)).toBe(true);
		expect(isFocusLost("elsewhere", false)).toBe(false);
	});

	test("a click on empty space leaves a still-focusable element, which never recovers", () => {
		expect(isFocusLost("none", true)).toBe(false);
		expect(isFocusLost("layer", true)).toBe(false);
	});
});

describe("nearest enabled sibling", () => {
	test("prefers the control just before the disabled one", () => {
		expect(nearestControl(2, 3)).toBe(1);
	});

	test("takes the control just after it at the start", () => {
		expect(nearestControl(0, 2)).toBe(0);
	});

	test("has nothing to offer in an empty container", () => {
		expect(nearestControl(0, 0)).toBeNull();
	});
});
