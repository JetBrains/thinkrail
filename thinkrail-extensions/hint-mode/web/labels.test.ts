import { describe, expect, it } from "bun:test";
import { HINT_ALPHABET, hintLabels, letterOfCode } from "./labels";

describe("hint labels", () => {
	it("uses single home-row letters first, in alphabet order", () => {
		expect(hintLabels(0)).toEqual([]);
		expect(hintLabels(1)).toEqual(["a"]);
		expect(hintLabels(3)).toEqual(["a", "s", "d"]);
		expect(hintLabels(HINT_ALPHABET.length)).toEqual([...HINT_ALPHABET]);
	});

	it("gives up a single letter as a prefix only when two letters are needed", () => {
		const labels = hintLabels(HINT_ALPHABET.length + 1);
		expect(labels).not.toContain("a");
		expect(labels.slice(0, 3)).toEqual(["s", "d", "f"]);
		expect(labels.slice(-2)).toEqual(["aa", "as"]);
	});

	it("is prefix-free, unique and shortest first for any count", () => {
		for (const count of [2, 19, 20, 37, 100, 361, 400]) {
			const labels = hintLabels(count);
			expect(labels).toHaveLength(count);
			expect(new Set(labels).size).toBe(count);
			for (const label of labels) {
				expect(labels.filter((other) => other !== label && other.startsWith(label))).toEqual([]);
			}
			const lengths = labels.map((label) => label.length);
			expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
		}
	});
});

describe("letterOfCode", () => {
	it("reads the physical key, so any layout types the same label", () => {
		expect(letterOfCode("KeyF")).toBe("f");
		expect(letterOfCode("KeyJ")).toBe("j");
		expect(letterOfCode("KeyZ")).toBeNull();
		expect(letterOfCode("Digit1")).toBeNull();
		expect(letterOfCode("Semicolon")).toBeNull();
	});
});
