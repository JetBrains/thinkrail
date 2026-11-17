import { expect, test } from "bun:test";
import {
	DEFAULT_PR_BABYSIT_CONFIG,
	type PrBabysitItem,
	type PrBabysitSessionState,
} from "@thinkrail/contracts";
import type { PrSnapshot, PrThreadComment } from "./github";
import {
	applyFindings,
	canTransition,
	checkItemId,
	createPrBabysitStore,
	findingStatus,
	nextQueuedItem,
	sessionStatus,
	syncSnapshotItems,
	threadItemId,
	transitionItem,
} from "./store";

function session(patch: Partial<PrBabysitSessionState> = {}): PrBabysitSessionState {
	return {
		workspaceId: "w",
		owner: "o",
		repo: "r",
		prNumber: 1,
		headRefName: "feat",
		baseRefName: "main",
		active: true,
		status: "watching",
		config: DEFAULT_PR_BABYSIT_CONFIG,
		cycleCount: 0,
		reviewing: false,
		items: [],
		updatedAt: 0,
		viewerLogin: "me",
		...patch,
	};
}

function snapshot(patch: Partial<PrSnapshot> = {}): PrSnapshot {
	return {
		number: 1,
		state: "OPEN",
		baseRefName: "main",
		headRefName: "feat",
		headRefOid: "h1",
		reviewDecision: null,
		threads: [],
		checks: null,
		checkRuns: [],
		...patch,
	};
}

const comment = (databaseId: number, author: string, body = "fix it"): PrThreadComment => ({
	id: `C${databaseId}`,
	databaseId,
	author,
	body,
	createdAt: "",
});

const thread = (comments: PrThreadComment[], isResolved = false) => ({
	id: "T1",
	isResolved,
	isOutdated: false,
	path: "a.ts",
	line: 4,
	comments,
});

test("transitions follow the table", () => {
	expect(canTransition("pending_review_approval", "queued")).toBe(true);
	expect(canTransition("pending_review_approval", "pushed")).toBe(false);
	expect(canTransition("pushed", "working")).toBe(false);
	const item: PrBabysitItem = {
		itemId: "x",
		source: "ci_check",
		itemType: "check_run",
		summary: "s",
		status: "needs_human",
		errorMessage: "boom",
		updatedAt: 0,
	};
	const requeued = transitionItem(item, "queued", 5);
	expect(requeued.status).toBe("queued");
	expect(requeued.errorMessage).toBeUndefined();
	expect(() => transitionItem({ ...item, status: "pushed" }, "dismissed", 5)).toThrow();
});

test("a human comment queues a thread; our own last word does not", () => {
	const first = syncSnapshotItems(
		session(),
		snapshot({ threads: [thread([comment(1, "bob")])] }),
		1,
	);
	expect(first.queued).toEqual([threadItemId("T1")]);
	expect(first.items[0]).toMatchObject({
		status: "queued",
		lastCommentId: 1,
		path: "a.ts",
		line: 4,
	});

	const pushed = session({ items: first.items.map((item) => ({ ...item, status: "pushed" })) });
	const ours = syncSnapshotItems(
		pushed,
		snapshot({ threads: [thread([comment(1, "bob"), comment(2, "me", "Fixed")])] }),
		2,
	);
	expect(ours.queued).toEqual([]);
	const marked = syncSnapshotItems(
		pushed,
		snapshot({ threads: [thread([comment(1, "bob"), comment(2, "eve", "[helios-babysit] x")])] }),
		2,
	);
	expect(marked.queued).toEqual([]);
});

