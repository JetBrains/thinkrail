import { describe, expect, it } from "bun:test";
import { formatPostDate, readingTimeMinutes } from "./postMeta";

describe("formatPostDate", () => {
	it("formats in en-US long form, pinned to UTC", () => {
		expect(formatPostDate(new Date("2026-08-19"))).toBe("August 19, 2026");
	});
});

describe("readingTimeMinutes", () => {
	it("never reports less than a minute", () => {
		expect(readingTimeMinutes("short")).toBe(1);
	});

	it("counts prose but not code blocks or markup", () => {
		const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
		const withNoise = `${words}\n\n\`\`\`ts\n${"code ".repeat(500)}\n\`\`\`\n![alt](./images/x.png)`;
		expect(readingTimeMinutes(withNoise)).toBe(2);
	});
});
