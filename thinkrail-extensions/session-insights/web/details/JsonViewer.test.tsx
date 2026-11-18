import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonViewer } from "./JsonViewer";
import {
	childPath,
	containsQuery,
	countMatches,
	cutIndex,
	cutPath,
	highlightParts,
	parseEmbedded,
} from "./json";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const text = (markup: string) => markup.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"');

describe("JSON helpers", () => {
	test("paths read like JavaScript for copying and like the core for cut lookup", () => {
		expect(childPath("", "edits")).toBe("edits");
		expect(childPath("edits", 0)).toBe("edits[0]");
		expect(childPath("edits[0]", "oldText")).toBe("edits[0].oldText");
		expect(childPath("a", "odd key")).toBe('a["odd key"]');
		expect(cutPath("edits[0]", "odd key")).toBe("edits[0].odd key");
		expect(
			cutIndex([
				["$", 9],
				["a.b", 3],
			]),
		).toEqual(
			new Map([
				["", 9],
				["a.b", 3],
			]),
		);
	});

	test("parses only strings that hold an object or array", () => {
		expect(parseEmbedded(' {"a":1} ')).toEqual({ a: 1 });
		expect(parseEmbedded("[1,2]")).toEqual([1, 2]);
		expect(parseEmbedded("42")).toBeUndefined();
		expect(parseEmbedded("{not json")).toBeUndefined();
	});

	test("counts case-insensitive matches in keys and scalars, never array indices", () => {
		const value = { Command: "run TESTS", list: ["tests", 1, null], nested: { tests: true } };
		expect(countMatches(value, "test")).toBe(3);
		expect(countMatches(value, "command")).toBe(1);
		expect(countMatches(value, "0")).toBe(0);
		expect(containsQuery(value, "null")).toBe(true);
		expect(containsQuery(value, "")).toBe(false);
	});

	test("splits text around matches with stable offsets", () => {
		expect(highlightParts("Retry retries", "retr")).toEqual([
			{ text: "Retr", match: true, at: 0 },
			{ text: "y ", match: false, at: 4 },
			{ text: "retr", match: true, at: 6 },
			{ text: "ies", match: false, at: 10 },
		]);
		expect(highlightParts("abc", "")).toEqual([{ text: "abc", match: false, at: 0 }]);
	});
});

describe("JsonViewer", () => {
	test("opens two levels with counts on deeper nodes and colours scalars by type", () => {
		const markup = html(
			<JsonViewer
				label="Arguments"
				value={{
					command: "ls",
					timeout: 120,
					force: false,
					missing: null,
					deep: { a: { b: [1, 2, 3] } },
				}}
			/>,
		);
		const plain = text(markup);
		expect(plain).toContain('command: "ls"');
		expect(markup).toContain("text-series-5");
		expect(markup).toContain("text-series-1");
		expect(markup).toContain("text-series-3");
		expect(plain).toContain("1 key");
		expect(plain).not.toContain("3 items");
	});

	test("marks cut strings with their original size and highlights matches", () => {
		const markup = html(
			<JsonViewer
				label="Input"
				value={{ edits: [{ oldText: "abc" }] }}
				cuts={[["edits[0].oldText", 9000]]}
				query="old"
			/>,
		);
		expect(markup).toContain('data-testid="json-cut"');
		expect(text(markup)).toContain("cut · originally 9,000");
		expect(markup).toContain("<mark");
		expect(markup).toContain('data-testid="json-matches"');
		expect(text(markup)).toContain("1 match");
	});

	test("shows multi-line strings as preformatted blocks, embedded JSON with a parse toggle, long ones cut", () => {
		const long = "x".repeat(5000);
		const markup = html(
			<JsonViewer
				label="Result"
				value={{ output: "line one\nline two", payload: '{"ok":true,"items":[1]}', long }}
			/>,
		);
		const plain = text(markup);
		expect(plain).toContain("string · 2 lines · 17 chars");
		expect(markup).toMatch(/<pre[^>]*tr-code-text-small[^>]*>[^<]*<span>line one\nline two/);
		expect(markup).toContain('aria-pressed="false"');
		expect(plain).toContain("Show all (5,000 chars)");
	});
});
