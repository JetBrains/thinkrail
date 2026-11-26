import { describe, expect, mock, test } from "bun:test";
import { type LocalKeyEvent, localKeys } from "@thinkrail/ui/local-keys";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";
import {
	button,
	choice,
	control,
	dom,
	type FakeNode,
	field,
	h,
	item,
	named,
	nameOf,
	press,
	reset,
	resetDom,
	row,
	toggle,
} from "./settingsFakeDom.test";
import { settingsKeyDown } from "./useSettingsKeyboard";

const keys = localKeys(null, "settings", LOCAL_KEY_DEFAULTS.settings);

function page() {
	return h(
		"div",
		{ "data-settings-content": "" },
		row("theme", control(choice("theme.list", "theme.dark", "theme.light")), reset("theme.reset")),
		row("ligatures", control(toggle("ligatures.switch"))),
		row(
			"width",
			control(
				h("input", {
					type: "text",
					"data-name": "width.input",
					"data-setting-clean": "",
					value: "80",
				}),
			),
			reset("width.reset"),
		),
		row("notes", control(h("textarea", { "data-name": "notes.area" }))),
		row("folder", button("folder.copy"), button("folder.open")),
		h("form", {}, row("named", control(field("named.input")))),
		row(
			"shortcuts",
			h(
				"div",
				{ role: "tree" },
				item("split", button("split.change"), reset("split.reset")),
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
const right = press("ArrowRight");
const left = press("ArrowLeft");
const enter = press("Enter");
const space = press("Space", " ");

describe("useSettingsKeyboard's key handler", () => {
	test("↓/↑ and the j/k twins walk from row to row and never into a control; the edges consume the key", () => {
		const root = fresh();
		expect(keyDown(root, "theme", down)).toMatchObject({ handled: true, landed: "ligatures" });
		expect(keyDown(root, "ligatures", up).landed).toBe("theme");
		expect(keyDown(root, "theme", press("KeyJ", "j")).landed).toBe("ligatures");
		expect(keyDown(root, "ligatures", press("KeyK", "k")).landed).toBe("theme");
		expect(keyDown(root, "theme", up)).toMatchObject({ handled: true, landed: null });
		expect(keyDown(root, "close", down)).toMatchObject({ handled: true, landed: null });
		expect(dom.log).toEqual([]);
	});

	test("Home/End go to the first and last stop outside text entry", () => {
		const root = fresh();
		expect(keyDown(root, "ligatures", press("End")).landed).toBe("close");
		expect(keyDown(root, "close", press("Home")).landed).toBe("theme");
		expect(keyDown(root, "width.input", press("End")).handled).toBe(false);
	});

	test("→/l reach a row's buttons and ←/h come back to it; ← on a row goes to the nav", () => {
		const root = fresh();
		expect(keyDown(root, "theme", right).landed).toBe("theme.reset");
		expect(keyDown(root, "folder", press("KeyL", "l")).landed).toBe("folder.copy");
		expect(keyDown(root, "folder.copy", right).landed).toBe("folder.open");
		expect(keyDown(root, "folder.open", left).landed).toBe("folder.copy");
		expect(keyDown(root, "folder.copy", press("KeyH", "h")).landed).toBe("folder");
		const nav = keyDown(root, "folder", left);
		expect([nav.handled, nav.toNav.mock.calls.length]).toEqual([true, 1]);
		expect(keyDown(root, "width.input", left).handled).toBe(false);
	});

	test("Enter enters a row's control, Space toggles a switch row, a button keeps both native", () => {
		const root = fresh();
		expect(keyDown(root, "theme", enter).landed).toBe("theme.dark");
		expect(keyDown(root, "width", enter).log).toEqual(["focus width.input", "select width.input"]);
		expect(keyDown(root, "ligatures", space).log).toEqual(["click ligatures.switch"]);
		expect(keyDown(root, "folder", enter).landed).toBe("folder.copy");
		expect(keyDown(root, "folder.copy", enter).handled).toBe(false);
		expect(keyDown(root, "split", space).log).toEqual(["click split.change"]);
	});

	test("inside a control, Enter and Esc return to the row; ← past a choice's start returns too", () => {
		const root = fresh();
		expect(keyDown(root, "width.input", enter).landed).toBe("width");
		expect(keyDown(root, "width.input", press("Escape")).landed).toBe("width");
		expect(keyDown(root, "notes.area", press("Escape")).landed).toBe("notes");
		expect(keyDown(root, "theme.light", left).landed).toBe("theme");
		expect(keyDown(root, "theme.light", right)).toMatchObject({ handled: true, landed: null });
		expect(keyDown(root, "theme.reset", press("Escape")).landed).toBe("theme");
		expect(keyDown(root, "notes.area", enter).handled).toBe(false);
		expect(keyDown(root, "named.input", enter).handled).toBe(false);
	});

	test("a single-line field types its letters and keeps its arrows, but walks on ↓/↑", () => {
		const root = fresh();
		expect(keyDown(root, "width.input", down).landed).toBe("notes");
		expect(keyDown(root, "width.input", press("KeyJ", "j")).handled).toBe(false);
		expect(keyDown(root, "width.input", right).handled).toBe(false);
		expect(keyDown(root, "notes.area", up).handled).toBe(false);
	});

	test("↑/↓ from a button inside the tree step to the neighbouring item", () => {
		const root = fresh();
		expect(keyDown(root, "close.reset", up).landed).toBe("split");
		expect(keyDown(root, "split.reset", down).landed).toBe("close");
		expect(keyDown(root, "split.change", up).landed).toBe("named");
	});

	test("Delete resets the row, from inside it after moving to the row, and from a clean field", () => {
		const root = fresh();
		const del = press("Delete");
		expect(keyDown(root, "theme", del).log).toEqual(["click theme.reset"]);
		expect(keyDown(root, "theme.dark", del).log).toEqual(["focus theme", "click theme.reset"]);
		expect(keyDown(root, "width.input", del).log).toEqual(["focus width", "click width.reset"]);
		named(root, "width.input").removeAttribute("data-setting-clean");
		expect(keyDown(root, "width.input", del)).toMatchObject({ handled: false, log: [] });
		expect(keyDown(root, "split.reset", del).log).toEqual(["focus split", "click split.reset"]);
	});

	test("Esc on a row goes to the nav when nothing before the walk took it", () => {
		const root = fresh();
		const escaped = keyDown(root, "width", press("Escape"));
		expect([escaped.handled, escaped.toNav.mock.calls.length]).toEqual([true, 1]);
	});

	test("an IME composition, a modified arrow, a prevented press or a portaled target do nothing", () => {
		const root = fresh();
		expect(
			keyDown(root, "theme", press("ArrowDown", "ArrowDown", { isComposing: true })),
		).toMatchObject({ handled: false, landed: null });
		expect(keyDown(root, "theme", press("ArrowDown", "ArrowDown", { keyCode: 229 })).handled).toBe(
			false,
		);
		expect(keyDown(root, "theme", press("ArrowDown", "ArrowDown", { altKey: true })).handled).toBe(
			false,
		);
		expect(keyDown(root, "theme", press("Enter", "Enter", { isComposing: true })).handled).toBe(
			false,
		);
		expect(keyDown(root, "theme", down, true)).toMatchObject({ handled: false, landed: null });
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
