import { expect, test } from "bun:test";
import {
	asNativeWindowChromeAdapter,
	getNativeWindowChromeAdapter,
	NATIVE_WINDOW_CHROME_GLOBAL,
} from "./nativeWindowChrome";

function adapter() {
	return {
		version: 1,
		platform: "windows",
		getSnapshot: () => ({ maximized: false }),
		subscribe: () => () => {},
		minimize: () => {},
		toggleMaximize: () => {},
		requestClose: () => {},
		startResize: () => {},
	};
}

test("accepts only the complete versioned native-window capability", () => {
	const complete = adapter();
	expect(asNativeWindowChromeAdapter(complete)).toBe(complete);
	for (const key of Object.keys(complete)) {
		const incomplete = { ...complete };
		Reflect.deleteProperty(incomplete, key);
		expect(asNativeWindowChromeAdapter(incomplete)).toBeNull();
	}
	expect(asNativeWindowChromeAdapter({ ...complete, version: 2 })).toBeNull();
	expect(asNativeWindowChromeAdapter({ ...complete, platform: "browser" })).toBeNull();
	expect(asNativeWindowChromeAdapter(null)).toBeNull();
});

test("reads the capability from its one preload global", () => {
	const complete = adapter();
	Reflect.set(globalThis, NATIVE_WINDOW_CHROME_GLOBAL, complete);
	try {
		expect(getNativeWindowChromeAdapter()).toBe(complete);
	} finally {
		Reflect.deleteProperty(globalThis, NATIVE_WINDOW_CHROME_GLOBAL);
	}
	expect(getNativeWindowChromeAdapter()).toBeNull();
});
