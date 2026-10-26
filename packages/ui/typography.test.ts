import { expect, mock, test } from "bun:test";
import { onFontChange } from "./typography";

test("font changes observe only the completed signal and unsubscribe on cleanup", () => {
	const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
	const root = {};
	const observe = mock((_target: unknown, _options: MutationObserverInit) => {});
	const disconnect = mock(() => {});
	const callback = mock(() => {});
	let notify: (() => void) | undefined;
	class Observer {
		constructor(listener: () => void) {
			notify = listener;
		}
		observe = observe;
		disconnect = disconnect;
	}
	try {
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { documentElement: root },
		});
		Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: Observer });
		const stop = onFontChange(callback);
		expect(observe).toHaveBeenCalledWith(root, {
			attributes: true,
			attributeFilter: ["data-fonts"],
		});
		expect(callback).not.toHaveBeenCalled();
		notify?.();
		expect(callback).toHaveBeenCalledTimes(1);
		stop();
		expect(disconnect).toHaveBeenCalledTimes(1);
	} finally {
		if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
		else Reflect.deleteProperty(globalThis, "document");
		if (previousObserver) Object.defineProperty(globalThis, "MutationObserver", previousObserver);
		else Reflect.deleteProperty(globalThis, "MutationObserver");
	}
});
