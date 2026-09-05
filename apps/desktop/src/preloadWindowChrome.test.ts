import { expect, test } from "bun:test";
import { createPreloadWindowChrome, readPreloadWindowChromePlatform } from "./preloadWindowChrome";

test("accepts only a shipped platform injected by the trusted preload", () => {
	expect(readPreloadWindowChromePlatform("macos")).toBe("macos");
	expect(readPreloadWindowChromePlatform("windows")).toBe("windows");
	expect(readPreloadWindowChromePlatform("linux")).toBe("linux");
	expect(readPreloadWindowChromePlatform("browser")).toBeNull();
	expect(readPreloadWindowChromePlatform(null)).toBeNull();
});

test("the frozen preload capability forwards only bounded window commands", () => {
	const commands: unknown[] = [];
	const chrome = createPreloadWindowChrome({
		platform: "windows",
		dispatch: (command) => commands.push(command),
	});

	expect(Object.isFrozen(chrome.adapter)).toBe(true);
	expect(chrome.adapter.version).toBe(1);
	expect(chrome.adapter.platform).toBe("windows");
	chrome.adapter.minimize();
	chrome.adapter.toggleMaximize();
	chrome.adapter.requestClose();
	chrome.adapter.startResize("south-east");
	expect(commands).toEqual([
		{ kind: "minimize" },
		{ kind: "toggle-maximize" },
		{ kind: "request-close" },
		{ kind: "start-resize", edge: "south-east" },
	]);
});

test("native state updates are validated, observable, and unsubscribe cleanly", () => {
	const chrome = createPreloadWindowChrome({ platform: "linux", dispatch: () => {} });
	let notifications = 0;
	const unsubscribe = chrome.adapter.subscribe(() => {
		notifications += 1;
	});

	const initialSnapshot = chrome.adapter.getSnapshot();
	expect(initialSnapshot).toEqual({ maximized: false });
	expect(Object.isFrozen(initialSnapshot)).toBe(true);
	expect(Reflect.set(initialSnapshot, "maximized", true)).toBe(false);
	expect(chrome.adapter.getSnapshot()).toEqual({ maximized: false });
	expect(chrome.applySnapshot({ maximized: true })).toBe(true);
	expect(chrome.adapter.getSnapshot()).toEqual({ maximized: true });
	expect(notifications).toBe(1);
	expect(chrome.applySnapshot({ maximized: "yes" })).toBe(false);
	expect(chrome.applySnapshot(null)).toBe(false);
	expect(notifications).toBe(1);
	unsubscribe();
	expect(chrome.applySnapshot({ maximized: false })).toBe(true);
	expect(notifications).toBe(1);
});
