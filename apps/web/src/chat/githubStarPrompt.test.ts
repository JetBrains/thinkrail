import { expect, test } from "bun:test";
import { countSentPrompt, formatStarCount } from "./githubStarPrompt";

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
		removeItem: (key: string) => void values.delete(key),
	};
}

test("asks on the tenth prompt and never again", () => {
	const storage = memoryStorage();
	const asks = Array.from({ length: 13 }, () => countSentPrompt(() => storage));
	expect(asks.flatMap((ask, index) => (ask ? [index + 1] : []))).toEqual([10]);
});

test("a saved count carries over, and garbage counts as zero", () => {
	const saved = memoryStorage({ "thinkrail-github-star-prompt-count": "9" });
	expect(countSentPrompt(() => saved)).toBe(true);
	const garbage = memoryStorage({ "thinkrail-github-star-prompt-count": "oops" });
	expect(countSentPrompt(() => garbage)).toBe(false);
	expect(garbage.getItem("thinkrail-github-star-prompt-count")).toBe("1");
});

test("never asks when storage is missing or throws", () => {
	expect(countSentPrompt(() => null)).toBe(false);
	const broken = {
		...memoryStorage(),
		setItem: () => {
			throw new Error("quota");
		},
	};
	expect(countSentPrompt(() => broken)).toBe(false);
});

test("star counts read like the website's", () => {
	expect(formatStarCount(999)).toBe("999");
	expect(formatStarCount(1234)).toBe("1.2k");
});
