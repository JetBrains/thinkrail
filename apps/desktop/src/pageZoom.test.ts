import { expect, test } from "bun:test";
import { createPageZoomController, handlePageZoomShortcut, type PageZoomAction } from "./pageZoom";

function shortcut(
	platform: string,
	key: string,
	modifiers: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">> = {},
): { actions: PageZoomAction[]; calls: string[] } {
	const actions: PageZoomAction[] = [];
	const calls: string[] = [];
	handlePageZoomShortcut(
		{
			key,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			preventDefault: () => calls.push("preventDefault"),
			stopImmediatePropagation: () => calls.push("stopImmediatePropagation"),
			...modifiers,
		},
		platform,
		(action) => actions.push(action),
	);
	return { actions, calls };
}

test("uses Command on Apple platforms and Control elsewhere", () => {
	expect(shortcut("MacIntel", "+", { metaKey: true }).actions).toEqual(["in"]);
	expect(shortcut("MacIntel", "+", { ctrlKey: true }).actions).toEqual([]);
	expect(shortcut("Win32", "+", { ctrlKey: true }).actions).toEqual(["in"]);
	expect(shortcut("Linux x86_64", "+", { metaKey: true }).actions).toEqual([]);
});

test("maps browser zoom keys and claims only matching chords", () => {
	for (const key of ["+", "="]) {
		expect(shortcut("Win32", key, { ctrlKey: true })).toEqual({
			actions: ["in"],
			calls: ["preventDefault", "stopImmediatePropagation"],
		});
	}
	expect(shortcut("Win32", "-", { ctrlKey: true }).actions).toEqual(["out"]);
	expect(shortcut("Win32", "0", { ctrlKey: true }).actions).toEqual(["reset"]);
	for (const input of [
		shortcut("Win32", "+"),
		shortcut("Win32", "+", { ctrlKey: true, altKey: true }),
		shortcut("Win32", "x", { ctrlKey: true }),
	]) {
		expect(input).toEqual({ actions: [], calls: [] });
	}
});

test("steps through browser zoom factors from 100 percent", () => {
	const zoom = createPageZoomController();
	expect(zoom("in")).toBe(1.1);
	expect(zoom("in")).toBe(1.25);
	expect(zoom("out")).toBe(1.1);
	expect(zoom("out")).toBe(1);
	expect(zoom("out")).toBe(0.9);
});

test("resets and clamps page zoom", () => {
	const zoom = createPageZoomController();
	zoom("in");
	expect(zoom("reset")).toBe(1);
	for (let index = 0; index < 20; index += 1) zoom("out");
	expect(zoom("out")).toBe(0.5);
	for (let index = 0; index < 20; index += 1) zoom("in");
	expect(zoom("in")).toBe(2);
});
