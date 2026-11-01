import { describe, expect, test } from "bun:test";
import { MATCH_TIER, type MatchField, matchFields, parseMatchTerms } from "./match";

const title = (text: string): MatchField[] => [{ key: "title", text }];

function tierOf(query: string, fields: MatchField[]) {
	return matchFields(parseMatchTerms(query), fields)?.tier ?? null;
}

describe("parseMatchTerms", () => {
	test("splits on whitespace and keeps quoted phrases as literal terms", () => {
		expect(parseMatchTerms('  fix "auth flow"  x "nwd" ')).toEqual([
			{ text: "fix", literal: false },
			{ text: "auth flow", literal: true },
			{ text: "x", literal: false },
			{ text: "nwd", literal: true },
		]);
	});

	test("an unterminated quote opens a phrase to the end, so a phrase matches while it is typed", () => {
		expect(parseMatchTerms('fix "auth fl')).toEqual([
			{ text: "fix", literal: false },
			{ text: "auth fl", literal: true },
		]);
		expect(parseMatchTerms('"')).toEqual([]);
		expect(tierOf('"auth fl', title("Auth flow"))).toBe(MATCH_TIER.prefix);
	});

	test("drops empty quotes and caps term length", () => {
		expect(parseMatchTerms('"" a')).toEqual([{ text: "a", literal: false }]);
		expect(parseMatchTerms("a".repeat(150))[0]?.text.length).toBe(100);
	});
});

describe("matchFields tiers", () => {
	test("orders exact > prefix > word > substring > fuzzy", () => {
		expect(tierOf("auth", title("Auth"))).toBe(MATCH_TIER.exact);
		expect(tierOf("auth", title("Auth flow follow-ups"))).toBe(MATCH_TIER.prefix);
		expect(tierOf("auth", title("Fix Auth Refresh"))).toBe(MATCH_TIER.word);
		expect(tierOf("uth", title("Fix Auth Refresh"))).toBe(MATCH_TIER.substring);
		expect(tierOf("fxrf", title("Fix Refresh"))).toBe(MATCH_TIER.fuzzy);
	});

	test("treats camelCase humps and digits as word starts", () => {
		expect(tierOf("hotkeys", title("useGlobalHotkeys.ts"))).toBe(MATCH_TIER.word);
		expect(tierOf("2", title("v2"))).toBe(MATCH_TIER.word);
	});

	test("matches acronyms of word starts", () => {
		const result = matchFields(parseMatchTerms("nwd"), title("NewWorkspaceDialog.tsx"));
		expect(result?.tier).toBe(MATCH_TIER.word);
		expect(result?.fields[0]?.ranges).toEqual([
			[0, 1],
			[3, 4],
			[12, 13],
		]);
	});

	test("rejects short or scattered subsequences", () => {
		expect(tierOf("po", title("Toggle theme"))).toBeNull();
		expect(tierOf("tme", title("Toggle the whole tiny theme"))).toBe(MATCH_TIER.fuzzy);
		expect(tierOf("abc", title(`a${"x".repeat(20)}b${"x".repeat(20)}c`))).toBeNull();
	});

	test("is case-insensitive and Unicode-aware", () => {
		expect(tierOf("поиск", title("Глобальный Поиск"))).toBe(MATCH_TIER.word);
		expect(tierOf("ПОИСК", title("поиск"))).toBe(MATCH_TIER.exact);
	});

	test("folds case without moving highlight offsets, final sigma included", () => {
		const dotted = matchFields(parseMatchTerms("store"), title("\u0130temStore"));
		expect(dotted?.tier).toBe(MATCH_TIER.word);
		expect(dotted?.fields[0]?.ranges).toEqual([[4, 9]]);
		expect(tierOf("\u0130tem", title("item"))).toBe(MATCH_TIER.exact);
		expect(tierOf("\u03a3", title("\u039f\u03a3"))).toBe(MATCH_TIER.substring);
		expect(tierOf("\u03bf\u03c3", title("\u039f\u03a3"))).toBe(MATCH_TIER.exact);
	});

	test("Latin accents fold to their base letter; other scripts keep their marks", () => {
		expect(tierOf("configuracion", title("Configuración"))).toBe(MATCH_TIER.exact);
		expect(tierOf("configuración", title("Configuracion avanzada"))).toBe(MATCH_TIER.prefix);
		const accented = matchFields(parseMatchTerms("cion"), title("Configuración"));
		expect(accented?.fields[0]?.ranges).toEqual([[9, 13]]);
		expect(tierOf("uber", title("Über uns"))).toBe(MATCH_TIER.prefix);
		expect(tierOf("и", title("й"))).toBeNull();
		expect(tierOf("か", title("が"))).toBeNull();
	});

	test("decomposed accents fold too, and a highlight spans the marks it covers", () => {
		const nfd = "Configuración".normalize("NFD");
		const exact = matchFields(parseMatchTerms("configuracion"), title(nfd));
		expect(exact?.tier).toBe(MATCH_TIER.exact);
		expect(exact?.fields[0]?.ranges).toEqual([[0, nfd.length]]);
		const literal = matchFields(parseMatchTerms('"cion"'), title(nfd));
		expect(literal?.tier).toBe(MATCH_TIER.substring);
		expect(literal?.fields[0]?.ranges).toEqual([[9, nfd.length]]);
		expect(tierOf("e\u0301cole", title("École"))).toBe(MATCH_TIER.exact);
		expect(tierOf("ecole", title("E\u0301cole"))).toBe(MATCH_TIER.exact);
	});

	test("a combining mark is part of its word, never a word boundary", () => {
		expect(tierOf("cole", title("E\u0301cole"))).toBe(MATCH_TIER.substring);
		expect(tierOf("\u0e2a\u0e14\u0e35", title("\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35"))).toBe(
			MATCH_TIER.substring,
		);
		expect(
			tierOf(
				"\u091c\u0947\u0915\u094d\u091f",
				title("\u092a\u094d\u0930\u094b\u091c\u0947\u0915\u094d\u091f"),
			),
		).toBe(MATCH_TIER.substring);
	});

	test("a quoted single word is a contiguous literal: no acronym or subsequence", () => {
		expect(tierOf("nwd", title("NewWorkspaceDialog.tsx"))).toBe(MATCH_TIER.word);
		expect(tierOf('"nwd"', title("NewWorkspaceDialog.tsx"))).toBeNull();
		expect(tierOf("abc", title("a_b_c"))).toBe(MATCH_TIER.word);
		expect(tierOf('"abc"', title("a_b_c"))).toBeNull();
		expect(tierOf('"tme"', title("Toggle the whole tiny theme"))).toBeNull();
		expect(tierOf('"work"', title("New workspace"))).toBe(MATCH_TIER.word);
	});
});

