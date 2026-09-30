import { expect, test } from "bun:test";
import { handlePageZoomShortcut, nextPageZoom, type PageZoomAction } from "./pageZoom";

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

test("steps from the webview's current zoom to the adjacent browser factor", () => {
	expect(nextPageZoom(1, "in")).toBe(1.1);
	expect(nextPageZoom(1.1, "in")).toBe(1.25);
	expect(nextPageZoom(1.25, "out")).toBe(1.1);
	expect(nextPageZoom(1, "out")).toBe(0.9);
});

test("steps from zoom changed outside the shortcuts", () => {
	expect(nextPageZoom(0.75, "in")).toBe(0.8);
	expect(nextPageZoom(0.75, "out")).toBe(0.67);
	expect(nextPageZoom(3, "out")).toBe(2);
	expect(nextPageZoom(1.0999999, "in")).toBe(1.25);
	expect(nextPageZoom(1.1000001, "out")).toBe(1);
});

test("resets and clamps page zoom", () => {
	expect(nextPageZoom(1.75, "reset")).toBe(1);
	expect(nextPageZoom(2, "in")).toBe(2);
	expect(nextPageZoom(0.5, "out")).toBe(0.5);
	expect(nextPageZoom(3, "in")).toBe(3);
});
