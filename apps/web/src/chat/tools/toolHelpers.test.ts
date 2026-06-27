import { expect, test } from "bun:test";
import { fileName, languageFromPath, numArg, resultText, strArg } from "./toolHelpers";

test("resultText joins the text blocks of an AgentToolResult-shaped value", () => {
	expect(
		resultText({
			content: [
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			],
		}),
	).toBe("ab");
});

test("resultText skips non-text content blocks (e.g. images)", () => {
	expect(
		resultText({
			content: [
				{ type: "text", text: "before" },
				{ type: "image", data: "…", mimeType: "image/png" },
				{ type: "text", text: "after" },
			],
		}),
	).toBe("beforeafter");
});

test("resultText returns '' for null / undefined", () => {
	expect(resultText(null)).toBe("");
	expect(resultText(undefined)).toBe("");
});

test("resultText returns the raw string for a string input", () => {
	expect(resultText("hello")).toBe("hello");
});

test("resultText returns pretty JSON for an object with no content array", () => {
	expect(resultText({ foo: 1 })).toBe(JSON.stringify({ foo: 1 }, null, 2));
});

test("resultText pretty-prints when `content` is present but not an array", () => {
	const value = { content: "not-an-array" };
	expect(resultText(value)).toBe(JSON.stringify(value, null, 2));
});

test("strArg returns the string value, or '' when missing / wrong-typed", () => {
	expect(strArg({ command: "ls" }, "command")).toBe("ls");
	expect(strArg({}, "command")).toBe("");
	expect(strArg({ command: 42 }, "command")).toBe("");
	expect(strArg({ command: null }, "command")).toBe("");
});

test("numArg returns the number value, or null when missing / wrong-typed", () => {
	expect(numArg({ offset: 10 }, "offset")).toBe(10);
	expect(numArg({ offset: 0 }, "offset")).toBe(0);
	expect(numArg({}, "offset")).toBeNull();
	expect(numArg({ offset: "10" }, "offset")).toBeNull();
});

test("fileName returns the last path segment", () => {
	expect(fileName("/a/b/App.tsx")).toBe("App.tsx");
	expect(fileName("App.tsx")).toBe("App.tsx");
	expect(fileName("a/b/")).toBe("b");
	expect(fileName("")).toBe("");
});

test("languageFromPath maps known extensions and falls back to ''", () => {
	expect(languageFromPath("src/App.tsx")).toBe("tsx");
	expect(languageFromPath("index.ts")).toBe("typescript");
	expect(languageFromPath("script.py")).toBe("python");
	expect(languageFromPath("run.sh")).toBe("bash");
	expect(languageFromPath("data.YAML")).toBe("yaml");
	expect(languageFromPath("notes.unknown")).toBe("");
	expect(languageFromPath("Makefile")).toBe("");
});
