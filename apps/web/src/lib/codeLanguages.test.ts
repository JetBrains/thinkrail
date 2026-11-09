import { expect, test } from "bun:test";
import { isSupportedLanguage } from "@pierre/highlights";
import { CODE_LANGUAGES, codeLanguageId } from "./codeLanguages";

test("the Monaco language registration list has no duplicate ids", () => {
	const ids = CODE_LANGUAGES.map((language) => language.id);
	expect(new Set(ids).size).toBe(ids.length);
});

test("Scala is recognized for chat fences and Scala files", () => {
	const scala = CODE_LANGUAGES.find((language) => language.id === "scala");
	expect(scala?.extensions).toContain(".scala");
	expect(codeLanguageId("Scala")).toBe("scala");
});

test("every Monaco language id has a Pierre lexer", () => {
	for (const { id } of CODE_LANGUAGES) expect(isSupportedLanguage(id), id).toBe(true);
});
