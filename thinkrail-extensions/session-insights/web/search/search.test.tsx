import { describe, expect, test } from "bun:test";
import type {
	ParsedSearch,
	SearchHit,
	SearchVocabulary,
	SessionRef,
	SessionsSearchResult,
} from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VersionSkew } from "../session/api";
import {
	ALL_FILTER_KEYS,
	applySuggestion,
	FILTER_KEYS,
	filterText,
	hasFilter,
	removeFilter,
	suggestionsFor,
	toggleFilter,
	tokenAt,
} from "./query";
import { SearchBox } from "./SearchBox";
import { rowTarget, SearchView } from "./SearchView";
import { initialSearch, type SearchControls, type SearchState, searchReducer } from "./useSearch";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const noop = () => {};
const ALL = { kind: "all" } as const;

const VOCABULARY: SearchVocabulary = {
	tool: [
		{ value: "bash", count: 12 },
		{ value: "read", count: 4 },
	],
	model: [
		{ value: "anthropic/claude-opus", count: 30 },
		{ value: "openai/gpt-5.6-sol", count: 8 },
	],
	skill: [{ value: "writing-specs", count: 5 }],
	file: [{ value: "src/my parser.ts", count: 2 }],
	error: [{ value: "bash: error: <path> Unexpected any", count: 3 }],
	project: [{ value: "Alpha", count: 40 }],
	label: [{ value: "good", count: 12 }],
	complete: true,
};

function parsed(overrides: Partial<ParsedSearch> = {}): ParsedSearch {
	return { terms: [], filters: [], unknown: [], ignored: [], ...overrides };
}

const SESSION: SessionRef = {
	sessionId: "s1",
	title: "Make the linter happy",
	firstPrompt: null,
	start: Date.parse("2026-11-01T10:00:00Z"),
	projectId: "p1",
	workspaceId: "w1",
	workspaceState: "open",
};

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
	return {
		eventId: "tool:e1:0",
		kind: "tool",
		turn: 2,
		t: Date.parse("2026-11-01T10:05:00Z"),
		tool: "bash",
		model: "anthropic/claude-opus",
		skill: null,
		error: true,
		label: "bun run lint",
		snippet: {
			field: "args",
			text: "bun run lint",
			marks: [[8, 12]],
			head: false,
			tail: false,
		},
		fields: [
			{ field: "args", count: 1 },
			{ field: "result", count: 3 },
		],
		errorLine: "src/parser.ts:3:1 error Unexpected any",
		...overrides,
	};
}

function answer(overrides: Partial<SessionsSearchResult> = {}): SessionsSearchResult {
	return {
		apiVersion: 11,
		seq: 1,
		status: "done",
		state: { phase: "ready", indexed: 1, total: 1 },
		digests: { ready: 1, total: 1, stale: 0 },
		query: parsed({
			terms: [{ text: "lint", quoted: false, span: { start: 20, end: 24 } }],
			filters: [
				{ key: "tool", value: "bash", span: { start: 0, end: 9 } },
				{ key: "error", value: "yes", span: { start: 10, end: 19 } },
			],
		}),
		projects: [{ id: "p1", name: "Alpha", kind: "repository" }],
		sessions: [SESSION],
		groups: [{ session: 0, matches: 7, shown: 5, events: [hit()], more: "1:m:0:5" }],
		total: { events: 7, sessions: 1, exact: true },
		scanned: { sessions: 1, total: 1 },
		facets: {
			tool: { values: [{ value: "bash", count: 7 }], others: 0 },
			model: { values: [{ value: "anthropic/claude-opus", count: 7 }], others: 0 },
			skill: { values: [{ value: "", count: 7 }], others: 0 },
			project: { values: [{ value: "Alpha", count: 7 }], others: 0 },
			error: { yes: 7, no: 0 },
		},
		vocabulary: null,
		next: null,
		...overrides,
	};
}

