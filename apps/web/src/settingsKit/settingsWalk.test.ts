import { describe, expect, mock, test } from "bun:test";
import { revealSetting, showSetting } from "./jumpToSetting";
import {
	button,
	choice,
	control,
	dom,
	type FakeNode,
	field,
	h,
	holder,
	item,
	named,
	nameOf,
	reset,
	resetDom,
	row,
	toggle,
} from "./settingsFakeDom.test";
import type { WalkAction } from "./settingsKeys";
import {
	caretAtEnd,
	focusSettingRow,
	focusUnitStop,
	partsOfUnit,
	performWalk,
	placeOf,
	resetOf,
	rowIdOf,
	rowsOf,
	stopOf,
	textEntryKind,
	visualOrder,
} from "./settingsWalk";

function page() {
	return h(
		"div",
		{ "data-settings-content": "" },
		button("header"),
		row("a", control(toggle("a.switch")), button("a.more"), reset("a.reset")),
		row("hidden", control(toggle("hidden.switch"))),
		row("theme", control(choice("theme.list", "theme.dark", "theme.light")), reset("theme.reset")),
		holder("action", button("action.new")),
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
						item("tree.2a", choice("tree.2a.choice", "tree.2a.default"), reset("tree.2a.reset")),
						item("tree.2b", reset("tree.2b.reset")),
					),
				),
				item("tree.3", button("tree.3.change")),
			),
		),
		h(
			"ul",
			{ "data-focus-list": "mcp" },
			row(
				"mcp/one",
				button("one.primary", { "data-setting-primary": "" }),
				button("one.menu"),
				toggle("one.switch"),
			),
			row("mcp/two", button("two.primary", { "data-setting-primary": "", tabindex: "-1" })),
		),
		row("pair", control(field("pair.name", "FOO"), field("pair.value")), button("pair.remove")),
		row("only", button("only.open")),
		row("empty"),
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
	dom.log = [];
	const handlers = exits();
	const handled = performWalk(root, target, action, {
		toNav: handlers.toNav,
		toResults: withResults ? handlers.toResults : undefined,
	});
	return { handled, landed: nameOf(dom.focused), handlers, log: dom.log };
}

const ids = (nodes: readonly (FakeNode | null)[]) => nodes.map(nameOf);

