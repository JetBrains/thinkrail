import { expect, test } from "bun:test";
import {
	createTitleBarDoubleClickHandler,
	installTitleBarDoubleClick,
	isTitleBarDoubleClick,
	performTitleBarDoubleClick,
	readTitleBarDoubleClickPreference,
	type TitleBarDoubleClickResult,
	type TitleBarWindow,
	titleBarDoubleClickAction,
} from "./titleBarDoubleClick";

function target(nodeType: number): EventTarget {
	return { nodeType } as unknown as EventTarget;
}

function mouseEvent(
	eventTarget: EventTarget | null,
	button = 0,
	defaultPrevented = false,
): Pick<MouseEvent, "button" | "defaultPrevented" | "target"> {
	return { button, defaultPrevented, target: eventTarget };
}

function style(value: string): (element: Element) => Pick<CSSStyleDeclaration, "getPropertyValue"> {
	return () => ({
		getPropertyValue: (property) => (property === "--electrobun-app-region" ? value : "drag"),
	});
}

function createFakeWindow(
	initial: { fullscreen?: boolean; maximized?: boolean; minimized?: boolean } = {},
) {
	const calls: string[] = [];
	let maximized = initial.maximized ?? false;
	let minimized = initial.minimized ?? false;
	const window: TitleBarWindow = {
		isFullScreen: () => initial.fullscreen ?? false,
		isMaximized: () => maximized,
		isMinimized: () => minimized,
		maximize() {
			calls.push("maximize");
			maximized = true;
			minimized = false;
		},
		unmaximize() {
			calls.push("unmaximize");
			maximized = false;
		},
		minimize() {
			calls.push("minimize");
			minimized = true;
		},
		getFrame: () => ({ x: 10, y: 20, width: 300, height: 200 }),
	};
	return { window, calls, getState: () => ({ maximized, minimized }) };
}

test("isTitleBarDoubleClick accepts only primary, unprevented drag-region element events", () => {
	const dragTarget = target(1);
	const readDragStyle = style("drag");
	for (const value of ["drag", " drag ", "DRAG"]) {
		expect(isTitleBarDoubleClick(mouseEvent(dragTarget), style(value))).toBe(true);
	}
	for (const value of ["no-drag", ""]) {
		expect(isTitleBarDoubleClick(mouseEvent(dragTarget), style(value))).toBe(false);
	}
	expect(isTitleBarDoubleClick(mouseEvent(dragTarget, 1), readDragStyle)).toBe(false);
	expect(isTitleBarDoubleClick(mouseEvent(dragTarget, 2), readDragStyle)).toBe(false);
	expect(isTitleBarDoubleClick(mouseEvent(dragTarget, 0, true), readDragStyle)).toBe(false);
	expect(isTitleBarDoubleClick(mouseEvent(null), readDragStyle)).toBe(false);
	expect(isTitleBarDoubleClick(mouseEvent(target(3)), readDragStyle)).toBe(false);
	expect(
		isTitleBarDoubleClick(mouseEvent(dragTarget), () => {
			throw new Error("style read failed");
		}),
	).toBe(false);
});

test("installTitleBarDoubleClick registers one bubble listener and sends only for drag events", () => {
	let registrationCount = 0;
	let registeredType = "";
	let listener: EventListener | undefined;
	const fakeTarget: Pick<EventTarget, "addEventListener"> = {
		addEventListener(type, callback) {
			registrationCount += 1;
			registeredType = type;
			if (typeof callback === "function") listener = callback;
		},
	};
	let sends = 0;
	installTitleBarDoubleClick(
		fakeTarget,
		() => {
			sends += 1;
		},
		style("DRAG"),
	);
	expect(registrationCount).toBe(1);
	expect(registeredType).toBe("dblclick");
	listener?.(mouseEvent(target(1)) as unknown as Event);
	expect(sends).toBe(1);
	installTitleBarDoubleClick(
		{
			addEventListener(_type, callback) {
				if (typeof callback === "function") listener = callback;
			},
		},
		() => {
			sends += 1;
		},
		style("no-drag"),
	);
	listener?.(mouseEvent(target(1)) as unknown as Event);
	expect(sends).toBe(1);
});

test("titleBarDoubleClickAction maps supported preferences exactly", () => {
	for (const preference of [null, "Maximize", "Fill"]) {
		expect(titleBarDoubleClickAction(preference)).toBe("zoom");
	}
	expect(titleBarDoubleClickAction("Minimize")).toBe("minimize");
	for (const preference of ["None", "", "maximize", "Unknown"]) {
		expect(titleBarDoubleClickAction(preference)).toBe("none");
	}
});

