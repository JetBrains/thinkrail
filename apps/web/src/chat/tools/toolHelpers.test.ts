import { expect, test } from "bun:test";
import {
	editDiffText,
	languageFromPath,
	numArg,
	projectRelativePath,
	resultText,
	strArg,
} from "./toolHelpers";

test("editDiffText reads pi's edits[] array (old/new nested), joining multiple entries", () => {
	expect(editDiffText({ path: "f", edits: [{ oldText: "a", newText: "b" }] })).toEqual({
		oldText: "a",
		newText: "b",
	});
	expect(
		editDiffText({
			path: "f",
			edits: [
				{ oldText: "a1", newText: "b1" },
				{ oldText: "a2", newText: "b2" },
			],
		}),
	).toEqual({ oldText: "a1\na2", newText: "b1\nb2" });
});

test("editDiffText falls back to legacy top-level oldText/newText (and old_string variants)", () => {
	expect(editDiffText({ oldText: "x", newText: "y" })).toEqual({ oldText: "x", newText: "y" });
	expect(editDiffText({ old_string: "x", new_string: "y" })).toEqual({
		oldText: "x",
		newText: "y",
	});
	expect(editDiffText({ path: "f" })).toEqual({ oldText: "", newText: "" });
});

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

test("projectRelativePath keeps already-relative paths", () => {
	expect(projectRelativePath("apps/web/src/App.tsx", "/repo")).toBe("apps/web/src/App.tsx");
	expect(projectRelativePath("./apps/web/src/App.tsx", "/repo")).toBe("apps/web/src/App.tsx");
	expect(projectRelativePath("")).toBe("");
});

test("projectRelativePath strips a matching workspace root from absolute paths", () => {
	expect(projectRelativePath("/repo/apps/web/src/App.tsx", "/repo")).toBe("apps/web/src/App.tsx");
	expect(projectRelativePath("/repo/apps/web/src/App.tsx", "/repo/")).toBe("apps/web/src/App.tsx");
	expect(projectRelativePath("C:\\repo\\apps\\web\\src\\App.tsx", "C:\\repo")).toBe(
		"apps/web/src/App.tsx",
	);
});

test("projectRelativePath leaves unmatched absolute paths intact", () => {
	expect(projectRelativePath("/other/App.tsx", "/repo")).toBe("/other/App.tsx");
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
