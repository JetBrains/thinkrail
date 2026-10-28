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

const hit = (
	overrides: Partial<SearchHit> & Pick<SearchHit, "id" | "kind" | "title">,
): SearchHit => ({
	tier: MATCH_TIER.prefix,
	score: 1,
	projectId: "p1",
	...overrides,
});

const groups: SearchGroup[] = [
	{
		kind: "file",
		state: "ready",
		total: 1,
		hits: [
			hit({
				id: "file:p1:w1:src/auth/refresh.ts",
				kind: "file",
				title: "refresh.ts",
				subtitle: "src/auth",
				path: "src/auth/refresh.ts",
				workspaceId: "w1",
				ranges: {
					path: [
						[4, 8],
						[9, 16],
					],
				},
			}),
		],
	},
	{
		kind: "chat",
		state: "ready",
		total: 2,
		hits: [
			hit({
				id: "chat:local",
				kind: "chat",
				title: "Known locally",
				sessionId: "local",
				workspaceId: "w1",
			}),
			hit({
				id: "chat:remote",
				kind: "chat",
				title: "Only the host knows",
				sessionId: "remote",
				workspaceId: "w1",
			}),
		],
	},
	{
		kind: "transcript",
		state: "ready",
		total: 1,
		hits: [
			hit({
				id: "transcript:remote:3",
				kind: "transcript",
				title: "…the refresh now retries…",
				subtitle: "Only the host knows",
				tier: MATCH_TIER.content,
				score: 0,
				sessionId: "remote",
				workspaceId: "w1",
				messageIndex: 3,
				anchorText: "the refresh now retries",
				ranges: { title: [[4, 11]] },
			}),
		],
	},
];

function items(late: Record<string, number> = {}, staleQuery: string | null = null) {
	const opened: SearchHit[] = [];
	const result = hostItems(
		{
			t: currentTranslator(),
			openHit: (opened_) => opened.push(opened_),
			projectName: () => "One",
			workspaceName: () => "Auth refresh",
			localIds: new Set(["chat:local"]),
			late: new Map(Object.entries(late)),
			staleTerms: staleQuery === null ? null : parseMatchTerms(staleQuery),
		},
		groups,
	);
	return { result, opened };
}

const rank = (result: ReturnType<typeof items>["result"], query: string) =>
	rankItems(result, parseMatchTerms(query), EMPTY_LEARNING, query, 0);

describe("hostItems", () => {
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

	test("drops host chats the client already lists, keeps the rest, and flags late arrivals", () => {
		const { result } = items({ "transcript:remote:3": 1 });
		expect(result.map((item) => item.id)).toEqual([
			"file:p1:w1:src/auth/refresh.ts",
			"chat:remote",
			"transcript:remote:3",
		]);
		expect(result.find((item) => item.kind === "transcript")).toMatchObject({
			late: 1,
			subtitle: "Only the host knows · One › Auth refresh",
			previewTarget: { kind: "chat", sessionId: "remote", messageIndex: 3 },
		});
	});

	test("ranking trusts the host's match and sorts late rows after every row that was already there", () => {
		const { result } = items({ "chat:remote": 1 });
		const extra = {
			...(result.find((item) => item.id === "chat:remote") as object),
			id: "chat:other",
			late: 0,
		};
		const ranked = rank([...result, extra as (typeof result)[number]], "refresh");
		expect(ranked.map((entry) => entry.item.id)).toEqual([
			"file:p1:w1:src/auth/refresh.ts",
			"chat:other",
			"transcript:remote:3",
			"chat:remote",
		]);
		expect(ranked[0]?.match.fields).toEqual([
			{ key: "title", ranges: [[0, 7]] },
			{ key: "subtitle", ranges: [[25, 29]] },
		]);
	});

	test("a later arrival cohort sorts after an earlier one, whatever its tier", () => {
		const { result } = items({ "file:p1:w1:src/auth/refresh.ts": 2, "transcript:remote:3": 1 });
		expect(rank(result, "refresh").map((entry) => entry.item.id)).toEqual([
			"chat:remote",
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
