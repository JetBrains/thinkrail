import { describe, expect, test } from "bun:test";
import { SEARCH_RULES, type SessionsSearchParams } from "./core.ts";
import { parseSearchQuery, parseSessionsSearchParams } from "./searchQuery.ts";

describe("parseSearchQuery", () => {
	test("words and quoted phrases are free-text terms with their spans", () => {
		const text = 'lint "bun run lint" fails';
		expect(parseSearchQuery(text)).toEqual({
			terms: [
				{ text: "lint", quoted: false, span: { start: 0, end: 4 } },
				{ text: "bun run lint", quoted: true, span: { start: 5, end: 19 } },
				{ text: "fails", quoted: false, span: { start: 20, end: 25 } },
			],
			filters: [],
			unknown: [],
			ignored: [],
		});
	});

	test("filters take any-case keys and quoted values with escapes", () => {
		const text = 'Tool:bash error:"bash: <path> \\"x\\"" file:src/parser.ts';
		const parsed = parseSearchQuery(text);
		expect(parsed.filters).toEqual([
			{ key: "tool", value: "bash", span: { start: 0, end: 9 } },
			{ key: "error", value: 'bash: <path> "x"', span: { start: 10, end: 36 } },
			{ key: "file", value: "src/parser.ts", span: { start: 37, end: 55 } },
		]);
		expect(parsed.terms).toEqual([]);
		expect(text.slice(37, 55)).toBe("file:src/parser.ts");
	});

	test("an unterminated quote runs to the end of the query", () => {
		expect(parseSearchQuery('"bun run').terms).toEqual([
			{ text: "bun run", quoted: true, span: { start: 0, end: 8 } },
		]);
		expect(parseSearchQuery('skill:"writing specs').filters).toEqual([
			{ key: "skill", value: "writing specs", span: { start: 0, end: 20 } },
		]);
	});

	test("an unknown key is searched as text and reported; URLs and odd keys are plain text", () => {
		const parsed = parseSearchQuery("foo:bar https://example.com/x a-b:c");
		expect(parsed.terms.map((term) => term.text)).toEqual([
			"foo:bar",
			"https://example.com/x",
			"a-b:c",
		]);
		expect(parsed.unknown).toEqual([{ key: "foo", span: { start: 0, end: 7 } }]);
		expect(parsed.filters).toEqual([]);
	});

	test("a filter without a value and terms under the minimum are ignored", () => {
		const parsed = parseSearchQuery('model: a "" lint');
		expect(parsed.filters).toEqual([]);
		expect(parsed.terms.map((term) => term.text)).toEqual(["lint"]);
		expect(parsed.ignored).toEqual([
			{ start: 0, end: 6 },
			{ start: 7, end: 8 },
			{ start: 9, end: 11 },
		]);
	});

	test("terms past the maximum are ignored, filters are not", () => {
		const words = Array.from({ length: SEARCH_RULES.maxTerms + 2 }, (_, at) => `w${at}`);
		const parsed = parseSearchQuery(`${words.join(" ")} tool:read`);
		expect(parsed.terms).toHaveLength(SEARCH_RULES.maxTerms);
		expect(parsed.ignored).toHaveLength(2);
		expect(parsed.filters).toHaveLength(1);
	});

	test("any text parses, and the same text parses the same way", () => {
		for (const text of [
			"",
			"   ",
			":",
			"tool:",
			'"',
			'\\"',
			"error:yes error:no",
			"日本語 ошибка",
		]) {
			expect(parseSearchQuery(text)).toEqual(parseSearchQuery(text));
		}
		expect(parseSearchQuery("ошибка Ошибка").terms.map((term) => term.text)).toEqual([
			"ошибка",
			"Ошибка",
		]);
	});
});

describe("parseSessionsSearchParams", () => {
	const base: SessionsSearchParams = {
		scope: { kind: "all" },
		client: "panel-1",
		seq: 3,
		query: "lint",
	};

	test("accepts the scope, client, seq, query and the optional facets and cursor", () => {
		expect(parseSessionsSearchParams(base)).toEqual(base);
		expect(
			parseSessionsSearchParams({
				...base,
				scope: { kind: "project", projectId: "p1" },
				facets: true,
				cursor: "3:1",
			}),
		).toEqual({
			scope: { kind: "project", projectId: "p1" },
			client: "panel-1",
			seq: 3,
			query: "lint",
			facets: true,
			cursor: "3:1",
		});
	});

	test("rejects malformed params", () => {
		for (const bad of [
			null,
			{ ...base, scope: { kind: "elsewhere" } },
			{ ...base, client: "" },
			{ ...base, client: "x".repeat(101) },
			{ ...base, seq: -1 },
			{ ...base, seq: 1.5 },
			{ ...base, query: 3 },
			{ ...base, query: "x".repeat(SEARCH_RULES.queryChars + 1) },
			{ ...base, facets: "yes" },
			{ ...base, cursor: "" },
		])
			expect(() => parseSessionsSearchParams(bad)).toThrow("Invalid search params");
	});
});
