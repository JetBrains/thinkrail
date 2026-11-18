import { describe, expect, mock, test } from "bun:test";
import { revealSetting } from "./jumpToSetting";
import {
	button,
	control,
	dom,
	type FakeNode,
	h,
	item,
	named,
	nameOf,
	reset,
	resetDom,
	row,
	side,
} from "./settingsFakeDom.test";
import type { WalkAction } from "./settingsKeys";
import {
	focusSettingRow,
	focusUnitStop,
	performWalk,
	resetOf,
	rowIdOf,
	rowsOf,
	sidesOf,
	stopOf,
	textEntryKind,
} from "./settingsWalk";

function page() {
	return h(
		"div",
		{ "data-settings-content": "" },
		button("header"),
		row("a", control(button("a.switch")), side("a.side1"), reset("a.reset")),
		row("hidden", control(button("hidden.switch"))),
		row("disabled", control(button("disabled.switch", { disabled: "" }))),
		row(
			"choice",
			control(
				h(
					"div",
					{ role: "listbox" },
					button("choice.one", { tabindex: "-1" }),
					button("choice.two", { tabindex: "0" }),
				),
			),
		),
		row(
			"tree",
			h(
				"div",
				{ role: "tree" },
				item("tree.1", reset("tree.1.reset")),
				item(
					"tree.2",
					h(
						"ul",
						{ role: "group" },
						item(
							"tree.2a",
							h("div", { role: "listbox" }, button("tree.2a.option")),
							reset("tree.2a.reset"),
						),
						item("tree.2b", reset("tree.2b.reset")),
					),
				),
				item("tree.3", side("tree.3.side")),
			),
		),
		h(
			"div",
			{ "data-focus-list": "mcp" },
			row(
				"mcp/one",
				button("one.primary", { "data-setting-stop": "", tabindex: "0" }),
				side("one.menu", { tabindex: "0" }),
			),
			row(
				"mcp/two",
				button("two.primary", { "data-setting-stop": "", tabindex: "-1" }),
				side("two.menu", { tabindex: "-1" }),
			),
		),
		row("field", control(h("input", { type: "text", "data-name": "field.input" }))),
	);
}

function fresh() {
	resetDom();
	const root = page();
	for (const hidden of [
		root.querySelector('[data-setting-row="hidden"]'),
		named(root, "tree.2b"),
	]) {
		if (hidden) hidden.hidden = true;
	}
	return root;
}

const exits = () => ({ toNav: mock(() => {}), toResults: mock(() => {}) });

function walk(root: FakeNode, from: string, action: WalkAction, withResults = false) {
	const target = named(root, from);
	dom.focused = null;
	const handlers = exits();
	const handled = performWalk(root, target, action, {
		toNav: handlers.toNav,
		toResults: withResults ? handlers.toResults : undefined,
	});
	return { handled, landed: nameOf(dom.focused), handlers };
}

describe("rows and stops", () => {
	test("rows are the shown top-level rows that have a stop, in document order", () => {
		const root = fresh();
		expect(rowsOf(root).map((each) => each.getAttribute("data-setting-row"))).toEqual([
			"a",
			"choice",
			"tree",
			"mcp/one",
			"mcp/two",
			"field",
		]);
	});

	test("a row lands on its marked stop, else its control's tab stop, else a non-side control", () => {
		const root = fresh();
		const stop = (id: string, edge: "first" | "last" = "first") => {
			const each = root.querySelector(`[data-setting-row="${id}"]`);
			return nameOf(each ? stopOf(each, edge) : null);
		};
		expect(stop("a")).toBe("a.switch");
		expect(stop("choice")).toBe("choice.two");
		expect(stop("mcp/two")).toBe("two.primary");
		expect(stop("field")).toBe("field.input");
		expect(stop("tree")).toBe("tree.1");
		expect(stop("tree", "last")).toBe("tree.3");
		const loose = row("loose", button("loose.only"), side("loose.side"));
		expect(nameOf(stopOf(loose))).toBe("loose.only");
	});

	test("sides belong to their own row or tree item, and Reset is one of them", () => {
		const root = fresh();
		const a = root.querySelector('[data-setting-row="a"]');
		expect(a && sidesOf(a).map(nameOf)).toEqual(["a.side1", "a.reset"]);
		expect(nameOf(a && resetOf(a))).toBe("a.reset");
		const one = root.querySelector('[data-setting-row="mcp/one"]');
		expect(one && sidesOf(one).map(nameOf)).toEqual(["one.menu"]);
		expect(one && resetOf(one)).toBeNull();
		const tree = h(
			"div",
			{ "data-setting-row": "t" },
			h("div", { role: "tree" }, h("li", { role: "treeitem" }, reset("leaf.reset"))),
		);
		expect(sidesOf(tree)).toEqual([]);
		const leaf = tree.querySelector('[role="treeitem"]');
		expect(leaf && sidesOf(leaf).map(nameOf)).toEqual(["leaf.reset"]);
	});

	test("rowIdOf names the top-level row around an element", () => {
		const root = fresh();
		expect(rowIdOf(named(root, "one.menu"))).toBe("mcp/one");
		expect(rowIdOf(named(root, "header"))).toBeNull();
	});
});