test("readTitleBarDoubleClickPreference reads and validates the global setting", async () => {
	const command = ["/usr/bin/defaults", "read", "-g", "AppleActionOnDoubleClick"];
	expect(
		await readTitleBarDoubleClickPreference(async (received) => {
			expect(received).toEqual(command);
			return { exitCode: 0, stdout: "Fill\n" };
		}),
	).toBe("Fill");
	expect(
		await readTitleBarDoubleClickPreference(async (received) => {
			expect(received).toEqual(command);
			return { exitCode: 1, stdout: "Maximize\n" };
		}),
	).toBeNull();
	expect(
		await readTitleBarDoubleClickPreference(async (received) => {
			expect(received).toEqual(command);
			return { exitCode: 0, stdout: " \n\t" };
		}),
	).toBeNull();
	expect(
		await readTitleBarDoubleClickPreference(async () => {
			throw new Error("defaults failed");
		}),
	).toBeNull();
});

test("performTitleBarDoubleClick toggles zoom, minimizes, and ignores none", () => {
	const fake = createFakeWindow();
	performTitleBarDoubleClick(fake.window, "zoom");
	expect(fake.getState().maximized).toBe(true);
	performTitleBarDoubleClick(fake.window, "zoom");
	expect(fake.getState().maximized).toBe(false);
	performTitleBarDoubleClick(fake.window, "minimize");
	expect(fake.getState().minimized).toBe(true);
	performTitleBarDoubleClick(fake.window, "none");
	expect(fake.calls).toEqual(["maximize", "unmaximize", "minimize"]);
});

test("createTitleBarDoubleClickHandler snapshots changes and skips mutations in fullscreen", async () => {
	const fake = createFakeWindow();
	const results: TitleBarDoubleClickResult[] = [];
	const handler = createTitleBarDoubleClickHandler({
		enabled: true,
		window: fake.window,
		readPreference: async () => "Maximize",
		onHandled: (result) => results.push(result),
	});
	await handler();
	expect(fake.calls).toEqual(["maximize"]);
	expect(results).toEqual([
		{
			preference: "Maximize",
			action: "zoom",
			before: {
				maximized: false,
				minimized: false,
				frame: { x: 10, y: 20, width: 300, height: 200 },
			},
			after: {
				maximized: true,
				minimized: false,
				frame: { x: 10, y: 20, width: 300, height: 200 },
			},
		},
	]);

	const fullscreen = createFakeWindow({ fullscreen: true });
	const fullscreenResults: TitleBarDoubleClickResult[] = [];
	const fullscreenHandler = createTitleBarDoubleClickHandler({
		enabled: true,
		window: fullscreen.window,
		readPreference: async () => "Maximize",
		onHandled: (result) => fullscreenResults.push(result),
	});
	await fullscreenHandler();
	expect(fullscreen.calls).toEqual([]);
	expect(fullscreenResults[0]?.action).toBe("none");
});

test("createTitleBarDoubleClickHandler does not read preference when disabled", async () => {
	const fake = createFakeWindow();
	let reads = 0;
	const handler = createTitleBarDoubleClickHandler({
		enabled: false,
		window: fake.window,
		readPreference: async () => {
			reads += 1;
			return "Maximize";
		},
	});
	await handler();
	expect(reads).toBe(0);
	expect(fake.calls).toEqual([]);
});

test("createTitleBarDoubleClickHandler drops overlapping calls and resets after settling", async () => {
	const fake = createFakeWindow();
	const resolvers: Array<(preference: string | null) => void> = [];
	const results: TitleBarDoubleClickResult[] = [];
	const handler = createTitleBarDoubleClickHandler({
		enabled: true,
		window: fake.window,
		readPreference: () => new Promise((resolve) => resolvers.push(resolve)),
		onHandled: (result) => results.push(result),
	});
	const first = handler();
	const overlapping = handler();
	expect(resolvers).toHaveLength(1);
	resolvers[0]?.("Maximize");
	await Promise.all([first, overlapping]);
	expect(results).toHaveLength(1);

	const next = handler();
	expect(resolvers).toHaveLength(2);
	resolvers[1]?.("Minimize");
	await next;
	expect(results).toHaveLength(2);
	expect(fake.calls).toEqual(["maximize", "minimize"]);
});

test("createTitleBarDoubleClickHandler catches preference errors and resets pending", async () => {
	const fake = createFakeWindow();
	const results: TitleBarDoubleClickResult[] = [];
	let reads = 0;
	const handler = createTitleBarDoubleClickHandler({
		enabled: true,
		window: fake.window,
		readPreference: () => {
			reads += 1;
			return reads === 1 ? Promise.reject(new Error("preference failed")) : Promise.resolve("None");
		},
		onHandled: (result) => results.push(result),
	});
	const originalError = console.error;
	console.error = () => {};
	try {
		await expect(handler()).resolves.toBeUndefined();
		await expect(handler()).resolves.toBeUndefined();
	} finally {
		console.error = originalError;
	}
	expect(reads).toBe(2);
	expect(results).toHaveLength(1);
	expect(results[0]?.action).toBe("none");
});