describe("rows and their parts", () => {
	test("rows are the shown top-level rows with a stop; a focusable row is its own stop", () => {
		const root = fresh();
		expect(rowsOf(root).map((each) => each.getAttribute("data-setting-row"))).toEqual([
			"a",
			"theme",
			"action",
			"tree",
			"mcp/one",
			"mcp/two",
			"pair",
			"only",
			"empty",
		]);
		const stop = (id: string, edge: "first" | "last" = "first") => {
			const each = root.querySelector(`[data-setting-row="${id}"]`);
			return nameOf(each ? stopOf(each, edge) : null);
		};
		expect(stop("a")).toBe("a");
		expect(stop("theme")).toBe("theme");
		expect(stop("empty")).toBe("empty");
		expect(stop("action")).toBe("action.new");
		expect(stop("tree")).toBe("tree.1");
		expect(stop("tree", "last")).toBe("tree.3");
	});

	test("a row splits into controls, its switch, its primary and its buttons", () => {
		const root = fresh();
		const parts = (id: string) => {
			const unit = root.querySelector(`[data-setting-row="${id}"]`) ?? named(root, id);
			const { controls, toggle, primary, buttons } = partsOfUnit(unit);
			return {
				controls: ids(controls),
				toggle: nameOf(toggle),
				primary: nameOf(primary),
				buttons: ids(buttons),
			};
		};
		expect(parts("a")).toEqual({
			controls: [],
			toggle: "a.switch",
			primary: null,
			buttons: ["a.more", "a.reset"],
		});
		expect(parts("theme")).toEqual({
			controls: ["theme.list"],
			toggle: null,
			primary: null,
			buttons: ["theme.reset"],
		});
		expect(parts("mcp/one")).toEqual({
			controls: [],
			toggle: "one.switch",
			primary: "one.primary",
			buttons: ["one.menu"],
		});
		expect(parts("pair").controls).toEqual(["pair.name", "pair.value"]);
		expect(parts("tree").buttons).toEqual([]);
		expect(parts("tree.2a")).toEqual({
			controls: ["tree.2a.choice"],
			toggle: null,
			primary: null,
			buttons: ["tree.2a.reset"],
		});
		expect(nameOf(resetOf(named(root, "tree.1")))).toBe("tree.1.reset");
	});

	test("buttons follow the screen, left to right then top to bottom, not the DOM", () => {
		const chips = [button("chip.x1"), button("chip.x2")];
		const add = button("chip.add");
		const link = h("a", { href: "#", "data-name": "link" });
		const unit = row("fallbacks", control(add, ...chips), link);
		const place = (node: FakeNode, top: number, left: number) => {
			node.rect = { top, bottom: top + 24, left };
		};
		place(add, 0, 300);
		place(chips[0] ?? add, 0, 100);
		place(chips[1] ?? add, 0, 200);
		place(link, 30, 0);
		expect(ids(partsOfUnit(unit).buttons)).toEqual(["chip.x1", "chip.x2", "chip.add", "link"]);
		expect(visualOrder(link, add)).toBeGreaterThan(0);
		expect(visualOrder(button("unplaced"), add)).toBe(0);
	});

	test("the place of an element is its row stop, a control or a button", () => {
		const root = fresh();
		const place = (name: string) => placeOf(root, named(root, name));
		expect(place("a")).toBe("row");
		expect(place("a.switch")).toBe("button");
		expect(place("theme.dark")).toBe("control");
		expect(place("action.new")).toBe("row");
		expect(place("tree.2a")).toBe("row");
		expect(place("tree.2a.default")).toBe("control");
		expect(place("pair.value")).toBe("control");
		expect(place("header")).toBe("outside");
	});

	test("rowIdOf names the top-level row around an element", () => {
		const root = fresh();
		expect(rowIdOf(named(root, "one.menu"))).toBe("mcp/one");
		expect(rowIdOf(named(root, "header"))).toBeNull();
	});
});

