import { expect, mock, test } from "bun:test";
import { fontsRevision, onFontsChange } from "./fonts";

test("onFontsChange observes only the published fonts revision and returns cleanup", () => {
	const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
	const root = { dataset: { fonts: "abc" } };
	const observe = mock((_target: unknown, _options: MutationObserverInit) => {});
	const disconnect = mock(() => {});
	const onChange = mock(() => {});
	let notify: (() => void) | undefined;
	class Observer {
		constructor(callback: () => void) {
			notify = callback;
		}
		observe = observe;
		disconnect = disconnect;
	}

	try {
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { documentElement: root },
		});
		Object.defineProperty(globalThis, "MutationObserver", {
			configurable: true,
			value: Observer,
		});
		const stop = onFontsChange(onChange);
		expect(observe).toHaveBeenCalledWith(root, {
			attributes: true,
			attributeFilter: ["data-fonts"],
		});
		notify?.();
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(fontsRevision()).toBe("abc");
		stop();
		expect(disconnect).toHaveBeenCalledTimes(1);
	} finally {
		if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
		else Reflect.deleteProperty(globalThis, "document");
		if (previousObserver) Object.defineProperty(globalThis, "MutationObserver", previousObserver);
		else Reflect.deleteProperty(globalThis, "MutationObserver");
	}
});