describe("the walk", () => {
	test("↓ and ↑ go to the next and previous row's stop, skipping hidden and disabled rows", () => {
		const root = fresh();
		expect(walk(root, "a.switch", { kind: "row", delta: 1 }).landed).toBe("choice.two");
		expect(walk(root, "choice.one", { kind: "row", delta: -1 }).landed).toBe("a.switch");
		expect(walk(root, "a.side1", { kind: "row", delta: 1 }).landed).toBe("choice.two");
		expect(walk(root, "one.menu", { kind: "row", delta: 1 }).landed).toBe("two.primary");
	});

	test("a tree is entered at its first item going down and its last going up", () => {
		const root = fresh();
		expect(walk(root, "choice.two", { kind: "row", delta: 1 }).landed).toBe("tree.1");
		expect(walk(root, "one.primary", { kind: "row", delta: -1 }).landed).toBe("tree.3");
		expect(walk(root, "tree.3", { kind: "row", delta: 1 }).landed).toBe("one.primary");
		expect(walk(root, "tree.1", { kind: "row", delta: -1 }).landed).toBe("choice.two");
	});

	test("from a side or a control inside a tree item, ↑/↓ step to the neighbouring shown item", () => {
		const root = fresh();
		expect(walk(root, "tree.2a.reset", { kind: "row", delta: -1 }).landed).toBe("tree.2");
		expect(walk(root, "tree.2a.reset", { kind: "row", delta: 1 }).landed).toBe("tree.3");
		expect(walk(root, "tree.2a.option", { kind: "row", delta: 1 }).landed).toBe("tree.3");
		expect(walk(root, "tree.1.reset", { kind: "row", delta: 1 }).landed).toBe("tree.2");
	});

	test("past the tree's first or last item, a side steps on to the neighbouring row", () => {
		const root = fresh();
		expect(walk(root, "tree.1.reset", { kind: "row", delta: -1 }).landed).toBe("choice.two");
		expect(walk(root, "tree.3.side", { kind: "row", delta: 1 }).landed).toBe("one.primary");
	});

	test("the edges do not wrap but still consume the key", () => {
		const root = fresh();
		expect(walk(root, "a.switch", { kind: "row", delta: -1 })).toMatchObject({
			handled: true,
			landed: null,
		});
		expect(walk(root, "field.input", { kind: "row", delta: 1 })).toMatchObject({
			handled: true,
			landed: null,
		});
	});

	test("from outside any row the walk takes the nearest row in document order", () => {
		const root = fresh();
		expect(walk(root, "header", { kind: "row", delta: 1 }).landed).toBe("a.switch");
		expect(walk(root, "header", { kind: "row", delta: -1 }).landed).toBeNull();
	});

	test("Home and End go to the first and last row", () => {
		const root = fresh();
		expect(walk(root, "field.input", { kind: "edge", edge: "first" }).landed).toBe("a.switch");
		expect(walk(root, "a.switch", { kind: "edge", edge: "last" }).landed).toBe("field.input");
	});

	test("→ walks the sides, ← walks back to the stop, and neither wraps", () => {
		const root = fresh();
		expect(walk(root, "a.switch", { kind: "side", delta: 1 }).landed).toBe("a.side1");
		expect(walk(root, "a.side1", { kind: "side", delta: 1 }).landed).toBe("a.reset");
		expect(walk(root, "a.reset", { kind: "side", delta: 1 })).toMatchObject({
			handled: true,
			landed: null,
		});
		expect(walk(root, "a.reset", { kind: "side", delta: -1 }).landed).toBe("a.side1");
		expect(walk(root, "a.side1", { kind: "side", delta: -1 }).landed).toBe("a.switch");
		expect(walk(root, "choice.two", { kind: "side", delta: 1 }).handled).toBe(false);
		expect(walk(root, "a.switch", { kind: "side", delta: -1 }).handled).toBe(false);
		expect(walk(root, "tree.2a", { kind: "side", delta: 1 }).landed).toBe("tree.2a.reset");
		expect(walk(root, "tree.2a.reset", { kind: "side", delta: -1 }).landed).toBe("tree.2a");
	});

	test("Delete clicks the row's Reset, from a side after moving to the stop", () => {
		const root = fresh();
		expect(walk(root, "a.switch", { kind: "reset" }).handled).toBe(true);
		expect(dom.log).toEqual(["click a.reset"]);
		dom.log = [];
		const fromSide = walk(root, "a.reset", { kind: "reset" });
		expect([fromSide.handled, fromSide.landed]).toEqual([true, "a.switch"]);
		expect(dom.log).toEqual(["focus a.switch", "click a.reset"]);
		dom.log = [];
		expect(walk(root, "choice.two", { kind: "reset" }).handled).toBe(false);
		expect(dom.log).toEqual([]);
	});

	test("← leaves for the nav; Esc goes back to the results after a jump, else to the nav", () => {
		const root = fresh();
		const left = walk(root, "a.switch", { kind: "nav" });
		expect([left.handled, left.handlers.toNav.mock.calls.length]).toEqual([true, 1]);
		const escaped = walk(root, "a.switch", { kind: "escape" });
		expect(escaped.handlers.toNav.mock.calls.length).toBe(1);
		const jumped = walk(root, "a.switch", { kind: "escape" }, true);
		expect(jumped.handlers.toResults.mock.calls.length).toBe(1);
		expect(jumped.handlers.toNav.mock.calls.length).toBe(0);
	});

	test("entering lands on the remembered row, else on the first", () => {
		const root = fresh();
		expect(focusSettingRow(root, "mcp/two")).toBe(true);
		expect(nameOf(dom.focused)).toBe("two.primary");
		expect(focusSettingRow(root, "hidden")).toBe(true);
		expect(nameOf(dom.focused)).toBe("a.switch");
		expect(focusSettingRow(root, null)).toBe(true);
		expect(nameOf(dom.focused)).toBe("a.switch");
		expect(focusSettingRow(h("div"), null)).toBe(false);
	});

	test("entering a tree lands on its current item; walking into it still takes the edge", () => {
		const root = fresh();
		expect(focusSettingRow(root, "tree")).toBe(true);
		expect(nameOf(dom.focused)).toBe("tree.1");
		named(root, "tree.3").setAttribute("tabindex", "0");
		expect(focusSettingRow(root, "tree")).toBe(true);
		expect(nameOf(dom.focused)).toBe("tree.3");
		expect(walk(root, "choice.two", { kind: "row", delta: 1 }).landed).toBe("tree.1");
		const tree = h("div", { role: "tree" }, item("only"));
		expect(focusSettingRow(h("div", {}, row("t", tree)), "t")).toBe(true);
		expect(nameOf(dom.focused)).toBe("only");
	});

	test("a side's stop is its row's stop, or the tree item holding it", () => {
		const root = fresh();
		expect(focusUnitStop(named(root, "a.reset"))).toBe(true);
		expect(nameOf(dom.focused)).toBe("a.switch");
		expect(focusUnitStop(named(root, "tree.2a.reset"))).toBe(true);
		expect(nameOf(dom.focused)).toBe("tree.2a");
		expect(focusUnitStop(named(root, "header"))).toBe(false);
	});
});

