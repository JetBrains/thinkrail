import { describe, expect, mock, test } from "bun:test";
import { revealSetting } from "./jumpToSetting";
import type { WalkAction } from "./settingsKeys";
import {
	focusSettingRow,
	performWalk,
	resetOf,
	rowIdOf,
	rowsOf,
	sidesOf,
	stopOf,
	textEntryKind,
} from "./settingsWalk";

const FORM_TAGS = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

class FakeNode {
	readonly tagName: string;
	readonly attributes: Map<string, string>;
	readonly children: FakeNode[];
	parentElement: FakeNode | null = null;
	hidden = false;

	constructor(tag: string, attributes: Record<string, string>, children: FakeNode[]) {
		this.tagName = tag.toUpperCase();
		this.attributes = new Map(Object.entries(attributes));
		this.children = children;
		for (const child of children) child.parentElement = this;
	}

	get root(): FakeNode {
		return this.parentElement ? this.parentElement.root : this;
	}

	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}
	hasAttribute(name: string) {
		return this.attributes.has(name);
	}
	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}
	removeAttribute(name: string) {
		this.attributes.delete(name);
	}
	matches(selector: string): boolean {
		return selector.split(",").some((part) => matchesCompound(this, part.trim()));
	}
	closest(selector: string): FakeNode | null {
		if (this.matches(selector)) return this;
		return this.parentElement ? this.parentElement.closest(selector) : null;
	}
	descendants(): FakeNode[] {
		return this.children.flatMap((child) => [child, ...child.descendants()]);
	}
	querySelectorAll(selector: string): FakeNode[] {
		return this.descendants().filter((node) => node.matches(selector));
	}
	querySelector(selector: string): FakeNode | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	contains(other: FakeNode | null): boolean {
		for (let node = other; node; node = node.parentElement) if (node === this) return true;
		return false;
	}
	compareDocumentPosition(other: FakeNode): number {
		const order = [this.root, ...this.root.descendants()];
		return order.indexOf(other) > order.indexOf(this) ? 4 : 2;
	}
	checkVisibility(): boolean {
		return !this.hidden && (this.parentElement ? this.parentElement.checkVisibility() : true);
	}
	focus() {
		focused = this;
	}
	click() {
		clicked.push(this);
	}
	scrollIntoView() {
		scrolled.push(this);
	}
}

let focused: FakeNode | null = null;
let clicked: FakeNode[] = [];
let scrolled: FakeNode[] = [];

function matchesCompound(node: FakeNode, compound: string): boolean {
	if (/[\s>]/.test(compound)) return false;
	let rest = compound;
	const tag = /^[a-z]+/i.exec(rest)?.[0];
	if (tag) {
		if (node.tagName !== tag.toUpperCase()) return false;
		rest = rest.slice(tag.length);
	}
	while (rest.length > 0) {
		const attribute = /^\[([\w-]+)(?:="((?:[^"\\]|\\.)*)")?\]/.exec(rest);
		const not = /^:not\(([^)]*\)?)\)/.exec(rest);
		const disabled = /^:disabled/.exec(rest);
		if (attribute) {
			const value = node.getAttribute(attribute[1] ?? "");
			if (value === null) return false;
			const expected = attribute[2]?.replace(/\\(.)/g, "$1");
			if (expected !== undefined && value !== expected) return false;
			rest = rest.slice(attribute[0].length);
		} else if (not) {
			if (matchesCompound(node, not[1] ?? "")) return false;
			rest = rest.slice(not[0].length);
		} else if (disabled) {
			if (!(FORM_TAGS.has(node.tagName) && node.hasAttribute("disabled"))) return false;
			rest = rest.slice(disabled[0].length);
		} else {
			throw new Error(`fake DOM: unsupported selector ${compound}`);
		}
	}
	return true;
}

const h = (tag: string, attributes: Record<string, string> = {}, ...children: FakeNode[]) =>
	new FakeNode(tag, attributes, children);

const row = (id: string, ...children: FakeNode[]) =>
	h("div", { "data-setting-row": id }, ...children);
const control = (...children: FakeNode[]) => h("div", { "data-setting-control": "" }, ...children);
const button = (name: string, attributes: Record<string, string> = {}) =>
	h("button", { "data-name": name, tabindex: "0", ...attributes });
const side = (name: string, attributes: Record<string, string> = {}) =>
	button(name, { "data-setting-side": "", ...attributes });
const reset = (name: string) => side(name, { "data-setting-reset": "" });
const item = (name: string) => h("li", { role: "treeitem", "data-name": name, tabindex: "-1" });
const named = (root: FakeNode, name: string) => root.querySelector(`[data-name="${name}"]`);
const nameOf = (node: FakeNode | null | undefined) => node?.getAttribute("data-name") ?? null;

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
		row("tree", h("div", { role: "tree" }, item("tree.1"), item("tree.2"), item("tree.3"))),
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
	focused = null;
	clicked = [];
	scrolled = [];
	const root = page();
	const hidden = root.querySelector('[data-setting-row="hidden"]');
	if (hidden) hidden.hidden = true;
	return root;
}

const exits = () => ({ toNav: mock(() => {}), toResults: mock(() => {}) });

function walk(root: FakeNode, from: string, action: WalkAction, withResults = false) {
	const target = named(root, from);
	if (!target) throw new Error(`no ${from}`);
	focused = null;
	const handlers = exits();
	const handled = performWalk(root, target, action, {
		toNav: handlers.toNav,
		toResults: withResults ? handlers.toResults : undefined,
	});
	return { handled, landed: nameOf(focused), handlers };
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
	});

	test("Delete clicks the row's Reset, from a side after moving to the stop", () => {
		const root = fresh();
		expect(walk(root, "a.switch", { kind: "reset" }).handled).toBe(true);
		expect(clicked.map(nameOf)).toEqual(["a.reset"]);
		const fromSide = walk(root, "a.reset", { kind: "reset" });
		expect([fromSide.handled, fromSide.landed]).toEqual([true, "a.switch"]);
		clicked = [];
		expect(walk(root, "choice.two", { kind: "reset" }).handled).toBe(false);
		expect(clicked).toEqual([]);
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
		expect(nameOf(focused)).toBe("two.primary");
		expect(focusSettingRow(root, "hidden")).toBe(true);
		expect(nameOf(focused)).toBe("a.switch");
		expect(focusSettingRow(root, null)).toBe(true);
		expect(nameOf(focused)).toBe("a.switch");
		expect(focusSettingRow(h("div"), null)).toBe(false);
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
	test("focuses a row's stop, scrolls the row into view and flashes it", () => {
		const root = fresh();
		const target = root.querySelector('[data-setting-row="choice"]');
		target?.setAttribute("data-setting-id", "contrast");
		expect(revealSetting(root, "contrast")).toBe(target);
		expect(nameOf(focused)).toBe("choice.two");
		expect(scrolled).toEqual(target ? [target] : []);
		expect(target?.hasAttribute("data-setting-flash")).toBe(true);
	});

	test("a list lands on its first row; a tree item on itself; a missing id on nothing", () => {
		const root = fresh();
		root.querySelector('[data-focus-list="mcp"]')?.setAttribute("data-setting-id", "mcp-servers");
		revealSetting(root, "mcp-servers");
		expect(nameOf(focused)).toBe("one.primary");
		named(root, "tree.2")?.setAttribute("data-setting-id", 'shortcut:"quoted"');
		revealSetting(root, 'shortcut:"quoted"');
		expect(nameOf(focused)).toBe("tree.2");
		expect(revealSetting(root, "nowhere")).toBeNull();
	});
});
