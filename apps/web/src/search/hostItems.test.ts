import { describe, expect, test } from "bun:test";
import {
	MATCH_TIER,
	parseMatchTerms,
	type SearchGroup,
	type SearchHit,
} from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { hostItems } from "./hostItems";
import { EMPTY_LEARNING } from "./learning";
import { rankItems } from "./rank";

const base = { tier: MATCH_TIER.prefix, score: 1, projectId: "p1", workspaceId: "w1" } as const;

const file: SearchHit = {
	...base,
	id: "file:p1:w1:src/auth/refresh.ts",
	kind: "file",
	title: "refresh.ts",
	subtitle: "src/auth",
	path: "src/auth/refresh.ts",
	ranges: {
		path: [
			[4, 8],
			[9, 16],
		],
	},
};
const plan: SearchHit = {
	...base,
	id: "plan:w1:remote:t1",
	kind: "plan",
	title: "Refresh the token",
	subtitle: "Auth plan",
	sessionId: "remote",
};
const transcript: SearchHit = {
	...base,
	id: "transcript:remote:3",
	kind: "transcript",
	title: "…the refresh now retries…",
	subtitle: "Only the host knows",
	tier: MATCH_TIER.content,
	score: 0,
	sessionId: "remote",
	messageIndex: 3,
	anchorText: "the refresh now retries",
	ranges: { title: [[4, 11]] },
};

const groups: SearchGroup[] = [
	{ kind: "file", state: "ready", total: 1, hits: [file] },
	{ kind: "plan", state: "ready", total: 1, hits: [plan] },
	{ kind: "transcript", state: "ready", total: 1, hits: [transcript] },
];

function items(late: Record<string, number> = {}, staleQuery: string | null = null) {
	const opened: SearchHit[] = [];
	const result = hostItems(
		{
			t: currentTranslator(),
			openHit: (opened_) => opened.push(opened_),
			projectName: () => "One",
			workspaceName: () => "Auth refresh",
			late: new Map(Object.entries(late)),
			staleTerms: staleQuery === null ? null : parseMatchTerms(staleQuery),
		},
		groups,
	);
	return { result, opened };
}

const rank = (result: ReturnType<typeof items>["result"], query: string) =>
	rankItems(result, parseMatchTerms(query), EMPTY_LEARNING, query, 0);
const section: SearchHit = {
	...base,
	id: "section:w1:agent/SPEC.md:Session titles#1",
	kind: "section",
	title: "agent",
	subtitle: "agent/SPEC.md",
	snippet: "renameSession validates one title",
	tier: MATCH_TIER.content,
	score: 3.2,
	path: "agent/SPEC.md",
	specId: "module-agent",
	ranges: { title: [], heading: [[8, 14]], snippet: [[0, 13]] },
	section: { heading: "Session titles", line: 876, matched: 2, terms: 3 },
};

const sectionGroup: SearchGroup = { kind: "section", state: "ready", total: 1, hits: [section] };

function sectionItems(staleQuery: string | null = null) {
	const opened: SearchHit[] = [];
	const result = hostItems(
		{
			t: currentTranslator(),
			openHit: (target) => opened.push(target),
			projectName: () => "One",
			workspaceName: () => "Auth refresh",
			late: new Map(),
			staleTerms: staleQuery === null ? null : parseMatchTerms(staleQuery),
		},
		[sectionGroup],
	);
	return { result, opened };
}

