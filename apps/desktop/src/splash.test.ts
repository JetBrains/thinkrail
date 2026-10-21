import { expect, test } from "bun:test";
import { DEFAULT_DIALOG_LABELS, readDialogLabels } from "./nativeLabels";
import {
	handOffStartupSplash,
	openStartupSplash,
	type SplashWindow,
	type SplashWindowOptions,
	splashDocument,
	splashMessage,
} from "./splash";

function fakeWindow(readyOnCreate: boolean) {
	const calls: string[] = [];
	let options: SplashWindowOptions | undefined;
	let ready: (() => void) | undefined;
	let nativeClose: (() => void) | undefined;
	const create = (next: SplashWindowOptions): SplashWindow => {
		options = next;
		calls.push("create");
		return {
			center: () => calls.push("center"),
			hide: () => calls.push("hide"),
			close: () => calls.push("close"),
			on: (_event, listener) => {
				nativeClose = listener;
			},
			webview: {
				on: (_event, listener) => {
					ready = listener;
					if (readyOnCreate) listener();
				},
			},
		};
	};
	return {
		calls,
		create,
		options: () => options,
		ready: () => ready?.(),
		closeNatively: () => nativeClose?.(),
	};
}

test("the splash message names a pending update target or a plain start", () => {
	expect(splashMessage(DEFAULT_DIALOG_LABELS, "0.3.0-nightly.4")).toBe(
		"Finishing update to 0.3.0-nightly.4…",
	);
	expect(splashMessage(DEFAULT_DIALOG_LABELS, null)).toBe("Starting ThinkRail…");
	const translated = readDialogLabels({
		"desktop.splash.finishingUpdate": "Update auf {{version}} wird abgeschlossen…",
		"desktop.splash.starting": "ThinkRail startet…",
	});
	expect(splashMessage(translated, "0.4.0")).toBe("Update auf 0.4.0 wird abgeschlossen…");
	expect(splashMessage(translated, null)).toBe("ThinkRail startet…");
	expect(splashDocument("<b>&")).toContain("&lt;b&gt;&amp;");
	expect(splashDocument("x")).toContain("prefers-color-scheme: light");
});

test("the splash is a centered data URL window that resolves on its own dom-ready", async () => {
	const window = fakeWindow(false);
	let opened = false;
	const pending = openStartupSplash(window.create, "Starting ThinkRail…", 10_000).then((splash) => {
		opened = true;
		return splash;
	});
	await Promise.resolve();
	expect(opened).toBe(false);
	window.ready();
	const splash = await pending;
	const options = window.options();
	expect(options?.url.startsWith("data:text/html;charset=utf-8,")).toBe(true);
	expect(decodeURIComponent(options?.url ?? "")).toContain("Starting ThinkRail…");
	expect(options?.titleBarStyle).toBe("hidden");
	splash.hide();
	splash.close();
	splash.close();
	splash.hide();
	expect(window.calls).toEqual(["create", "center", "hide", "close"]);
});

test("a splash that never reports readiness stops blocking startup after the bound", async () => {
	const window = fakeWindow(false);
	const started = performance.now();
	await openStartupSplash(window.create, "Starting ThinkRail…", 30);
	expect(performance.now() - started).toBeGreaterThanOrEqual(25);
});

test("a splash the user closed natively is never closed or hidden again", async () => {
	const window = fakeWindow(true);
	const splash = await openStartupSplash(window.create, "Starting ThinkRail…");
	window.closeNatively();
	splash.hide();
	splash.close();
	expect(window.calls).toEqual(["create", "center"]);
});

function fakeMainWindow() {
	const calls: string[] = [];
	let close: (() => void) | undefined;
	return {
		calls,
		window: {
			on: (_event: "close", listener: () => void) => {
				close = listener;
			},
			activate: () => calls.push("activate"),
		},
		close: () => close?.(),
	};
}

test("the splash hands off to a ready main window and activates it once", async () => {
	const splashWindow = fakeWindow(true);
	const splash = await openStartupSplash(splashWindow.create, "Starting ThinkRail…");
	const main = fakeMainWindow();
	const release = handOffStartupSplash(splash, main.window);
	release();
	release();
	main.close();
	expect(splashWindow.calls).toEqual(["create", "center", "close"]);
	expect(main.calls).toEqual(["activate"]);
});

test("closing the main window before it is ready closes the splash so the app can quit", async () => {
	const splashWindow = fakeWindow(true);
	const splash = await openStartupSplash(splashWindow.create, "Starting ThinkRail…");
	const main = fakeMainWindow();
	const release = handOffStartupSplash(splash, main.window);
	main.close();
	release();
	expect(splashWindow.calls).toEqual(["create", "center", "close"]);
	expect(main.calls).toEqual([]);
});
