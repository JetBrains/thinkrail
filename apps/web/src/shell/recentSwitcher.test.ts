import { describe, expect, test } from "bun:test";
import { RiGitBranchLine } from "@remixicon/react";
import type { PaletteItem, RecentWorkspaces } from "../search";
import { createRecentSwitcher, type SwitcherStep } from "./recentSwitcher";

type Handler = (event: unknown) => void;

const INSIDE = new EventTarget();

function harness(initial: readonly string[], currentId: string | null = initial[0] ?? null) {
	const opened: string[] = [];
	const claims: boolean[] = [];
	const listeners: { type: string; handler: Handler; capture: boolean }[] = [];
	const timers: (() => void)[] = [];
	let refresh: (() => void) | null = null;
	const row = (id: string): PaletteItem => ({
		id,
		kind: "workspace",
		title: id,
		group: "workspaces",
		scope: "work",
		icon: RiGitBranchLine,
		run: () => opened.push(id),
	});
	let recent: RecentWorkspaces = { rows: initial.map(row), currentId };
	const switcher = createRecentSwitcher({
		load: () => recent,
		chordStep: (event) =>
			event.ctrlKey && event.code === "Tab" ? ((event.shiftKey ? -1 : 1) as SwitcherStep) : null,
		watch: (onChange) => {
			refresh = onChange;
			return () => {
				refresh = null;
			};
		},
		claimKeyboard: (active) => claims.push(active),
		isInside: (target) => target === INSIDE,
		target: () => ({
			addEventListener: (type: string, handler: Handler, capture?: boolean) =>
				listeners.push({ type, handler, capture: capture === true }),
			removeEventListener: (type: string, handler: Handler) => {
				const index = listeners.findIndex(
					(entry) => entry.type === type && entry.handler === handler,
				);
				if (index !== -1) listeners.splice(index, 1);
			},
		}),
		schedule: (run) => {
			timers.push(run);
			return () => {
				const index = timers.indexOf(run);
				if (index !== -1) timers.splice(index, 1);
			};
		},
	});
	const fire = (type: string, event: Record<string, unknown>, capture?: boolean) => {
		for (const entry of listeners.filter(
			(candidate) =>
				candidate.type === type && (capture === undefined || candidate.capture === capture),
		)) {
			entry.handler({ preventDefault() {}, stopPropagation() {}, isComposing: false, ...event });
		}
	};
	const key = (key: string, extra: Record<string, unknown> = {}) =>
		fire("keydown", { key, code: key, ctrlKey: true, metaKey: false, altKey: false, ...extra });
	const release = (extra: Record<string, unknown> = {}) =>
		fire("keyup", { key: "Control", ctrlKey: false, metaKey: false, altKey: false, ...extra });
	return {
		switcher,
		opened,
		claims,
		listeners,
		key,
		release,
		fire,
		showTimers: () => {
			for (const run of timers.splice(0)) run();
		},
		setRows: (ids: readonly string[], current: string | null) => {
			recent = { rows: ids.map(row), currentId: current };
			refresh?.();
		},
		start: (step: SwitcherStep = 1) =>
			switcher.start(step, { ctrl: true, meta: false, alt: false }),
	};
}

describe("the recent workspace switcher", () => {
	test("a tap opens the workspace after the current one, without ever showing the list", () => {
		const h = harness(["c", "b", "a"]);
		h.start();
		expect(h.switcher.getSnapshot()).toMatchObject({ open: true, visible: false, index: 1 });
		h.release();
		expect(h.opened).toEqual(["b"]);
		expect(h.switcher.getSnapshot().open).toBe(false);
		expect(h.claims).toEqual([true, false]);
		expect(h.listeners).toEqual([]);
	});

	test("holding shows the list after the delay; Tab and the chord step it, releasing opens the pick", () => {
		const h = harness(["c", "b", "a"]);
		h.start();
		h.showTimers();
		expect(h.switcher.getSnapshot().visible).toBe(true);
		h.key("Tab");
		expect(h.switcher.getSnapshot().index).toBe(2);
		h.key("Tab");
		expect(h.switcher.getSnapshot().index).toBe(0);
		h.key("Tab", { shiftKey: true });
		h.key("ArrowUp");
		expect(h.switcher.getSnapshot().index).toBe(1);
		h.release({ key: "Tab", ctrlKey: true });
		expect(h.opened).toEqual([]);
		h.release();
		expect(h.opened).toEqual(["b"]);
	});

	test("the reverse chord starts at the oldest row; Esc and Enter close it their way", () => {
		const h = harness(["c", "b", "a"]);
		h.start(-1);
		expect(h.switcher.getSnapshot().index).toBe(2);
		h.key("Escape");
		h.release();
		expect(h.opened).toEqual([]);
		expect(h.claims).toEqual([true, false]);
		h.start();
		h.key("Enter");
		expect(h.opened).toEqual(["b"]);
	});

	test("focus moving inside the page keeps the pick; the window losing focus cancels it", () => {
		const h = harness(["c", "b", "a"]);
		h.start();
		h.fire("blur", {}, true);
		expect(h.switcher.getSnapshot().open).toBe(true);
		h.fire("blur", {}, false);
		expect(h.switcher.getSnapshot().open).toBe(false);
		expect(h.opened).toEqual([]);
	});

	test("a click outside cancels; a row click opens that row", () => {
		const h = harness(["c", "b", "a"]);
		h.start();
		h.fire("pointerdown", { target: INSIDE });
		expect(h.switcher.getSnapshot().open).toBe(true);
		h.switcher.hover(2);
		h.switcher.activate(2);
		expect(h.opened).toEqual(["a"]);
		h.start();
		h.fire("pointerdown", { target: new EventTarget() });
		expect(h.switcher.getSnapshot().open).toBe(false);
	});

	test("with no other workspace loaded a tap opens nothing; without the current row the first row is next", () => {
		const only = harness(["c"]);
		only.start();
		only.showTimers();
		expect(only.switcher.getSnapshot()).toMatchObject({ open: true, visible: false });
		only.release();
		expect(only.opened).toEqual([]);
		expect(only.switcher.getSnapshot().open).toBe(false);
		only.switcher.start(1, { ctrl: false, meta: false, alt: false });
		expect(only.opened).toEqual([]);
		const away = harness(["b", "a"], null);
		away.start();
		expect(away.switcher.getSnapshot().index).toBe(0);
	});

	test("a chord without a held modifier switches at once", () => {
		const h = harness(["c", "b"]);
		h.switcher.start(1, { ctrl: false, meta: false, alt: false });
		expect(h.opened).toEqual(["b"]);
		expect(h.claims).toEqual([]);
	});

	test("a hold that began with nothing else loaded shows and picks a workspace the backfill brings", () => {
		const h = harness(["c"]);
		h.start();
		h.showTimers();
		expect(h.switcher.getSnapshot().visible).toBe(false);
		h.setRows(["c", "b", "a"], "c");
		expect(h.switcher.getSnapshot()).toMatchObject({ visible: true, index: 1 });
		h.release();
		expect(h.opened).toEqual(["b"]);
	});

	test("rows that change while open keep the selected workspace selected", () => {
		const h = harness(["c", "b", "a"]);
		h.start();
		h.setRows(["c", "d", "b", "a"], "c");
		expect(h.switcher.getSnapshot().index).toBe(2);
		h.release();
		expect(h.opened).toEqual(["b"]);
	});
});
