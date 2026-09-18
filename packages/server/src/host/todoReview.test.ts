import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewAnchor, Workspace } from "@thinkrail/contracts";
import { TodoStore } from "pi-todos/core";
import { saveProjects, saveWorkspaces } from "../persistence";
import { addComment, markCommentsSent } from "../reviews";
import { resetConfigCache } from "../settings";
import { readReviewMeta, startTodoReview } from "../todos";
import {
	claimItemFix,
	isItemUnderActiveReview,
	itemFixFindings,
	reconcilePendingReviewsOnBoot,
	releaseItemFix,
} from "./todoReview";

let dataDir: string;
let worktree: string;
const WS = "ws-fixfindings";
const SESSION = "sess-fixfindings";

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "fixfind-data-"));
	worktree = mkdtempSync(join(tmpdir(), "fixfind-wt-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache();
	writeFileSync(join(worktree, "a.ts"), "const a = 1;\nconst b = 2;\n");
	saveWorkspaces([
		{
			id: WS,
			projectId: "p1",
			name: "w",
			branch: "main",
			baseBranch: "main",
			worktreePath: worktree,
			createdAt: 0,
		} as Workspace,
	]);
});

afterEach(() => {
	delete process.env.THINKRAIL_DATA_DIR;
	resetConfigCache();
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(worktree, { recursive: true, force: true });
});

function anchorAt(path: string): ReviewAnchor {
	return {
		path,
		side: "worktree",
		contentHash: "",
		selectors: [{ kind: "lineRange", startLine: 1, endLine: 1 }],
	};
}

test("the per-item fix latch rejects overlap and participates in the removal guard", () => {
	expect(claimItemFix(SESSION, "t1")).toBe(true);
	try {
		expect(claimItemFix(SESSION, "t1")).toBe(false);
		expect(isItemUnderActiveReview(SESSION, "t1")).toBe(true);
	} finally {
		releaseItemFix(SESSION, "t1");
	}
	expect(isItemUnderActiveReview(SESSION, "t1")).toBe(false);
});

test("itemFixFindings keeps only this item's open unstale agent findings", async () => {
	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [
			{ kind: "commit", sha: "sha1", label: "a" },
			{ kind: "commit", sha: "sha2", label: "b" },
		],
	});
	const origin = { todoId: todo.id, sessionId: SESSION, reviewedSha: "sha2" };
	const finding = (over: Partial<Parameters<typeof addComment>[0]>) =>
		addComment({
			workspaceId: WS,
			kind: "inline",
			author: "agent",
			anchor: anchorAt("a.ts"),
			body: "finding",
			origin,
			...over,
		});

	const kept = await finding({});
	await finding({ origin: { ...origin, todoId: "other-item" } });
	await finding({ origin: { ...origin, sessionId: "other-session" } });
	await addComment({
		workspaceId: WS,
		kind: "inline",
		anchor: anchorAt("a.ts"),
		body: "human draft",
	});
	const sent = await finding({});
	await markCommentsSent(WS, [sent.id], SESSION);
	await finding({ anchor: anchorAt("gone.ts"), origin: { ...origin, reviewedSha: "sha1" } });

	const ids = (await itemFixFindings({ workspaceId: WS, sessionId: SESSION, id: todo.id })).map(
		(c) => c.id,
	);
	expect(ids).toEqual([kept.id]);
});

test("reconcilePendingReviewsOnBoot clears a pending mark stranded by a host restart, walking every project's every workspace from disk", () => {
	saveProjects([{ id: "p1", name: "w", path: worktree, slug: "w", lastOpened: 1 }]);
	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});
	startTodoReview({ workspaceId: WS, sessionId: SESSION, id: todo.id });
	expect(readReviewMeta(worktree, SESSION).pending[todo.id]).toBeDefined();

	reconcilePendingReviewsOnBoot();

	expect(readReviewMeta(worktree, SESSION).pending[todo.id]).toBeUndefined();
});