describe("the walk", () => {
	test("↓ and ↑ land on the next and previous row itself, never inside it, and skip hidden rows", () => {
		const root = fresh();
		expect(walk(root, "a", { kind: "row", delta: 1 }).landed).toBe("theme");
		expect(walk(root, "theme.light", { kind: "row", delta: -1 }).landed).toBe("a");
		expect(walk(root, "a.reset", { kind: "row", delta: 1 }).landed).toBe("theme");
		expect(walk(root, "theme", { kind: "row", delta: 1 }).landed).toBe("action.new");
		expect(walk(root, "one.menu", { kind: "row", delta: 1 }).landed).toBe("mcp/two");
		expect(walk(root, "pair.value", { kind: "row", delta: 1 }).landed).toBe("only");
	});

	test("a tree is entered at its first item going down and its last going up; inside, a button steps to the neighbouring item", () => {
		const root = fresh();
		expect(walk(root, "action.new", { kind: "row", delta: 1 }).landed).toBe("tree.1");
		expect(walk(root, "mcp/one", { kind: "row", delta: -1 }).landed).toBe("tree.3");
		expect(walk(root, "tree.2a.reset", { kind: "row", delta: -1 }).landed).toBe("tree.2");
		expect(walk(root, "tree.2a.default", { kind: "row", delta: 1 }).landed).toBe("tree.3");
		expect(walk(root, "tree.1.reset", { kind: "row", delta: -1 }).landed).toBe("action.new");
		expect(walk(root, "tree.3.change", { kind: "row", delta: 1 }).landed).toBe("mcp/one");
	});

	test("the edges do not wrap but still consume the key; from outside any row the nearest row is taken", () => {
		const root = fresh();
		expect(walk(root, "a", { kind: "row", delta: -1 })).toMatchObject({
			handled: true,
			landed: null,
		});
		expect(walk(root, "empty", { kind: "row", delta: 1 })).toMatchObject({
			handled: true,
			landed: null,
		});
		expect(walk(root, "header", { kind: "row", delta: 1 }).landed).toBe("a");
	});

	test("Home and End go to the first and last row, or the tree's ends from inside an item", () => {
		const root = fresh();
		expect(walk(root, "only", { kind: "edge", edge: "first" }).landed).toBe("a");
		expect(walk(root, "a", { kind: "edge", edge: "last" }).landed).toBe("empty");
		expect(walk(root, "tree.2a.reset", { kind: "edge", edge: "first" }).landed).toBe("tree.1");
		expect(walk(root, "tree.2a.default", { kind: "edge", edge: "last" }).landed).toBe("tree.3");
	});

	test("→ on a row reaches its first button without touching the control; → and ← walk the buttons, ← from the first returns", () => {
		const root = fresh();
		expect(walk(root, "theme", { kind: "forward" })).toMatchObject({
			landed: "theme.reset",
			log: ["focus theme.reset"],
		});
		expect(walk(root, "a", { kind: "forward" }).landed).toBe("a.more");
		expect(walk(root, "a.more", { kind: "button", delta: 1 }).landed).toBe("a.reset");
		expect(walk(root, "a.reset", { kind: "button", delta: 1 })).toMatchObject({
			handled: true,
			landed: null,
		});
		expect(walk(root, "a.reset", { kind: "button", delta: -1 }).landed).toBe("a.more");
		expect(walk(root, "a.more", { kind: "button", delta: -1 }).landed).toBe("a");
		expect(walk(root, "a.switch", { kind: "button", delta: 1 }).landed).toBe("a.more");
		expect(walk(root, "tree.2a", { kind: "forward" }).landed).toBe("tree.2a.reset");
		expect(walk(root, "tree.2a.reset", { kind: "button", delta: -1 }).landed).toBe("tree.2a");
	});

	test("→ on a row without buttons enters its control; a row with neither keeps the key", () => {
		const root = fresh();
		const holderless = h("div", {}, row("solo", control(choice("solo.list", "solo.a"))));
		expect(walk(holderless, "solo", { kind: "forward" }).landed).toBe("solo.a");
		expect(walk(root, "empty", { kind: "forward" })).toMatchObject({ handled: true, landed: null });
	});

	test("→ on a collapsed disclosure opens it, on an open one steps into it; ← closes it, then leaves", () => {
		const disclosure = button("advanced", {
			"data-setting-row": "advanced",
			"aria-expanded": "false",
		});
		const root = h("div", {}, disclosure, row("inner"));
		expect(walk(root, "advanced", { kind: "forward" }).log).toEqual(["click advanced"]);
		disclosure.setAttribute("aria-expanded", "true");
		expect(walk(root, "advanced", { kind: "forward" }).landed).toBe("inner");
		const closed = walk(root, "advanced", { kind: "nav" });
		expect([closed.log, closed.handlers.toNav.mock.calls.length]).toEqual([["click advanced"], 0]);
		disclosure.setAttribute("aria-expanded", "false");
		expect(walk(root, "advanced", { kind: "nav" }).handlers.toNav.mock.calls.length).toBe(1);
	});

	test("Enter or Space on a row: enter the control, else the primary, else the switch, else its only action, else focus the first button", () => {
		const root = fresh();
		expect(walk(root, "theme", { kind: "activate", space: false }).landed).toBe("theme.dark");
		expect(walk(root, "theme", { kind: "activate", space: true }).landed).toBe("theme.dark");
		expect(walk(root, "pair", { kind: "activate", space: false }).log).toEqual([
			"focus pair.name",
			"select pair.name",
		]);
		expect(walk(root, "mcp/one", { kind: "activate", space: false }).log).toEqual([
			"click one.primary",
		]);
		expect(walk(root, "a", { kind: "activate", space: false }).log).toEqual(["click a.switch"]);
		expect(walk(root, "only", { kind: "activate", space: false }).log).toEqual(["click only.open"]);
		const many = h("div", {}, row("many", button("many.copy"), button("many.open")));
		expect(walk(many, "many", { kind: "activate", space: false }).landed).toBe("many.copy");
		const resettable = h("div", {}, row("r", button("r.open"), reset("r.reset")));
		expect(walk(resettable, "r", { kind: "activate", space: false }).log).toEqual(["click r.open"]);
		const onlyReset = h("div", {}, row("z", reset("z.reset")));
		expect(walk(onlyReset, "z", { kind: "activate", space: false }).landed).toBe("z.reset");
	});

	test("Space on a switch row toggles it before anything else and stays on the row", () => {
		const both = h("div", {}, row("both", control(toggle("both.switch"), field("both.limit"))));
		expect(walk(both, "both", { kind: "activate", space: true }).log).toEqual([
			"click both.switch",
		]);
		expect(walk(both, "both", { kind: "activate", space: false }).landed).toBe("both.limit");
	});

	test("inside a control, along moves to the row's next control, and back past the first returns to the row", () => {
		const root = fresh();
		expect(walk(root, "pair.name", { kind: "along", delta: 1 }).landed).toBe("pair.value");
		expect(walk(root, "pair.value", { kind: "along", delta: 1 })).toMatchObject({
			handled: true,
			landed: null,
		});
		expect(walk(root, "pair.value", { kind: "along", delta: -1 }).landed).toBe("pair.name");
		expect(walk(root, "theme.light", { kind: "along", delta: -1 }).landed).toBe("theme");
		expect(walk(root, "tree.2a.default", { kind: "along", delta: -1 }).landed).toBe("tree.2a");
	});

	test("exit returns from a control or a button to its row, or to the tree item holding it", () => {
		const root = fresh();
		expect(walk(root, "theme.light", { kind: "exit" }).landed).toBe("theme");
		expect(walk(root, "a.reset", { kind: "exit" }).landed).toBe("a");
		expect(walk(root, "tree.2a.default", { kind: "exit" }).landed).toBe("tree.2a");
	});

	test("Delete clicks the row's Reset, moving to the row first when focus is inside it", () => {
		const root = fresh();
		expect(walk(root, "a", { kind: "reset" }).log).toEqual(["click a.reset"]);
		expect(walk(root, "a.more", { kind: "reset" }).log).toEqual(["focus a", "click a.reset"]);
		expect(walk(root, "theme.light", { kind: "reset" }).log).toEqual([
			"focus theme",
			"click theme.reset",
		]);
		expect(walk(root, "tree.2a.reset", { kind: "reset" }).log).toEqual([
			"focus tree.2a",
			"click tree.2a.reset",
		]);
		expect(walk(root, "only", { kind: "reset" })).toMatchObject({ handled: false, log: [] });
	});

	test("← leaves for the nav; Esc goes back to the results after a jump, else to the nav", () => {
		const root = fresh();
		const left = walk(root, "a", { kind: "nav" });
		expect([left.handled, left.handlers.toNav.mock.calls.length]).toEqual([true, 1]);
		expect(walk(root, "a", { kind: "escape" }).handlers.toNav.mock.calls.length).toBe(1);
		const jumped = walk(root, "a", { kind: "escape" }, true);
		expect(jumped.handlers.toResults.mock.calls.length).toBe(1);
		expect(jumped.handlers.toNav.mock.calls.length).toBe(0);
	});

	test("entering lands on the remembered row, else on the first; a tree at its current item", () => {
		const root = fresh();
		expect(focusSettingRow(root, "mcp/two")).toBe(true);
		expect(nameOf(dom.focused)).toBe("mcp/two");
		expect(focusSettingRow(root, "hidden")).toBe(true);
		expect(nameOf(dom.focused)).toBe("a");
		expect(focusSettingRow(root, null)).toBe(true);
		expect(nameOf(dom.focused)).toBe("a");
		expect(focusSettingRow(h("div"), null)).toBe(false);
		named(root, "tree.3").setAttribute("tabindex", "0");
		expect(focusSettingRow(root, "tree")).toBe(true);
		expect(nameOf(dom.focused)).toBe("tree.3");
	});

	test("a button's or a control's stop is its row, or the tree item holding it", () => {
		const root = fresh();
		expect(focusUnitStop(named(root, "a.reset"))).toBe(true);
		expect(nameOf(dom.focused)).toBe("a");
		expect(focusUnitStop(named(root, "tree.2a.default"))).toBe(true);
		expect(nameOf(dom.focused)).toBe("tree.2a");
		expect(focusUnitStop(named(root, "header"))).toBe(false);
	});
});