describe("the query helpers", () => {
	test("tokenAt finds the token under the caret, a quoted value kept whole", () => {
		expect(tokenAt("lint model:cla", 14)).toEqual({
			span: { start: 5, end: 14 },
			text: "model:cla",
			key: "model",
			value: "cla",
		});
		expect(tokenAt('file:"my par', 12)).toMatchObject({ key: "file", value: "my par" });
		expect(tokenAt("lint mo", 7)).toMatchObject({ key: null, text: "mo" });
		expect(tokenAt("lint ", 5)).toMatchObject({ key: null, text: "", span: { start: 5, end: 5 } });
		expect(tokenAt("project:Al", 10, FILTER_KEYS)).toMatchObject({ key: null });
	});

	test("suggestions offer the scope's values for the filter being typed, keys for a bare prefix", () => {
		expect(suggestionsFor(tokenAt("model:", 6), VOCABULARY, ALL_FILTER_KEYS)).toEqual([
			{ kind: "value", key: "model", value: "anthropic/claude-opus", count: 30 },
			{ kind: "value", key: "model", value: "openai/gpt-5.6-sol", count: 8 },
		]);
		expect(
			suggestionsFor(tokenAt("model:gpt", 9), VOCABULARY, ALL_FILTER_KEYS).map((s) =>
				s.kind === "value" ? s.value : s.key,
			),
		).toEqual(["openai/gpt-5.6-sol"]);
		expect(
			suggestionsFor(tokenAt("error:", 6), VOCABULARY, ALL_FILTER_KEYS).map((s) =>
				s.kind === "value" ? [s.value, s.count] : s.key,
			),
		).toEqual([
			["yes", null],
			["no", null],
			["bash: error: <path> Unexpected any", 3],
		]);
		expect(suggestionsFor(tokenAt("mo", 2), VOCABULARY, ALL_FILTER_KEYS)).toEqual([
			{ kind: "key", key: "model" },
		]);
		expect(suggestionsFor(tokenAt("pro", 3), VOCABULARY, FILTER_KEYS)).toEqual([]);
		expect(suggestionsFor(tokenAt("lint", 4), VOCABULARY, ALL_FILTER_KEYS)).toEqual([]);
		expect(suggestionsFor(tokenAt("model:", 6), null, ALL_FILTER_KEYS)).toEqual([]);
	});

	test("taking a suggestion writes the filter, quoted when needed, and moves the caret past it", () => {
		const token = tokenAt("lint file:pa", 12);
		expect(
			applySuggestion("lint file:pa", token, {
				kind: "value",
				key: "file",
				value: "src/my parser.ts",
				count: 2,
			}),
		).toEqual({ text: 'lint file:"src/my parser.ts" ', caret: 29 });
		expect(
			applySuggestion("mo lint", tokenAt("mo lint", 2), { kind: "key", key: "model" }),
		).toEqual({ text: "model: lint", caret: 6 });
		expect(filterText("error", 'a "b" \\c')).toBe('error:"a \\"b\\" \\\\c"');
		expect(filterText("tool", "bash")).toBe("tool:bash");
	});

	test("a facet toggles its filter in the query text", () => {
		const query = "tool:bash lint";
		const reading = parsed({
			filters: [{ key: "tool", value: "bash", span: { start: 0, end: 9 } }],
		});
		expect(toggleFilter(query, reading, "tool", "bash")).toBe("lint");
		expect(toggleFilter(query, reading, "model", "anthropic/claude-opus")).toBe(
			"tool:bash lint model:anthropic/claude-opus",
		);
		expect(toggleFilter("", null, "skill", "")).toBe("skill:none");
		const tool = { key: "tool", value: "bash", span: { start: 5, end: 14 } } as const;
		expect(removeFilter("lint tool:bash error:yes", tool)).toBe("lint error:yes");
		expect(removeFilter("lint, tool:bash", tool)).toBe("lint, tool:bash");
		expect(
			hasFilter(
				parsed({ filters: [{ key: "skill", value: "NONE", span: { start: 0, end: 10 } }] }),
				"skill",
				"",
			),
		).toEqual({ start: 0, end: 10 });
	});

	test("arrows move through the results, up from the first and Escape go back to the field", () => {
		expect(rowTarget("ArrowDown", 0, 3)).toBe(1);
		expect(rowTarget("ArrowDown", 2, 3)).toBe(2);
		expect(rowTarget("ArrowUp", 2, 3)).toBe(1);
		expect(rowTarget("ArrowUp", 0, 3)).toBe("input");
		expect(rowTarget("Home", 2, 3)).toBe(0);
		expect(rowTarget("End", 0, 3)).toBe(2);
		expect(rowTarget("Escape", 1, 3)).toBe("input");
		expect(rowTarget("a", 1, 3)).toBeNull();
	});
});