describe("matchFields fields", () => {
	test("every term must match, and the worst term decides the tier", () => {
		const fields = title("Fix auth token refresh");
		expect(tierOf("fix auth", fields)).toBe(MATCH_TIER.word);
		expect(tierOf("fix nope", fields)).toBeNull();
		expect(tierOf('"auth token"', fields)).toBe(MATCH_TIER.word);
		expect(tierOf('"token auth"', fields)).toBeNull();
	});

	test("secondary fields never rank above substring", () => {
		const fields: MatchField[] = [
			{ key: "title", text: "Fix Auth Refresh" },
			{ key: "branch", text: "fix-auth-refresh", secondary: true },
		];
		expect(tierOf("fix-auth", fields)).toBe(MATCH_TIER.substring);
		const result = matchFields(parseMatchTerms("fix-auth"), fields);
		expect(result?.fields.map((field) => field.key)).toEqual(["branch"]);
	});

	test("paths match the basename first, then the directory as secondary", () => {
		const fields: MatchField[] = [
			{ key: "path", text: "packages/server/src/auth/refresh.ts", path: true },
		];
		const base = matchFields(parseMatchTerms("refresh"), fields);
		expect(base?.tier).toBe(MATCH_TIER.prefix);
		expect(base?.fields[0]?.ranges).toEqual([[25, 32]]);
		expect(tierOf("server", fields)).toBe(MATCH_TIER.substring);
		expect(tierOf("auth/ref", fields)).toBe(MATCH_TIER.word);
	});

	test("at the same tier the visible field wins over a longer secondary copy", () => {
		const prompt = "Please refactor the authentication module so that tokens refresh quietly";
		const fields: MatchField[] = [
			{ key: "title", text: "Please refactor the authentication module so\u2026" },
			{ key: "keywords", text: prompt, secondary: true },
		];
		for (const query of ["factor", "thentic", "odule"]) {
			const result = matchFields(parseMatchTerms(query), fields);
			expect(result?.tier).toBe(MATCH_TIER.substring);
			expect(result?.fields.map((field) => field.key)).toEqual(["title"]);
		}
		const pastTheCut = matchFields(parseMatchTerms("quietly"), fields);
		expect(pastTheCut?.fields.map((field) => field.key)).toEqual(["keywords"]);
	});

	test("merges overlapping ranges per field", () => {
		const result = matchFields(parseMatchTerms("auth au"), title("auth"));
		expect(result?.fields[0]?.ranges).toEqual([[0, 4]]);
	});

	test("an empty query matches with no ranges", () => {
		expect(matchFields([], title("anything"))).toEqual({
			tier: MATCH_TIER.exact,
			score: 0,
			fields: [],
		});
	});
});

describe("match ordering", () => {
	test("a lower tier ranks first, and within a tier a tighter match scores higher", () => {
		const auth = parseMatchTerms("auth");
		const shortName = matchFields(auth, title("auth.ts"));
		const longName = matchFields(auth, title("authentication-helpers.ts"));
		const word = matchFields(auth, title("fix auth"));
		if (!shortName || !longName || !word) throw new Error("expected matches");
		expect(shortName.tier).toBe(MATCH_TIER.prefix);
		expect(longName.tier).toBe(MATCH_TIER.prefix);
		expect(shortName.score).toBeGreaterThan(longName.score);
		expect(word.tier).toBe(MATCH_TIER.word);
	});
});