test("text entry tells single-line fields from multi-line ones and from other inputs, and reads the caret", () => {
	expect(textEntryKind(h("input"))).toBe("single");
	expect(textEntryKind(h("input", { type: "number" }))).toBe("single");
	expect(textEntryKind(h("input", { type: "range" }))).toBeNull();
	expect(textEntryKind(h("input", { type: "checkbox" }))).toBeNull();
	expect(textEntryKind(h("textarea"))).toBe("multi");
	expect(textEntryKind(h("div", { contenteditable: "true" }))).toBe("multi");
	expect(textEntryKind(h("button"))).toBeNull();
	const input = field("width", "120");
	input.selectionStart = 1;
	input.selectionEnd = 1;
	expect(caretAtEnd(input)).toBe(false);
	input.selectionStart = 3;
	input.selectionEnd = 3;
	expect(caretAtEnd(input)).toBe(true);
});

describe("revealSetting", () => {
	test("focuses the row itself, scrolls it into view and flashes it", () => {
		const root = fresh();
		const target = root.querySelector('[data-setting-row="theme"]');
		target?.setAttribute("data-setting-id", "dark-theme");
		expect(revealSetting(root, "dark-theme")).toBe(target);
		expect(dom.log).toEqual(["focus theme", "scroll theme"]);
		expect(target?.hasAttribute("data-setting-flash")).toBe(true);
	});

	test("a list lands on its first row; a tree item on itself; a missing id on nothing", () => {
		const root = fresh();
		root.querySelector('[data-focus-list="mcp"]')?.setAttribute("data-setting-id", "mcp-servers");
		revealSetting(root, "mcp-servers");
		expect(nameOf(dom.focused)).toBe("mcp/one");
		expect(dom.log.at(-1)).toBe("scroll mcp/one");
		named(root, "tree.2").setAttribute("data-setting-id", 'shortcut:"quoted"');
		revealSetting(root, 'shortcut:"quoted"');
		expect(nameOf(dom.focused)).toBe("tree.2");
		expect(revealSetting(root, "nowhere")).toBeNull();
	});

	test("reports nothing, and neither scrolls nor flashes, when nothing took focus", () => {
		const root = fresh();
		const empty = h("ul", { "data-focus-list": "empty", "data-setting-id": "empty-list" });
		const hidden = named(root, "tree.2b");
		hidden.setAttribute("data-setting-id", "shortcut:hidden");
		const locked = holder("locked", button("locked.only", { disabled: "" }));
		locked.setAttribute("data-setting-id", "locked");
		const page = h("div", {}, root, empty, locked);
		dom.log = [];
		for (const id of ["empty-list", "shortcut:hidden", "locked"]) {
			expect(revealSetting(page, id)).toBeNull();
		}
		expect(dom.log).toEqual([]);
		expect(hidden.hasAttribute("data-setting-flash")).toBe(false);
		expect(dom.focused).toBeNull();
	});

	test("showSetting scrolls to and flashes a shown owner with nothing to focus, and skips a hidden one", () => {
		const root = fresh();
		const note = h("p", { "data-setting-id": "untrusted", "data-name": "note" });
		const hidden = named(root, "tree.2b");
		hidden.setAttribute("data-setting-id", "shortcut:hidden");
		const page = h("div", {}, root, note);
		dom.log = [];
		expect(revealSetting(page, "untrusted")).toBeNull();
		expect(showSetting(page, "untrusted")).toBe(note);
		expect(dom.log).toEqual(["scroll note"]);
		expect(note.hasAttribute("data-setting-flash")).toBe(true);
		expect(dom.focused).toBeNull();
		expect(showSetting(page, "shortcut:hidden")).toBeNull();
		expect(showSetting(page, "nowhere")).toBeNull();
	});
});