describe("the search job's client side", () => {
	const started = searchReducer(initialSearch(ALL), { type: "query", query: "lint", scope: ALL });

	test("a query starts a new seq asking for the vocabulary; answers that ran out of time are followed", () => {
		expect(started).toMatchObject({ seq: 1, phase: "loading" });
		expect(started.pending).toEqual({
			seq: 1,
			query: "lint",
			scope: ALL,
			cursor: null,
			facets: true,
			group: null,
		});
		const request = started.pending;
		if (!request) throw new Error("expected a request");
		const scanning = searchReducer(started, {
			type: "answer",
			request,
			result: answer({
				status: "scanning",
				next: "1:1",
				total: { events: 7, sessions: 1, exact: false },
				vocabulary: VOCABULARY,
			}),
		});
		expect(scanning.phase).toBe("scanning");
		expect(scanning.pending).toMatchObject({ seq: 1, cursor: "1:1", facets: false });
		expect(scanning.vocabulary).toBe(VOCABULARY);
		expect(scanning.groups).toHaveLength(1);
		const next = scanning.pending;
		if (!next) throw new Error("expected a continuation");
		const done = searchReducer(scanning, {
			type: "answer",
			request: next,
			result: answer({ groups: [], sessions: [], status: "more", next: "1:2" }),
		});
		expect(done).toMatchObject({ phase: "more", next: "1:2", pending: null });
		expect(done.vocabulary).toBe(VOCABULARY);
		const more = searchReducer(done, { type: "next" });
		expect(more.pending).toMatchObject({ cursor: "1:2", group: null });
	});

	test("stopping lets the answer in flight land, then waits; continuing asks with its cursor", () => {
		const request = started.pending;
		if (!request) throw new Error("expected a request");
		const stopping = searchReducer(started, { type: "stop" });
		expect(stopping.pending).toBe(request);
		const stopped = searchReducer(stopping, {
			type: "answer",
			request,
			result: answer({ status: "scanning", next: "1:1" }),
		});
		expect(stopped).toMatchObject({ phase: "cancelled", pending: null, next: "1:1" });
		expect(searchReducer(stopped, { type: "resume" }).pending).toMatchObject({ cursor: "1:1" });
	});

	test("a session's more appends its events to the group", () => {
		const request = started.pending;
		if (!request) throw new Error("expected a request");
		const shown = searchReducer(started, { type: "answer", request, result: answer() });
		const asking = searchReducer(shown, { type: "more", sessionId: "s1" });
		expect(asking.pending).toMatchObject({ cursor: "1:m:0:5", group: "s1" });
		expect(asking.loadingMore).toEqual(["s1"]);
		const group = asking.pending;
		if (!group) throw new Error("expected the group's request");
		const grown = searchReducer(asking, {
			type: "answer",
			request: group,
			result: answer({
				groups: [
					{ session: 0, matches: 7, shown: 7, events: [hit({ eventId: "tool:e9:0" })], more: null },
				],
			}),
		});
		expect(grown.groups[0]?.events.map((event) => event.eventId)).toEqual([
			"tool:e1:0",
			"tool:e9:0",
		]);
		expect(grown.groups[0]?.more).toBeNull();
		expect(grown.pending).toBeNull();
		expect(grown.loadingMore).toEqual([]);
	});

	test("old answers are ignored, an expired cursor restarts and failures say why", () => {
		const request = started.pending;
		if (!request) throw new Error("expected a request");
		const newer = searchReducer(started, { type: "query", query: "lint error:yes", scope: ALL });
		expect(searchReducer(newer, { type: "answer", request, result: answer() })).toBe(newer);
		const own = newer.pending;
		if (!own) throw new Error("expected a request");
		expect(
			searchReducer(newer, {
				type: "answer",
				request: own,
				result: answer({ status: "superseded" }),
			}),
		).toBe(newer);
		const restarted = searchReducer(newer, {
			type: "answer",
			request: own,
			result: answer({ seq: 2, status: "expired" }),
		});
		expect(restarted).toMatchObject({ seq: 3, query: "lint error:yes", phase: "loading" });
		expect(
			searchReducer(newer, { type: "failed", request: own, error: new VersionSkew() }).phase,
		).toBe("version");
		expect(
			searchReducer(newer, {
				type: "failed",
				request: own,
				error: Object.assign(new Error("off"), { code: "EXTENSION_DISABLED" }),
			}),
		).toMatchObject({ phase: "error", failure: "disabled" });
		const empty = searchReducer(newer, { type: "query", query: "  ", scope: ALL });
		expect(empty.phase).toBe("idle");
		expect(empty.pending?.facets).toBe(true);
	});
});

function controls(state: SearchState): SearchControls {
	return { state, stop: noop, resume: noop, loadMore: noop, showMore: noop, retry: noop };
}