describe("hostItems", () => {
	test("maps a section hit to a Sections row titled by its spec and heading, with the snippet beneath", () => {
		const { result, opened } = sectionItems();
		const [row] = result;
		expect(result).toHaveLength(1);
		expect(row).toMatchObject({
			kind: "section",
			title: "agent › Session titles",
			subtitle: "renameSession validates one title",
			titleLead: "agent › ".length,
			badge: "2/3 words",
			group: "sections",
			scope: "specs",
			file: { workspaceId: "w1", path: "agent/SPEC.md", line: 876 },
		});
		const titleRanges = row?.match?.ranges.title ?? [];
		expect(titleRanges.map(([start, end]) => row?.title.slice(start, end))).toEqual(["titles"]);
		expect(row?.match?.ranges.subtitle).toEqual([[0, 13]]);
		row?.run?.();
		expect(opened).toEqual([section]);
	});

	test("a section row an earlier query answered stays only while its spec, heading and snippet show every term, folded", () => {
		const [kept] = sectionItems("session rename").result;
		expect(kept?.match).toMatchObject({ tier: MATCH_TIER.content, score: 0 });
		expect(kept?.match?.ranges.subtitle).toEqual([[0, 13]]);
		expect(sectionItems("SESSIÓN renamé").result).toHaveLength(1);
		expect(sectionItems("session banana").result).toEqual([]);
	});

	test("maps a file hit with its path highlight split between name and folder, and names the file to render", () => {
		const { result, opened } = items();
		const file = result.find((item) => item.kind === "file");
		expect(file).toMatchObject({
			title: "refresh.ts",
			subtitle: "One › Auth refresh · src/auth",
			scope: "files",
			group: "files",
			file: { workspaceId: "w1", path: "src/auth/refresh.ts" },
		});
		expect(file?.previewTarget).toBeUndefined();
		expect(file?.match?.ranges.title).toEqual([[0, 7]]);
		const prefix = "One › Auth refresh · ".length;
		expect(file?.match?.ranges.subtitle).toEqual([[prefix + 4, prefix + 8]]);
		file?.run?.();
		expect(opened[0]?.id).toBe("file:p1:w1:src/auth/refresh.ts");
	});

	test("maps every hit to one row and flags late arrivals", () => {
		const { result } = items({ "transcript:remote:3": 1 });
		expect(result.map((item) => item.id)).toEqual([
			"file:p1:w1:src/auth/refresh.ts",
			"plan:w1:remote:t1",
			"transcript:remote:3",
		]);
		expect(result.find((item) => item.kind === "plan")).toMatchObject({
			subtitle: "Auth plan · One › Auth refresh",
			group: "plans",
		});
		expect(result.find((item) => item.kind === "transcript")).toMatchObject({
			late: 1,
			subtitle: "Only the host knows · One › Auth refresh",
			previewTarget: { kind: "chat", sessionId: "remote", messageIndex: 3 },
		});
	});

	test("ranking trusts the host's match and sorts late rows after every row that was already there", () => {
		const { result } = items({ "plan:w1:remote:t1": 1 });
		const extra = {
			...(result.find((item) => item.id === "plan:w1:remote:t1") as object),
			id: "plan:w1:remote:t2",
			late: 0,
		};
		const ranked = rank([...result, extra as (typeof result)[number]], "refresh");
		expect(ranked.map((entry) => entry.item.id)).toEqual([
			"file:p1:w1:src/auth/refresh.ts",
			"plan:w1:remote:t2",
			"transcript:remote:3",
			"plan:w1:remote:t1",
		]);
		expect(ranked[0]?.match.fields).toEqual([
			{ key: "title", ranges: [[0, 7]] },
			{ key: "subtitle", ranges: [[25, 29]] },
		]);
	});

	test("a later arrival cohort sorts after an earlier one, whatever its tier", () => {
		const { result } = items({ "file:p1:w1:src/auth/refresh.ts": 2, "transcript:remote:3": 1 });
		expect(rank(result, "refresh").map((entry) => entry.item.id)).toEqual([
			"plan:w1:remote:t1",
			"transcript:remote:3",
			"file:p1:w1:src/auth/refresh.ts",
		]);
	});

	test("rows an earlier query answered are matched again the way the host matches them", () => {
		expect(items({}, "billing").result).toEqual([]);
		const file = items({}, "refresh.t").result;
		expect(file.map((item) => item.id)).toEqual(["file:p1:w1:src/auth/refresh.ts"]);
		expect(file[0]?.match?.ranges.title).toEqual([[0, 9]]);
		const transcript = items({}, "retries").result.find((item) => item.kind === "transcript");
		expect(transcript?.match).toMatchObject({ tier: MATCH_TIER.content, score: 0 });
		expect(items({}, "refresh banana").result.some((item) => item.kind === "transcript")).toBe(
			false,
		);
		expect(items({}, "refresh nr").result.some((item) => item.kind === "transcript")).toBe(false);
		for (const query of ["refresh ref", "refresh refresh"]) {
			expect(
				items({}, query).result.find((item) => item.kind === "transcript")?.match?.ranges.title,
			).toEqual([[5, 12]]);
		}
		expect(
			items({}, "now refresh").result.find((item) => item.kind === "transcript")?.match,
		).toEqual({
			tier: MATCH_TIER.content,
			score: 0,
			ranges: {
				title: [
					[5, 12],
					[13, 16],
				],
			},
		});
	});
});
