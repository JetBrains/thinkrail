import { expect, test } from "bun:test";
import {
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
	const create = (next: SplashWindowOptions): SplashWindow => {
		options = next;
		calls.push("create");
		return {
			center: () => calls.push("center"),
			hide: () => calls.push("hide"),
			close: () => calls.push("close"),
			webview: {
				on: (_event, listener) => {
					ready = listener;
					if (readyOnCreate) listener();
				},
			},
		};
	};
	return { calls, create, options: () => options, ready: () => ready?.() };
}

test("the splash message names a pending update target or a plain start", () => {
	expect(splashMessage("0.3.0-nightly.4")).toBe("Finishing update to 0.3.0-nightly.4…");
	expect(splashMessage(null)).toBe("Starting ThinkRail…");
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
