import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as engine from "./index.ts";

const SRC = import.meta.dir;
const shipped = readdirSync(SRC)
	.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
	.map((name) => ({ name, source: readFileSync(join(SRC, name), "utf8") }));
const ROOT = join(SRC, "..");
/** The pi extension entry the manifest names, beside the engine's sources. */
const entries = readdirSync(ROOT)
	.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
	.map((name) => ({ name, source: readFileSync(join(ROOT, name), "utf8") }));
const ENTRY_IMPORTS = /^(?:\.\/src\/[\w.]+\.ts|@earendil-works\/pi-coding-agent)$/;

const IMPORT = /^\s*(?:import|export)\s[^;]*?\bfrom\s+["']([^"']+)["']/gm;
const ALLOWED_IMPORTS =
	/^(?:\.\/[\w.]+\.ts|node:(?:fs\/promises|path|crypto|os|buffer)|@earendil-works\/pi-coding-agent)$/;

describe("the shipped sources stay portable", () => {
	test.each(shipped)(
		"$name uses no Bun-only API, ThinkRail path or network module",
		({ source }) => {
			expect(source).not.toMatch(/\bBun\.|["']bun:/);
			expect(source).not.toMatch(/\.thinkrail|@thinkrail\//);
			expect(source).not.toMatch(/\bfetch\(|node:(?:http|https|net|dgram|tls)/);
			expect(source).not.toMatch(/SessionManager\.(?:list|listAll)\b/);
			for (const [, specifier] of source.matchAll(IMPORT))
				expect(specifier).toMatch(ALLOWED_IMPORTS);
		},
	);

	test.each(entries)(
		"the extension entry $name uses no Bun-only API, ThinkRail path or network module",
		({ source }) => {
			expect(source).not.toMatch(/\bBun\.|["']bun:/);
			expect(source).not.toMatch(/\.thinkrail|@thinkrail\//);
			expect(source).not.toMatch(/\bfetch\(|node:(?:http|https|net|dgram|tls)/);
			for (const [, specifier] of source.matchAll(IMPORT)) expect(specifier).toMatch(ENTRY_IMPORTS);
		},
	);

	test("the manifest's extension entry is the shipped extension.ts", () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
		expect(entries.map(({ name }) => name)).toEqual(["extension.ts"]);
		expect(manifest.pi.extensions).toEqual(["./extension.ts"]);
		expect(manifest.files).toContain("extension.ts");
	});

	test("the ./core contract has no imports at all", () => {
		const core = shipped.find(({ name }) => name === "core.ts")?.source ?? "";
		expect(core).not.toMatch(/^\s*import\b|\bimport\(|\brequire\(/m);
		expect(core).not.toMatch(/^\s*export\s[^;]*\bfrom\b/m);
	});

	test("the engine root exposes the documented surface", () => {
		expect(Object.keys(engine).sort()).toEqual(
			[
				"ACTIVITY_TICKS",
				"CHILD_EVENT_PREFIX",
				"ERROR_DETAIL_QUERY",
				"EXCERPT_CHARS",
				"RETRY_SHARED_WORDS",
				"RETRY_WINDOW_CALLS",
				"SESSION_ANALYSIS_QUERY",
				"SESSION_SUBAGENTS_QUERY",
				"SUBAGENT_GET_QUERY",
				"SubagentActivityCache",
				"buildErrorDetail",
				"buildSessionAnalysis",
				"buildSessionSubagents",
				"buildSubagentDetail",
				"childActivity",
				"childTranscriptsOf",
				"parseErrorDetailParams",
				"parseSubagentParams",
				"wordDiff",
				"COST_MOMENTS",
				"CONTEXT_CATEGORIES",
				"FILE_DETAIL_QUERY",
				"REQUEST_DIFF_QUERY",
				"REWORK_CHANGES",
				"SESSION_CONTEXT_QUERY",
				"SESSION_COST_QUERY",
				"SESSION_FILES_QUERY",
				"buildContextView",
				"buildFileDetail",
				"buildRequestDiff",
				"buildSessionCost",
				"buildSessionFiles",
				"parseFileDetailParams",
				"parseRequestDiffParams",
				"BADGED_ORIGINS",
				"CACHE_TTL_MS",
				"DAY_TICK_MS",
				"DAY_TIMELINE_QUERY",
				"DayRowCache",
				"EVENT_ANCHOR_QUERY",
				"EVENT_GET_QUERY",
				"FIRST_PROMPT_CHARS",
				"METRIC_SOURCES",
				"PARSER_VERSION",
				"SESSIONS_LIST_QUERY",
				"SESSION_INSIGHTS_API_VERSION",
				"SESSION_SUMMARY_QUERY",
				"SESSION_TIMELINE_QUERY",
				"SESSION_TRACE_QUERY",
				"SessionIndex",
				"TRACE_GAP_MIN_MS",
				"TRACE_LABEL_CHARS",
				"TRACE_PAGE_EVENTS",
				"TRACE_SEARCH_MAX_IDS",
				"TRACE_SEARCH_QUERY",
				"TIMELINE_SUBAGENT_TRACKS",
				"TIMELINE_TOOL_TRACKS",
				"TraceStore",
				"buildDayTimeline",
				"buildSessionSummary",
				"buildSessionTimeline",
				"buildSessionsList",
				"createRedactor",
				"defaultSessionsRoot",
				"fileSummaryCache",
				"listSessionFiles",
				"localDay",
				"parseDayTimelineParams",
				"parseEventParams",
				"parseSearchParams",
				"parseSessionParams",
				"parseSessionsListParams",
				"parseTraceParams",
				"recordedTotals",
				"subagentJoinOf",
				"summarizeSessionText",
				"tracePage",
				"vanillaChildTranscriptDirs",
				"DigestStore",
				"FINDINGS_HIDE_QUERY",
				"FINDINGS_LIST_QUERY",
				"FINDING_RULES",
				"HOTSPOT_FILES",
				"HOTSPOT_RULES",
				"JsonStore",
				"KNOWN_EXIT_CODES",
				"SPARK_POINTS",
				"STATS_HOTSPOTS_QUERY",
				"STATS_USAGE_QUERY",
				"USAGE_CHART_SERIES",
				"USAGE_COMMANDS",
				"buildFindingsList",
				"buildStatsHotspots",
				"buildStatsUsage",
				"digestInStages",
				"digestOf",
				"parseFindingsHideParams",
				"parseHotspotsParams",
				"parseStatsParams",
				"setFindingHidden",
				"ACTIVITIES",
				"ALIGN_RULES",
				"COMPARE_RULES",
				"SEQUENCE_RULES",
				"SESSIONS_ALIGN_QUERY",
				"SLICES_COMPARE_QUERY",
				"STATS_SEQUENCES_QUERY",
				"AlignmentCache",
				"buildSessionsAlign",
				"buildSlicesCompare",
				"buildStatsSequences",
				"parseAlignParams",
				"parseCompareParams",
				"parseSequencesParams",
				"SEARCH_FILTER_KEYS",
				"SEARCH_RULES",
				"SESSIONS_SEARCH_QUERY",
				"SearchJobs",
				"parseSearchQuery",
				"parseSessionsSearchParams",
				"EXPORT_FIXTURE_QUERY",
				"EXPORT_HTML_QUERY",
				"EXPORT_RULES",
				"EXPORT_TRACE_QUERY",
				"LABELS_GET_QUERY",
				"LABELS_SET_QUERY",
				"LABEL_RULES",
				"chromeTraceOutput",
				"exportBaseName",
				"exportFailure",
				"exportTitle",
				"fixtureOutput",
				"labelLookup",
				"labelsView",
				"parseExportFixtureParams",
				"parseExportParams",
				"parseLabelsGetParams",
				"parseLabelsSetParams",
				"readLabels",
				"receiptForTurn",
				"renderSessionHtml",
				"setSessionLabels",
				"writeExport",
				"OVERVIEW_RULES",
				"SESSION_OVERVIEW_QUERY",
				"buildSessionOverview",
				"BACKGROUND_COMPLETION_MESSAGE",
				"FAILED_RUN_STATUSES",
				"SUBAGENT_COMPLETION_MESSAGE",
				"SUBAGENT_RESULT_TOOL",
				"SUBAGENT_SPAWN_TOOL",
				"SUBAGENT_TOOLS",
				"SUBAGENT_USAGE_KIND",
				"TODO_STATUSES",
				"TODO_TEXT_GROUP",
				"TODO_TEXT_ITEM",
				"TODO_TOOLS",
				"UNFINISHED_RUN_STATUSES",
				"WAKE_DELIVERY",
			].sort(),
		);
	});
});
