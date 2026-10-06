import { expect, test } from "bun:test";
import { createSectionContentCache, type SectionContent } from "./sectionContentCache";

const fresh = { original: "a", modified: "b", meta: undefined, originalOid: null };

test("one in-flight read is shared by every section that asks while it is pending", async () => {
	const cache = createSectionContentCache();
	let reads = 0;
	let release: (() => void) | undefined;
	const read = () => {
		reads++;
		return new Promise<typeof fresh>((resolve) => {
			release = () => resolve(fresh);
		});
	};
	const first = cache.load("src/a.ts", read, 3, "main");
	const second = cache.load("src/a.ts", read, 4, "main");
	expect(reads).toBe(1);
	release?.();
	const [content, shared]: SectionContent[] = await Promise.all([first, second]);
	expect(shared).toBe(content);
	expect(content).toEqual({ ...fresh, loadedTick: 3, loadedTarget: "main" });
	expect(cache.get("src/a.ts")).toBe(content);
	const third = cache.load("src/a.ts", read, 5, "main");
	expect(reads).toBe(2);
	release?.();
	expect((await third).loadedTick).toBe(5);
});

test("a result lands in the cache even when no section is left to receive it", async () => {
	const cache = createSectionContentCache();
	const promise = cache.load("src/b.ts", () => Promise.resolve(fresh), 1, "main");
	await promise;
	expect(cache.get("src/b.ts")?.loadedTick).toBe(1);
});

test("a failed read leaves nothing behind so the next attempt reads again", async () => {
	const cache = createSectionContentCache();
	let reads = 0;
	const read = () => {
		reads++;
		return Promise.reject(new Error("boom"));
	};
	await expect(cache.load("src/c.ts", read, 1, "main")).rejects.toThrow("boom");
	expect(cache.get("src/c.ts")).toBeUndefined();
	await expect(cache.load("src/c.ts", read, 1, "main")).rejects.toThrow("boom");
	expect(reads).toBe(2);
});
