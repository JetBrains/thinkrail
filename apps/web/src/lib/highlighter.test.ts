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

test("a Scala chat fence renders with Shiki tokens", async () => {
	const highlight = createChatHighlighter(createJavaScriptRegexEngine);
	const html = await highlight('object Greeting { val message: String = "hello" }', "scala");
	expect(html).not.toBeNull();
	expect(html).toContain("<span");
});

test("every catalog language renders a chat fence with Shiki tokens", async () => {
	const highlight = createChatHighlighter(() => createOnigurumaEngine(import("shiki/wasm")));
	for (const language of SHIKI_FILE_LANGUAGES) {
		const html = await highlight("value = 1", language.id);
		expect(html, language.id).toContain('<span style="color:var(--code-');
	}
});

test("every Monaco language id is supplied by its Shiki grammar", async () => {
	const modules = await Promise.all(SHIKI_FILE_LANGUAGES.map((language) => language.load()));
	for (const [index, language] of SHIKI_FILE_LANGUAGES.entries()) {
		expect(
			modules[index]?.default.some((registration) => registration.name === language.id),
			language.id,
		).toBe(true);
	}
});
