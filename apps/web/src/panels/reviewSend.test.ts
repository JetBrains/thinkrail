import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { ReviewSendResult, ReviewSnapshot } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import * as wireTransport from "../transport/wireTransport";
import { sendReviewBatch, sendReviewComment } from "./reviewSend";

const initial = useAppStore.getState();
const requests: { method: string; params: unknown }[] = [];
let results: ReviewSendResult[];
let restore: () => void = () => {};

beforeEach(() => {
	useAppStore.setState(initial, true);
	requests.length = 0;
	results = [{ sessionId: "review-b", model: null, thinkingLevel: "medium", reused: true }];
	const store = useAppStore.getState();
	store.openChatSession("workspace", "review-b", null, "medium");
	store.openChatSession("workspace", "unrelated-a", null, "medium");
	const snapshot: ReviewSnapshot = {
		review: {
			id: "review",
			workspaceId: "workspace",
			status: "open",
			baseSha: "base",
			createdAt: 0,
			fileSessions: { "b.ts": "review-b" },
		},
		comments: [],
	};
	useAppStore.setState({ reviewsByWorkspace: { workspace: snapshot } });
	const transport = {
		request: async (method: string, params: unknown) => {
			requests.push({ method, params });
			return method === "review.sendBatch" ? { sessions: results } : results[0];
		},
	} as unknown as ReturnType<typeof wireTransport.getTransport>;
	const spy = spyOn(wireTransport, "getTransport").mockReturnValue(transport);
	restore = () => spy.mockRestore();
});

afterEach(() => {
	restore();
	useAppStore.setState(initial, true);
});

test("sending a file comment does not override its pinned review chat with an unrelated open chat", async () => {
	await sendReviewComment("workspace", "comment-b");
	expect(requests).toEqual([
		{ method: "review.sendComment", params: { workspaceId: "workspace", id: "comment-b" } },
	]);
});

test("a file batch leaves the destination to the host when no chat context is supplied", async () => {
	await sendReviewBatch("workspace", ["comment-b"]);
	expect(requests).toEqual([
		{
			method: "review.sendBatch",
			params: { workspaceId: "workspace", commentIds: ["comment-b"] },
		},
	]);
});

test("Send all preserves per-file routing and opens every returned review chat", async () => {
	results.push({ sessionId: "review-c", model: null, thinkingLevel: "medium", reused: false });
	await sendReviewBatch("workspace");
	expect(requests).toEqual([{ method: "review.sendBatch", params: { workspaceId: "workspace" } }]);
	expect(
		useAppStore
			.getState()
			.tabsByWorkspace.workspace?.map((tab) => tab.kind === "chat" && tab.sessionId),
	).toContain("review-c");
});

test("a comment from a chat card still explicitly targets that card's chat", async () => {
	await sendReviewComment("workspace", "comment-b", "review-b");
	expect(requests).toEqual([
		{
			method: "review.sendComment",
			params: { workspaceId: "workspace", id: "comment-b", sessionId: "review-b" },
		},
	]);
});

test("a multi-file chat card still sends one batch to its explicit chat", async () => {
	await sendReviewBatch("workspace", ["comment-b", "comment-c"], "review-b");
	expect(requests).toEqual([
		{
			method: "review.sendBatch",
			params: {
				workspaceId: "workspace",
				commentIds: ["comment-b", "comment-c"],
				sessionId: "review-b",
			},
		},
	]);
});
