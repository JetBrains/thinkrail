import { expect, mock, test } from "bun:test";
import { onThemeSwap } from "./theme";

test("onThemeSwap observes only the completed root theme signal and returns cleanup", () => {
	const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
	const root = {};
	const observe = mock((_target: unknown, _options: MutationObserverInit) => {});
	const disconnect = mock(() => {});
	const onSwap = mock(() => {});
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
		const stop = onThemeSwap(onSwap);
		expect(observe).toHaveBeenCalledTimes(1);
		expect(observe).toHaveBeenCalledWith(root, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		expect(onSwap).not.toHaveBeenCalled();
		expect(notify).toBe(onSwap);
		notify?.();
		expect(onSwap).toHaveBeenCalledTimes(1);
		expect(disconnect).not.toHaveBeenCalled();
		stop();
		expect(disconnect).toHaveBeenCalledTimes(1);
	} finally {
		if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
		else Reflect.deleteProperty(globalThis, "document");
		if (previousObserver) Object.defineProperty(globalThis, "MutationObserver", previousObserver);
		else Reflect.deleteProperty(globalThis, "MutationObserver");
	}
});
