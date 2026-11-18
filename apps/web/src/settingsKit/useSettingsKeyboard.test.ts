import { describe, expect, mock, test } from "bun:test";
import { type LocalKeyEvent, localKeys } from "@thinkrail/ui/local-keys";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";
import {
	button,
	control,
	dom,
	type FakeNode,
	h,
	item,
	named,
	nameOf,
	press,
	reset,
	resetDom,
	row,
	side,
} from "./settingsFakeDom.test";
import { settingsKeyDown } from "./useSettingsKeyboard";

const keys = localKeys(null, "settings", LOCAL_KEY_DEFAULTS.settings);

function page() {
	return h(
		"div",
		{ "data-settings-content": "" },
		row("theme", control(button("theme.switch")), side("theme.more"), reset("theme.reset")),
		row("contrast", control(button("contrast.switch"))),
		row(
			"width",
			control(h("input", { type: "text", "data-name": "width.input", "data-setting-clean": "" })),
			reset("width.reset"),
		),
		row("notes", control(h("textarea", { "data-name": "notes.area" }))),
		row(
			"shortcuts",
			h(
				"div",
				{ role: "tree" },
				item("split", reset("split.reset")),
				item("close", reset("close.reset")),
			),
		),
	);
}

function keyDown(root: FakeNode, from: string, key: LocalKeyEvent, prevented = false) {
	const toNav = mock(() => {});
	dom.focused = null;
	dom.log = [];
	const handled = settingsKeyDown(
		{ defaultPrevented: prevented, nativeEvent: key },
		root,
		named(root, from),
		keys,
		{ toNav },
	);
	return { handled, landed: nameOf(dom.focused), toNav, log: dom.log };
}

const fresh = () => {
	resetDom();
	return page();
};

const down = press("ArrowDown");
const up = press("ArrowUp");

describe("useSettingsKeyboard's key handler", () => {
	test("↓/↑ and the j/k twins walk the rows; the edges consume the key without wrapping", () => {
		const root = fresh();
		expect(keyDown(root, "contrast.switch", down)).toMatchObject({
			handled: true,
			landed: "width.input",
		});
		expect(keyDown(root, "width.input", up)).toMatchObject({
			handled: true,
			landed: "contrast.switch",
		});
		expect(keyDown(root, "theme.switch", press("KeyJ", "j")).landed).toBe("contrast.switch");
		expect(keyDown(root, "contrast.switch", press("KeyK", "k")).landed).toBe("theme.switch");
		expect(keyDown(root, "theme.switch", up)).toMatchObject({ handled: true, landed: null });
		expect(keyDown(root, "close", down)).toMatchObject({ handled: true, landed: null });
	});

	test("Home/End go to the page's first and last stop outside text entry", () => {
		const root = fresh();
		expect(keyDown(root, "theme.switch", press("End")).landed).toBe("close");
		expect(keyDown(root, "close", press("Home")).landed).toBe("theme.switch");
		expect(keyDown(root, "width.input", press("End")).handled).toBe(false);
	});

	test("a single-line field walks on ↓/↑ but types j/k; a textarea keeps its arrows", () => {
		const root = fresh();
		expect(keyDown(root, "width.input", down).landed).toBe("notes.area");
		expect(keyDown(root, "width.input", press("KeyJ", "j")).handled).toBe(false);
		expect(keyDown(root, "notes.area", up).handled).toBe(false);
	});

	test("→/l reach the sides and ← comes back; ← from a stop and h go to the nav", () => {
		const root = fresh();
		expect(keyDown(root, "theme.switch", press("ArrowRight")).landed).toBe("theme.more");
		expect(keyDown(root, "theme.more", press("KeyL", "l")).landed).toBe("theme.reset");
		expect(keyDown(root, "theme.reset", press("ArrowLeft")).landed).toBe("theme.more");
		const left = keyDown(root, "theme.switch", press("ArrowLeft"));
		expect([left.handled, left.toNav.mock.calls.length]).toEqual([true, 1]);
		expect(keyDown(root, "theme.switch", press("KeyH", "h")).toNav.mock.calls.length).toBe(1);
		expect(keyDown(root, "width.input", press("ArrowLeft")).handled).toBe(false);
	});

	test("↑/↓ from a Reset side inside the tree step to the neighbouring item", () => {
		const root = fresh();
		expect(keyDown(root, "close.reset", up).landed).toBe("split");
		expect(keyDown(root, "split.reset", down).landed).toBe("close");
		expect(keyDown(root, "split.reset", up).landed).toBe("notes.area");
	});

	test("Delete resets the row, from a side after moving to the stop, and from a clean field", () => {
		const root = fresh();
		const del = press("Delete");
		expect(keyDown(root, "theme.switch", del).log).toEqual(["click theme.reset"]);
		expect(keyDown(root, "theme.more", del).log).toEqual([
			"focus theme.switch",
			"click theme.reset",
		]);
		expect(keyDown(root, "width.input", del).log).toEqual(["click width.reset"]);
		named(root, "width.input").removeAttribute("data-setting-clean");
		expect(keyDown(root, "width.input", del)).toMatchObject({ handled: false, log: [] });
		expect(keyDown(root, "split.reset", del).log).toEqual(["focus split", "click split.reset"]);
	});

	test("Esc goes to the nav when nothing before the walk took it", () => {
		const root = fresh();
		const escaped = keyDown(root, "width.input", press("Escape"));
		expect([escaped.handled, escaped.toNav.mock.calls.length]).toEqual([true, 1]);
	});

	test("an IME composition, a modified arrow, a prevented press or a portaled target do nothing", () => {
		const root = fresh();
		expect(
			keyDown(root, "theme.switch", press("ArrowDown", "ArrowDown", { isComposing: true })),
		).toMatchObject({ handled: false, landed: null });
		expect(
			keyDown(root, "theme.switch", press("ArrowDown", "ArrowDown", { keyCode: 229 })).handled,
		).toBe(false);
		expect(
			keyDown(root, "theme.switch", press("ArrowDown", "ArrowDown", { altKey: true })).handled,
		).toBe(false);
		expect(keyDown(root, "theme.switch", down, true)).toMatchObject({
			handled: false,
			landed: null,
		});
		const portal = h("div", {}, button("confirm.ok"));
		const toNav = mock(() => {});
		const handled = settingsKeyDown(
			{ defaultPrevented: false, nativeEvent: press("ArrowLeft") },
			root,
			named(portal, "confirm.ok"),
			keys,
			{ toNav },
		);
		expect([handled, toNav.mock.calls.length]).toEqual([false, 0]);
	});
});
