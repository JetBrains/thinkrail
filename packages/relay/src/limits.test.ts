import { expect, test } from "bun:test";
import { createConnectionLimiter, createKeyedRateLimiter, createRateLimiter } from "./limits";

test("the connection limiter caps open connections per address and frees slots on release", () => {
	const limiter = createConnectionLimiter(2);
	expect(limiter.acquire("a")).toBe(true);
	expect(limiter.acquire("a")).toBe(true);
	expect(limiter.acquire("a")).toBe(false);
	expect(limiter.acquire("b")).toBe(true);
	limiter.release("a");
	expect(limiter.acquire("a")).toBe(true);
});

test("the rate limiter allows a burst, then refills at its rate", () => {
	const limiter = createRateLimiter(10, 3);
	const start = Date.now();
	expect([limiter.take(start), limiter.take(start), limiter.take(start)]).toEqual([
		true,
		true,
		true,
	]);
	expect(limiter.take(start)).toBe(false);
	expect(limiter.take(start + 100)).toBe(true);
	expect(limiter.take(start + 100)).toBe(false);
});

test("the keyed rate limiter keeps one bucket per key and stays bounded", () => {
	const limiter = createKeyedRateLimiter(1, 1, 2);
	expect([limiter.take("a", 0), limiter.take("a", 0), limiter.take("b", 0)]).toEqual([
		true,
		false,
		true,
	]);
	expect(limiter.take("c", 0)).toBe(true);
	expect(limiter.take("a", 0)).toBe(true);
});
