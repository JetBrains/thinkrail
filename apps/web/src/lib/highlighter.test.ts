import { expect, test } from "bun:test";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { createChatHighlighter, SHIKI_FILE_LANGUAGES, shikiLanguageId } from "./highlighter";

test("the Monaco Shiki language registration list has no duplicate ids", () => {
	const ids = SHIKI_FILE_LANGUAGES.map((language) => language.id);
	expect(new Set(ids).size).toBe(ids.length);
});

test("Scala is recognized for chat fences and Scala files", () => {
	const scala = SHIKI_FILE_LANGUAGES.find((language) => language.id === "scala");
	expect(scala?.extensions).toContain(".scala");
	expect(shikiLanguageId("Scala")).toBe("scala");
});

const tokenColors = (html: string | null) => new Set(html?.match(/color:[^;"]+/g));

test("Java chat fences resolve by id and name", () => {
	expect(shikiLanguageId("java")).toBe("java");
	expect(shikiLanguageId("Java")).toBe("java");
});

const JAVA_FENCE = 'public class Greeting { private String message = "hello"; }';
const ENGINES = {
	"JS regex": createJavaScriptRegexEngine,
	"Oniguruma WASM": () => createOnigurumaEngine(import("shiki/wasm")),
};

for (const [name, engine] of Object.entries(ENGINES)) {
	test(`a Java chat fence renders colored tokens with the ${name} engine`, async () => {
		const html = await createChatHighlighter(engine)(JAVA_FENCE, "java");
		expect(tokenColors(html).size).toBeGreaterThan(1);
	});

	test(`every catalog language highlights a chat fence with the ${name} engine`, async () => {
		const highlight = createChatHighlighter(engine);
		for (const { id } of SHIKI_FILE_LANGUAGES) {
			expect(await highlight('function main() { return "x" + 1; } // note', id), id).toContain(
				"<span",
			);
		}
	}, 30_000);
}

test("every Monaco language id is supplied by its Shiki grammar", async () => {
	const modules = await Promise.all(SHIKI_FILE_LANGUAGES.map((language) => language.load()));
	for (const [index, language] of SHIKI_FILE_LANGUAGES.entries()) {
		expect(
			modules[index]?.default.some((registration) => registration.name === language.id),
			language.id,
		).toBe(true);
	}
});
