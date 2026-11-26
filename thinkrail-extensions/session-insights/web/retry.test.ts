import { afterEach, describe, expect, jest, test } from "bun:test";
import { BACKOFF_MS, retryWithBackoff } from "./retry";

interface FakeDocument {
	hidden: boolean;
	listeners: Set<() => void>;
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
}

function fakeDocument(): FakeDocument {
	const listeners = new Set<() => void>();
	return {
		hidden: false,
		listeners,
		addEventListener: (_, listener) => listeners.add(listener),
		removeEventListener: (_, listener) => listeners.delete(listener),
	};
}

afterEach(() => {
	jest.useRealTimers();
	Reflect.deleteProperty(globalThis, "document");
});

describe("retry with backoff", () => {
	test("asks again after 1 s, 2 s, then every 5 s, and stop cancels the waiting ask", () => {
		jest.useFakeTimers();
		let asks = 0;
		const retry = retryWithBackoff(() => {
			asks += 1;
		});
		const steps = [...BACKOFF_MS, 5000];
		for (const [at, wait] of steps.entries()) {
			retry.again();
			jest.advanceTimersByTime(wait - 1);
			expect(asks).toBe(at);
			jest.advanceTimersByTime(1);
			expect(asks).toBe(at + 1);
		}
		retry.again();
		retry.stop();
		jest.advanceTimersByTime(60_000);
		expect(asks).toBe(steps.length);
	});

	test("an ask due in a hidden tab waits for the tab's return", () => {
		jest.useFakeTimers();
		const document = fakeDocument();
		Object.defineProperty(globalThis, "document", { value: document, configurable: true });
		let asks = 0;
		const retry = retryWithBackoff(() => {
			asks += 1;
		});
		document.hidden = true;
		retry.again();
		jest.advanceTimersByTime(10_000);
		expect(asks).toBe(0);
		document.hidden = false;
		for (const listener of document.listeners) listener();
		expect(asks).toBe(1);
		for (const listener of document.listeners) listener();
		expect(asks).toBe(1);
		retry.stop();
		expect(document.listeners.size).toBe(0);
	});
});
