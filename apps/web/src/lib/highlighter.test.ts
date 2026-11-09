import { expect, test } from "bun:test";
import { isSupportedLanguage } from "@pierre/highlights";
import { SHIKI_FILE_LANGUAGES, shikiLanguageId } from "./highlighter";

test("the Monaco Shiki language registration list has no duplicate ids", () => {
	const ids = SHIKI_FILE_LANGUAGES.map((language) => language.id);
	expect(new Set(ids).size).toBe(ids.length);
});

test("Scala is recognized for chat fences and Scala files", () => {
	const scala = SHIKI_FILE_LANGUAGES.find((language) => language.id === "scala");
	expect(scala?.extensions).toContain(".scala");
	expect(shikiLanguageId("Scala")).toBe("scala");
});

test("every Monaco language id has a Pierre lexer", () => {
	for (const { id } of SHIKI_FILE_LANGUAGES) expect(isSupportedLanguage(id), id).toBe(true);
});
