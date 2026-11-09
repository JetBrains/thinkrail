import { expect, test } from "bun:test";
import { randomUuid } from "./ids";

test("randomUuid is a v4 UUID built without crypto.randomUUID", () => {
	const original = crypto.randomUUID;
	Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
	try {
		const ids = new Set(Array.from({ length: 50 }, () => randomUuid()));
		expect(ids.size).toBe(50);
		for (const id of ids) {
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		}
	} finally {
		Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
	}
});
