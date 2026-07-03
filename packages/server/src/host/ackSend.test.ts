import { expect, test } from "bun:test";
import { ackSend } from "./ackSend";

test("a rejection inside the window rethrows (the client must see a refused send)", async () => {
	await expect(ackSend(Promise.reject(new Error("no API key")), 50)).rejects.toThrow("no API key");
});

test("a resolution inside the window acks immediately", async () => {
	const start = Date.now();
	await ackSend(Promise.resolve(), 5_000);
	expect(Date.now() - start).toBeLessThan(1_000); // did not sit out the window
});

test("a still-running turn is acked at the window; its later rejection is swallowed", async () => {
	let rejectRun: (err: Error) => void = () => {};
	const run = new Promise<void>((_, reject) => {
		rejectRun = reject;
	});
	await ackSend(run, 20); // resolves at the window — the turn is simply still going
	rejectRun(new Error("late turn fault")); // must NOT become an unhandled rejection
	await new Promise((r) => setTimeout(r, 10));
});