function view(state: SearchState, text = "tool:bash error:yes lint"): string {
	return html(
		<SearchView
			controls={controls(state)}
			text={text}
			onText={noop}
			keys={ALL_FILTER_KEYS}
			scopeAll
			now={Date.parse("2026-11-16T10:00:00Z")}
			onOpen={noop}
			onToInput={noop}
			onFilterKey={noop}
			resultsRef={{ current: null }}
		/>,
	);
}

function answered(result: SessionsSearchResult): SearchState {
	const started = searchReducer(initialSearch(ALL), {
		type: "query",
		query: "tool:bash error:yes lint",
		scope: ALL,
	});
	const request = started.pending;
	if (!request) throw new Error("expected a request");
	return searchReducer(started, { type: "answer", request, result });
}

describe("the search view", () => {
	test("shows the parsed filters, facet counts and events grouped by session with highlights", () => {
		const markup = view(answered(answer()));
		expect(markup).toContain(
			'data-testid="insights-search-chip" data-key="tool" data-value="bash"',
		);
		expect(markup).toContain(
			'data-testid="insights-search-chip" data-key="error" data-value="yes"',
		);
		expect(markup).toContain('data-testid="insights-search-term"');
		expect(markup).toContain("7 events · 1 session");
		expect(markup).toContain('data-testid="insights-search-group" data-session-id="s1"');
		expect(markup).toContain("Make the linter happy");
		expect(markup).toContain("7 matches");
		expect(markup).toContain("Show 2 more in this session");
		expect(markup).toContain(
			'data-testid="insights-search-hit" data-event-id="tool:e1:0" data-kind="tool"',
		);
		expect(markup).toMatch(
			/bun run <mark[^>]*data-testid="insights-search-mark"[^>]*>lint<\/mark>/,
		);
		expect(markup).toContain('data-field="result"');
		expect(markup).toContain("in result ×3");
		expect(markup).toContain("src/parser.ts:3:1 error Unexpected any");
		expect(markup).toContain("#2");
		expect(markup).toMatch(
			/data-testid="insights-search-facet-value" data-value="bash"[^>]*><input type="checkbox" class="[^"]*" checked=""/,
		);
		expect(markup).toMatch(
			/data-testid="insights-search-facet-value" data-value="no"[^>]*><input type="checkbox" class="[^"]*"\/>/,
		);
		expect(markup).toContain("(outside a skill)");
		expect(markup).toContain('data-testid="insights-search-facet" data-key="project"');
		expect(markup).toContain('data-testid="insights-search-end"');
	});

	test("counts read as at least while the scan runs, with a stop button", () => {
		const markup = view(
			answered(
				answer({
					status: "scanning",
					next: "1:1",
					total: { events: 53, sessions: 10, exact: false },
					scanned: { sessions: 10, total: 14 },
				}),
			),
		);
		expect(markup).toContain('data-phase="scanning"');
		expect(markup).toContain(
			"Searching… ≥53 events · ≥10 sessions so far · read 10 of 14 sessions",
		);
		expect(markup).toContain('data-testid="insights-search-stop"');
		expect(markup).toMatch(/data-testid="insights-search-facet-count"[^>]*>≥7</);
	});

	test("a full page offers more sessions; the empty, idle and failed states say so", () => {
		expect(view(answered(answer({ status: "more", next: "1:2" })))).toContain(
			'data-testid="insights-search-load-more"',
		);
		expect(
			view(
				answered(
					answer({ groups: [], sessions: [], total: { events: 0, sessions: 0, exact: true } }),
				),
			),
		).toContain("No events match.");
		expect(view(initialSearch(ALL), "")).toContain('data-testid="insights-search-idle"');
		const failing = searchReducer(
			searchReducer(initialSearch(ALL), { type: "query", query: "lint", scope: ALL }),
			{
				type: "failed",
				request: {
					seq: 1,
					query: "lint",
					scope: ALL,
					cursor: null,
					facets: true,
					group: null,
				},
				error: new Error("boom"),
			},
		);
		expect(view(failing)).toContain('data-testid="insights-search-error"');
		expect(
			view(searchReducer(initialSearch(ALL), { type: "query", query: "lint", scope: ALL })),
		).toContain('data-testid="insights-search-loading"');
	});

	test("the field is a combobox that names its suggestions", () => {
		const markup = html(
			<SearchBox
				value="model:"
				onChange={noop}
				onFocus={noop}
				onEscape={noop}
				onToResults={noop}
				vocabulary={VOCABULARY}
				keys={ALL_FILTER_KEYS}
				inputRef={{ current: null }}
			/>,
		);
		expect(markup).toContain('role="combobox"');
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).toContain('aria-autocomplete="list"');
		expect(markup).toContain('data-testid="session-insights-search"');
	});
});
