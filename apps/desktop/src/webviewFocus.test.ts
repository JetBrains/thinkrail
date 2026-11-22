import { expect, test } from "bun:test";
import { createWindowWithWebviewFocus } from "./webviewFocus";

function fakeWindowFactory() {
	const calls: string[] = [];
	const create = (options: { title: string; hidden: boolean }) => {
		calls.push(`create ${options.title} hidden=${options.hidden}`);
		calls.push("attach webview");
		return { show: () => calls.push("show") };
	};
	return { calls, create };
}

test("on Linux a visible window is created hidden and first shown once its webview is attached", () => {
	const { calls, create } = fakeWindowFactory();
	createWindowWithWebviewFocus(create, { title: "ThinkRail", hidden: false }, "linux");
	expect(calls).toEqual(["create ThinkRail hidden=true", "attach webview", "show"]);
});

test("a window meant to stay hidden is never shown", () => {
	for (const platform of ["linux", "darwin", "win32"] as const) {
		const { calls, create } = fakeWindowFactory();
		createWindowWithWebviewFocus(create, { title: "ThinkRail", hidden: true }, platform);
		expect(calls).toEqual(["create ThinkRail hidden=true", "attach webview"]);
	}
});

test("macOS and Windows keep Electrobun's own show at creation", () => {
	for (const platform of ["darwin", "win32"] as const) {
		const { calls, create } = fakeWindowFactory();
		createWindowWithWebviewFocus(create, { title: "ThinkRail", hidden: false }, platform);
		expect(calls).toEqual(["create ThinkRail hidden=false", "attach webview"]);
	}
});

test("the created window is returned", () => {
	const window = { show: () => undefined };
	expect(createWindowWithWebviewFocus(() => window, { hidden: false }, "linux")).toBe(window);
});
