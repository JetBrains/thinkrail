import { beforeEach, expect, mock, test } from "bun:test";
import type { TextSearchBatch, WsParams } from "@thinkrail/contracts";
import { TEXT_SEARCH_LIMITS, WS_CHANNELS } from "@thinkrail/contracts";

const requests: WsParams<"search.text">[] = [];
const subscriptions = new Map<string, (data: unknown) => void>();
let answer: (params: WsParams<"search.text">) => Promise<{ seq: number; superseded?: true }> = (
	params,
) => Promise.resolve({ seq: params.seq });

const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (_method: string, params: WsParams<"search.text">) => {
			requests.push(params);
			return answer(params);
		},
		subscribe: (channel: string, handler: (data: unknown) => void) => {
			subscriptions.set(channel, handler);
			return () => subscriptions.delete(channel);
		},
	}),
}));

const { requestKeyOf, runTextSearch, wasRequested } = await import("./runner");
const { resetFindInFilesForTests, useFindInFiles } = await import("./state");

const context = { projectId: "p", workspaceId: "w" };
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	requests.length = 0;
	resetFindInFilesForTests();
	answer = (params) => Promise.resolve({ seq: params.seq });
});

test("a search sends search.text with smart case resolved, a clamped query and a growing seq, and applies its batches", async () => {
	const request = { query: "Needle", caseSensitive: false, wholeWord: true, context };
	runTextSearch(request);
	expect(wasRequested(requestKeyOf(request))).toBe(true);
	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({
		query: "Needle",
		caseSensitive: true,
		wholeWord: true,
		context,
	});
	const first = requests[0]?.seq ?? 0;
	expect(useFindInFiles.getState().searching).toBe(true);

	const push = subscriptions.get(WS_CHANNELS.searchTextResults);
	expect(push).toBeDefined();
	const batch: TextSearchBatch = {
		seq: first,
		root: context,
		files: [
			{
				path: "a.ts",
				matches: [{ line: 3, column: 1, length: 6, text: "Needle", ranges: [[0, 6]] }],
			},
		],
		done: { reason: "complete", files: 1, lines: 1 },
	};
	push?.(batch);
	expect(useFindInFiles.getState().results?.files).toEqual(batch.files);
	expect(useFindInFiles.getState().searching).toBe(false);

	runTextSearch({ ...request, query: "x".repeat(TEXT_SEARCH_LIMITS.maxQuery + 20) });
	expect(requests[1]?.seq).toBeGreaterThan(first);
	expect(requests[1]?.query).toHaveLength(TEXT_SEARCH_LIMITS.maxQuery);
	expect(requests[1]?.caseSensitive).toBe(false);
	await settle();
});

test("a query under the minimum clears the results without asking the host", () => {
	runTextSearch({ query: "needle", caseSensitive: false, wholeWord: false, context });
	subscriptions.get(WS_CHANNELS.searchTextResults)?.({
		seq: requests[0]?.seq,
		files: [{ path: "a.ts", matches: [] }],
	});
	expect(useFindInFiles.getState().results).not.toBeNull();

	runTextSearch({ query: "n", caseSensitive: false, wholeWord: false, context });
	expect(requests).toHaveLength(1);
	expect(useFindInFiles.getState()).toMatchObject({ results: null, searching: false });
});

test("a rejected request fails the search and lets the same request be asked again", async () => {
	answer = () => Promise.reject(new Error("offline"));
	const request = { query: "needle", caseSensitive: false, wholeWord: false, context };
	runTextSearch(request);
	await settle();
	expect(useFindInFiles.getState()).toMatchObject({ searching: false, failed: true });
	expect(wasRequested(requestKeyOf(request))).toBe(false);
});
