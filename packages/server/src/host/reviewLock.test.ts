import { expect, test } from "bun:test";
import { withReviewLock } from "./reviewLock";

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (v: T) => void;
	reject: (e: Error) => void;
} {
	let resolve!: (v: T) => void;
	let reject!: (e: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

test("a second send for the same workspace waits for the first to finish", async () => {
	const first = deferred<string>();
	const order: string[] = [];

	const a = withReviewLock("ws1", async () => {
		order.push("a:start");
		const value = await first.promise;
		order.push("a:end");
		return value;
	});
	const b = withReviewLock("ws1", async () => {
		order.push("b:start");
		return "b";
	});

	await Promise.resolve();
	expect(order).toEqual(["a:start"]);

	first.resolve("a");
	expect(await a).toBe("a");
	expect(await b).toBe("b");
	expect(order).toEqual(["a:start", "a:end", "b:start"]);
});

test("a MUTATION issued mid-send lands after the send's mark, never inside its await", async () => {
	const creating = deferred<void>();
	const log: string[] = [];

	const send = withReviewLock("ws-mut", async () => {
		log.push("read-drafts");
		await creating.promise;
		log.push("mark-sent");
		return "sent";
	});
	const close = withReviewLock("ws-mut", async () => {
		log.push("close");
		return "closed";
	});

	await Promise.resolve();
	expect(log).toEqual(["read-drafts"]);

	creating.resolve();
	expect(await send).toBe("sent");
	expect(await close).toBe("closed");
	expect(log).toEqual(["read-drafts", "mark-sent", "close"]);
});

test("different workspaces don't wait on each other", async () => {
	const parked = deferred<string>();
	const slow = withReviewLock("ws1", () => parked.promise);
	const fast = await withReviewLock("ws2", async () => "fast");
	expect(fast).toBe("fast");
	parked.resolve("slow");
	expect(await slow).toBe("slow");
});

test("a failed operation rejects to its own caller and still releases the queue", async () => {
	const failing = withReviewLock("ws1", async () => {
		throw new Error("no drafts");
	});
	await expect(failing).rejects.toThrow("no drafts");
	expect(await withReviewLock("ws1", async () => "next")).toBe("next");
});