test("text entry tells single-line fields from multi-line ones and from other inputs", () => {
	expect(textEntryKind(h("input"))).toBe("single");
	expect(textEntryKind(h("input", { type: "number" }))).toBe("single");
	expect(textEntryKind(h("input", { type: "range" }))).toBeNull();
	expect(textEntryKind(h("input", { type: "checkbox" }))).toBeNull();
	expect(textEntryKind(h("textarea"))).toBe("multi");
	expect(textEntryKind(h("div", { contenteditable: "true" }))).toBe("multi");
	expect(textEntryKind(h("button"))).toBeNull();
});

describe("revealSetting", () => {
	test("focuses a row's stop, scrolls the focused stop into view and flashes the row", () => {
		const root = fresh();
		const target = root.querySelector('[data-setting-row="choice"]');
		target?.setAttribute("data-setting-id", "contrast");
		expect(revealSetting(root, "contrast")).toBe(target);
		expect(dom.log).toEqual(["focus choice.two", "scroll choice.two"]);
		expect(target?.hasAttribute("data-setting-flash")).toBe(true);
	});

	test("a list lands on its first row; a tree item on itself; a missing id on nothing", () => {
		const root = fresh();
		root.querySelector('[data-focus-list="mcp"]')?.setAttribute("data-setting-id", "mcp-servers");
		revealSetting(root, "mcp-servers");
		expect(nameOf(dom.focused)).toBe("one.primary");
		expect(dom.log.at(-1)).toBe("scroll one.primary");
		named(root, "tree.2").setAttribute("data-setting-id", 'shortcut:"quoted"');
		revealSetting(root, 'shortcut:"quoted"');
		expect(nameOf(dom.focused)).toBe("tree.2");
		expect(revealSetting(root, "nowhere")).toBeNull();
	});

	test("reports nothing, and neither scrolls nor flashes, when no control took focus", () => {
		const root = fresh();
		const empty = h("ul", { "data-focus-list": "empty", "data-setting-id": "empty-list" });
		const hidden = named(root, "tree.2b");
		hidden.setAttribute("data-setting-id", "shortcut:hidden");
		const disabled = root.querySelector('[data-setting-row="disabled"]');
		disabled?.setAttribute("data-setting-id", "disabled");
		const page = h("div", {}, root, empty);
		dom.log = [];
		for (const id of ["empty-list", "shortcut:hidden", "disabled"]) {
			expect(revealSetting(page, id)).toBeNull();
		}
		expect(dom.log).toEqual([]);
		expect(hidden.hasAttribute("data-setting-flash")).toBe(false);
		expect(dom.focused).toBeNull();
	});
});
