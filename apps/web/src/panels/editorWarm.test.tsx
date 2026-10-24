import { afterEach, expect, test } from "bun:test";
import {
	ResourceEnvironmentProvider,
	type ResourceHost,
	ResourceHostProvider,
} from "@thinkrail/resource-renderers";
import { renderToStaticMarkup } from "react-dom/server";
import { holdEditorWarm, useEditorWarm, warmOnHover, whenFilesTreeIdle } from "./editorWarm";

const host: ResourceHost = {
	markdown: () => null,
	code: { languages: [], languageId: () => null, theme: () => ({ name: "test", settings: [] }) },
	bytesUrl: () => "",
	openFile: () => {},
	openComparison: () => {},
	readFile: async () => ({ content: "" }),
	subscribeFileChanges: () => () => {},
	FileReview: () => null,
	ReviewSend: () => null,
};

const originalIdle = {
	request: globalThis.requestIdleCallback,
	cancel: globalThis.cancelIdleCallback,
};
const IDLE = { timeout: 2000, fallbackDelay: 5 };

afterEach(() => {
	Reflect.deleteProperty(navigator, "connection");
	globalThis.requestIdleCallback = originalIdle.request;
	globalThis.cancelIdleCallback = originalIdle.cancel;
});

function stubIdle() {
	const pending: (() => void)[] = [];
	globalThis.requestIdleCallback = (run) => pending.push(run);
	globalThis.cancelIdleCallback = () => {};
	return () => {
		for (const run of pending.splice(0)) run();
	};
}

function warmAvailable() {
	const seen: boolean[] = [];
	function Probe() {
		seen.push(useEditorWarm() !== undefined);
		return null;
	}
	renderToStaticMarkup(
		<ResourceHostProvider value={host}>
			<ResourceEnvironmentProvider value={{ mobile: false }}>
				<Probe />
			</ResourceEnvironmentProvider>
		</ResourceHostProvider>,
	);
	return seen[0];
}

test("useEditorWarm offers the preload on a desktop connection", () => {
	expect(warmAvailable()).toBe(true);
});

test("useEditorWarm withholds the preload when the connection saves data", () => {
	Object.defineProperty(navigator, "connection", {
		value: { saveData: true },
		configurable: true,
	});
	expect(warmAvailable()).toBe(false);
});

test("whenFilesTreeIdle runs at the first idle when no Files tree is loading", () => {
	const flushIdle = stubIdle();
	let runs = 0;
	whenFilesTreeIdle(() => runs++, IDLE);
	expect(runs).toBe(0);
	flushIdle();
	expect(runs).toBe(1);
});

test("whenFilesTreeIdle waits for a loading Files tree, then a fresh idle", () => {
	const flushIdle = stubIdle();
	const release = holdEditorWarm();
	let runs = 0;
	whenFilesTreeIdle(() => runs++, IDLE);
	flushIdle();
	expect(runs).toBe(0);
	release();
	expect(runs).toBe(0);
	flushIdle();
	expect(runs).toBe(1);
});

test("whenFilesTreeIdle cancelled while parked never runs", () => {
	const flushIdle = stubIdle();
	const release = holdEditorWarm();
	let runs = 0;
	const cancel = whenFilesTreeIdle(() => runs++, IDLE);
	flushIdle();
	cancel();
	release();
	flushIdle();
	expect(runs).toBe(0);
});

test("warmOnHover warms only the row the pointer rests on", async () => {
	const warmed: string[] = [];
	warmOnHover(() => warmed.push("first"), 10);
	warmOnHover(() => warmed.push("second"), 10);
	await new Promise((resolve) => setTimeout(resolve, 11));
	expect(warmed).toEqual(["second"]);
});
