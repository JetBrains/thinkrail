import { expect, test } from "bun:test";
import {
	createPageZoomGestureHandler,
	handlePageZoomShortcut,
	installPageZoomGestures,
	nextPageZoom,
	type PageZoomAction,
	type PageZoomGesture,
	pageZoomForGesture,
} from "./pageZoom";

function gestureEvent(type: string, scale?: number): Event {
	const event = new Event(type, { cancelable: true });
	if (scale !== undefined) Object.defineProperty(event, "scale", { value: scale });
	return event;
}

function shortcut(
	platform: string,
	key: string,
	modifiers: Partial<
		Pick<KeyboardEvent, "altKey" | "ctrlKey" | "defaultPrevented" | "metaKey">
	> = {},
): { actions: PageZoomAction[]; calls: string[] } {
	const actions: PageZoomAction[] = [];
	const calls: string[] = [];
	handlePageZoomShortcut(
		{
			key,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			defaultPrevented: false,
			preventDefault: () => calls.push("preventDefault"),
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
			calls: ["preventDefault"],
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

test("yields zoom chords a page handler already claimed", () => {
	expect(shortcut("MacIntel", "0", { metaKey: true, defaultPrevented: true })).toEqual({
		actions: [],
		calls: [],
	});
	expect(shortcut("Win32", "-", { ctrlKey: true, defaultPrevented: true })).toEqual({
		actions: [],
		calls: [],
	});
});

test("turns a WebKit pinch lifecycle into page zoom requests", () => {
	const target = new EventTarget();
	const gestures: PageZoomGesture[] = [];
	installPageZoomGestures(target, "MacIntel", (gesture) => gestures.push(gesture));
	const start = gestureEvent("gesturestart");
	const change = gestureEvent("gesturechange", 1.4);
	const end = gestureEvent("gestureend");

	target.dispatchEvent(start);
	target.dispatchEvent(change);
	target.dispatchEvent(end);

	expect(gestures).toEqual([{ phase: "start" }, { phase: "change", scale: 1.4 }, { phase: "end" }]);
	expect([start.defaultPrevented, change.defaultPrevented, end.defaultPrevented]).toEqual([
		true,
		true,
		true,
	]);
});

test("drops malformed scale updates from an active pinch", () => {
	const target = new EventTarget();
	const gestures: PageZoomGesture[] = [];
	installPageZoomGestures(target, "MacIntel", (gesture) => gestures.push(gesture));
	target.dispatchEvent(gestureEvent("gesturestart"));

	for (const scale of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
		target.dispatchEvent(gestureEvent("gesturechange", scale));
	}

	expect(gestures).toEqual([{ phase: "start" }]);
});

test("yields a pinch gesture that a page handler already claimed", () => {
	const target = new EventTarget();
	const gestures: PageZoomGesture[] = [];
	installPageZoomGestures(target, "MacIntel", (gesture) => gestures.push(gesture));
	const start = gestureEvent("gesturestart");
	const change = gestureEvent("gesturechange", 1.2);
	const end = gestureEvent("gestureend");
	start.preventDefault();
	target.dispatchEvent(start);
	target.dispatchEvent(change);
	target.dispatchEvent(end);

	expect(gestures).toEqual([]);
	expect([change.defaultPrevented, end.defaultPrevented]).toEqual([false, false]);
});

test("yields scale updates that a page handler already claimed", () => {
	const target = new EventTarget();
	const gestures: PageZoomGesture[] = [];
	installPageZoomGestures(target, "MacIntel", (gesture) => gestures.push(gesture));
	target.dispatchEvent(gestureEvent("gesturestart"));
	const change = gestureEvent("gesturechange", 1.2);
	change.preventDefault();
	target.dispatchEvent(change);
	target.dispatchEvent(gestureEvent("gestureend"));

	expect(gestures).toEqual([{ phase: "start" }, { phase: "end" }]);
});

test("leaves pinch gestures to the renderer outside Apple platforms", () => {
	const target = new EventTarget();
	const gestures: PageZoomGesture[] = [];
	installPageZoomGestures(target, "Win32", (gesture) => gestures.push(gesture));
	const start = gestureEvent("gesturestart");
	target.dispatchEvent(start);

	expect(gestures).toEqual([]);
	expect(start.defaultPrevented).toBe(false);
});

test("keeps every gesture scale relative to the native zoom at pinch start", () => {
	const writes: number[] = [];
	const handle = createPageZoomGestureHandler({
		getPageZoom: () => 1.25,
		setPageZoom: (zoom) => writes.push(zoom),
	});

	handle({ phase: "change", scale: 2 });
	handle({ phase: "start" });
	handle({ phase: "change", scale: 1.2 });
	handle({ phase: "change", scale: 0.8 });
	handle({ phase: "end" });
	handle({ phase: "change", scale: 2 });

	expect(writes).toEqual([1.5, 1]);
});

test("scales continuously from the zoom at gesture start", () => {
	expect(pageZoomForGesture(1.25, 1.2)).toBe(1.5);
	expect(pageZoomForGesture(1.25, 0.8)).toBe(1);
});

test("clamps gesture zoom to the browser-style range", () => {
	expect(pageZoomForGesture(1, 0.25)).toBe(0.5);
	expect(pageZoomForGesture(1, 3)).toBe(2);
});

test("ignores malformed gesture scales", () => {
	for (const scale of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
		expect(pageZoomForGesture(1.25, scale)).toBe(1.25);
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
