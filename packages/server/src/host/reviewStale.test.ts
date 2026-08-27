import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewComment, ReviewSnapshot, Workspace } from "@thinkrail/contracts";
import { TodoStore } from "pi-todos/core";
import { saveWorkspaces } from "../persistence";
import { markClientStale } from "./todoReview";

let dataDir: string;
let worktree: string;
const WS = "ws-stale";
const SESSION = "sess-stale";

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "stale-data-"));
	worktree = mkdtempSync(join(tmpdir(), "stale-wt-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
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
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(worktree, { recursive: true, force: true });
});

function comment(id: string, over: Partial<ReviewComment>): ReviewComment {
	return {
		id,
		reviewId: "rev_1",
		kind: "inline",
		anchor: null,
		body: "b",
		status: "draft",
		anchorState: "anchored",
		createdAt: 0,
		...over,
	};
}

test("markClientStale flags only an outdated finding whose reviewed sha was superseded", () => {
	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [
			{ kind: "commit", sha: "sha1", label: "a" },
			{ kind: "commit", sha: "sha2", label: "b" },
		],
	});
	const origin = { todoId: todo.id, sessionId: SESSION, reviewedSha: "sha1" };
	const snapshot: ReviewSnapshot = {
		review: { id: "rev_1", workspaceId: WS, status: "open", baseSha: "x", createdAt: 0 },
		comments: [
			comment("rc_stale", { anchorState: "outdated", origin }),
			comment("rc_newest", { anchorState: "outdated", origin: { ...origin, reviewedSha: "sha2" } }),
			comment("rc_anchored", { anchorState: "anchored", origin }),
			comment("rc_noorigin", { anchorState: "outdated" }),
		],
	};
	const byId = Object.fromEntries(
		markClientStale(snapshot, WS).comments.map((c) => [c.id, c.stale]),
	);
	expect(byId.rc_stale).toBe(true); // outdated + sha1 superseded by sha2
	expect(byId.rc_newest).toBeUndefined(); // sha2 is still the newest → not superseded
	expect(byId.rc_anchored).toBeUndefined(); // code still there → not outdated
	expect(byId.rc_noorigin).toBeUndefined(); // no provenance to judge against
});