test("a newer human comment requeues a handled thread; resolving on GitHub resolves it", () => {
	const pushed = session({
		items: [
			{
				itemId: threadItemId("T1"),
				source: "github_thread",
				itemType: "review_thread",
				threadId: "T1",
				lastCommentId: 1,
				summary: "fix it",
				status: "pushed",
				updatedAt: 1,
			},
		],
	});
	const again = syncSnapshotItems(
		pushed,
		snapshot({
			threads: [thread([comment(1, "bob"), comment(2, "me"), comment(3, "bob", "still broken")])],
		}),
		3,
	);
	expect(again.queued).toEqual([threadItemId("T1")]);
	expect(again.items[0]).toMatchObject({ status: "queued", lastCommentId: 3 });

	const resolved = syncSnapshotItems(
		pushed,
		snapshot({ threads: [thread([comment(1, "bob")], true)] }),
		4,
	);
	expect(resolved.items[0]?.status).toBe("resolved");
});

test("failing checks queue once per head and stale queued checks are superseded", () => {
	const failing = snapshot({ checkRuns: [{ name: "test", conclusion: "failure" }] });
	const first = syncSnapshotItems(session(), failing, 1);
	expect(first.queued).toEqual([checkItemId("test", "h1")]);
	expect(syncSnapshotItems(session({ items: first.items }), failing, 2).queued).toEqual([]);
	const newHead = syncSnapshotItems(
		session({ items: first.items }),
		snapshot({ headRefOid: "h2" }),
		3,
	);
	expect(newHead.items[0]?.status).toBe("resolved");
	const off = syncSnapshotItems(
		session({ config: { ...DEFAULT_PR_BABYSIT_CONFIG, fixFailingChecks: false } }),
		failing,
		1,
	);
	expect(off.items).toEqual([]);
});

test("findings land by review behavior and are never refiled", () => {
	expect(findingStatus("blocker", "review_and_auto_queue")).toBe("queued");
	expect(findingStatus("suggestion", "review_and_auto_queue")).toBe("pending_review_approval");
	expect(findingStatus("blocker", "review_for_approval")).toBe("pending_review_approval");
	const finding = { severity: "warning" as const, summary: "S", path: "a.ts", line: 1 };
	const first = applyFindings(session(), [finding], "h1", "anthropic/x", 1);
	expect(first.created).toHaveLength(1);
	expect(first.items[0]).toMatchObject({ reviewerModel: "anthropic/x", headOid: "h1" });
	const second = applyFindings(
		session({ items: first.items }),
		[{ ...finding, summary: " s " }],
		"h2",
		undefined,
		2,
	);
	expect(second.created).toEqual([]);
});

test("status is derived and the cycle cap asks for a human", () => {
	expect(sessionStatus(session())).toBe("watching");
	expect(sessionStatus(session({ cycleCount: 5 }))).toBe("needs_human");
	expect(sessionStatus(session({ active: false }))).toBe("stopped");
	expect(sessionStatus(session({ active: false, status: "merged" }))).toBe("merged");
});

test("the store persists every write and requeues a fix interrupted by a restart", () => {
	let saved: unknown = null;
	const backend = {
		load: () => saved,
		save: (value: unknown) => {
			saved = value;
		},
	};
	const store = createPrBabysitStore(backend);
	store.put(
		session({
			items: [
				{
					itemId: "a",
					source: "ci_check",
					itemType: "check_run",
					summary: "s",
					status: "working",
					updatedAt: 2,
				},
				{
					itemId: "b",
					source: "github_thread",
					itemType: "review_thread",
					summary: "t",
					status: "pushed",
					lastCommentId: 9,
					updatedAt: 1,
				},
			],
		}),
	);
	const raw = saved as { sessions: Array<{ items: unknown[] }> };
	raw.sessions[0]?.items.push({ itemId: "c", source: "nope", summary: "bad" });
	const reloaded = createPrBabysitStore(backend).get("w");
	expect(reloaded?.items.map((item) => [item.itemId, item.status])).toEqual([
		["a", "queued"],
		["b", "pushed"],
	]);
	expect(reloaded?.items[1]?.lastCommentId).toBe(9);
	expect(reloaded && nextQueuedItem(reloaded)?.itemId).toBe("a");
});
