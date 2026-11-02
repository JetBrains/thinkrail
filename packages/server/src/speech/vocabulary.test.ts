import { expect, test } from "bun:test";
import { MAX_PHRASES, speechPhrases } from "./vocabulary";

test("commands come first, then identifier-like file names, then plain names and folders", () => {
	const phrases = speechPhrases({
		commands: ["skill:brainstorming", "review", "ok"],
		paths: [
			"README.md",
			"apps/web/src/store/appStore.ts",
			"packages/server/src/speech/fake_engine.ts",
		],
	});
	expect(phrases.slice(0, 2)).toEqual(["brainstorming", "review"]);
	expect(phrases).toContain("appStore.ts");
	expect(phrases).toContain("appStore");
	expect(phrases).toContain("fake_engine");
	expect(phrases.indexOf("appStore")).toBeLessThan(phrases.indexOf("README.md"));
	expect(phrases.indexOf("README")).toBeLessThan(phrases.indexOf("store"));
	expect(phrases).not.toContain("ok");
	expect(new Set(phrases).size).toBe(phrases.length);
});

test("the list is capped for any repository size", () => {
	const paths = Array.from({ length: 5000 }, (_, i) => `src/module${i}/fileName${i}.ts`);
	const phrases = speechPhrases({ commands: [], paths });
	expect(phrases.length).toBe(MAX_PHRASES);
	expect(phrases[0]).toBe("fileName0.ts");
});

test("phrases with spaces or no letters are skipped", () => {
	expect(
		speechPhrases({ commands: ["two words", "123"], paths: ["My File.txt", "2024/42"] }),
	).toEqual([]);
});
