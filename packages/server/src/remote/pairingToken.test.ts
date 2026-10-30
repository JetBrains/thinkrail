import { expect, test } from "bun:test";
import { createPairingTokens } from "./pairingToken";

test("issue then consume returns the request once (single-use)", () => {
	const tokens = createPairingTokens();
	const { token } = tokens.issue("project-x", 0);
	const consumed = tokens.consume(token, 10);
	expect(consumed?.projectRef).toBe("project-x");
	expect(tokens.consume(token, 20)).toBeNull();
	expect(tokens.size).toBe(0);
});

test("consume returns null for an unknown or expired token", () => {
	const tokens = createPairingTokens(1000);
	expect(tokens.consume("nope", 0)).toBeNull();
	const { token, expiresAt } = tokens.issue("p", 0);
	expect(expiresAt).toBe(1000);
	expect(tokens.consume(token, 1001)).toBeNull();
});

test("issuing prunes already-expired tokens", () => {
	const tokens = createPairingTokens(1000);
	tokens.issue("stale", 0);
	expect(tokens.size).toBe(1);
	tokens.issue("fresh", 2000);
	expect(tokens.size).toBe(1);
});
