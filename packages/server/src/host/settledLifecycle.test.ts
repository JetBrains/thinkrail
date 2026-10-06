import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionStateRecord, Workspace } from "@thinkrail/contracts";
import { resetConfigCache, updateConfig } from "../settings";
import { createWorkspace, listWorkspaceRecords, settleWorkspace } from "../workspaces";
import { candidateLiveRows, scheduleLifecyclePass, stampSessionActivity } from "./settledLifecycle";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const DAY_MS = 24 * 60 * 60_000;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function row(overrides: Partial<Workspace>): Workspace {
	return {
		id: overrides.id ?? "w",
		projectId: "p1",
		name: "w",
		branch: "w",
		worktreePath: "/tmp/w",
		baseBranch: "main",
		...overrides,
	};
}

beforeEach(() => {
	dataDir = realpathSync(mkdtempSync(join(tmpdir(), "trpi-settled-")));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache();
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	resetConfigCache();
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("candidate-live rows are the ones whose review can still change the partition", () => {
	const now = Date.now();
	const rows = [
		row({ id: "default", kind: "default", lastActiveAt: now }),
		row({ id: "parked", settledOverride: "settled", lastActiveAt: now }),
		row({ id: "merged", review: { kind: "pull-request", number: 1, state: "merged" } }),
		row({ id: "closed", review: { kind: "pull-request", number: 2, state: "closed" } }),
		row({ id: "pinned", settledOverride: "active", lastActiveAt: now - 40 * DAY_MS }),
		row({
			id: "open-stale",
			review: { kind: "pull-request", number: 3, state: "open" },
			lastActiveAt: now - 40 * DAY_MS,
		}),
		row({ id: "idle", lastActiveAt: now - 4 * DAY_MS }),
		row({ id: "fresh", lastActiveAt: now - 1 * DAY_MS }),
		row({ id: "unstamped" }),
	];
	expect(candidateLiveRows(rows, now).map((r) => r.id)).toEqual([
		"pinned",
		"open-stale",
		"fresh",
		"unstamped",
	]);

	updateConfig({ settleIdleDays: null });
	expect(candidateLiveRows(rows, now).map((r) => r.id)).toContain("idle");
});

test("a running session stamps its workspace; idle state changes do not", async () => {
	const ws = await createWorkspace("p1");
	const all = JSON.parse(readFileSync(join(dataDir, "workspaces.json"), "utf8")) as Workspace[];
	for (const record of all) if (record.id === ws.id) record.lastActiveAt = 1;
	writeFileSync(join(dataDir, "workspaces.json"), JSON.stringify(all));

	const base: SessionStateRecord = {
		sessionId: "s1",
		workspaceId: ws.id,
		projectId: "p1",
		state: {
			execution: "idle",
			runId: null,
			needsInput: null,
			completion: null,
			completionUnread: true,
			queuedCount: 0,
		},
	};
	stampSessionActivity(base);
	expect(listWorkspaceRecords("p1").find((r) => r.id === ws.id)?.lastActiveAt).toBe(1);

	stampSessionActivity({ ...base, state: { ...base.state, execution: "running", runId: "r1" } });
	expect(listWorkspaceRecords("p1").find((r) => r.id === ws.id)?.lastActiveAt ?? 0).toBeGreaterThan(
		1,
	);
});

test("the lifecycle pass backfills a legacy row from its worktree and leaves stamped rows alone", async () => {
	const legacy = await createWorkspace("p1", "Legacy");
	const stamped = await createWorkspace("p1", "Stamped");
	const all = JSON.parse(readFileSync(join(dataDir, "workspaces.json"), "utf8")) as Workspace[];
	for (const record of all) {
		if (record.id === legacy.id) delete record.lastActiveAt;
		if (record.id === stamped.id) record.lastActiveAt = 1234;
	}
	writeFileSync(join(dataDir, "workspaces.json"), JSON.stringify(all));
	settleWorkspace(legacy.id);

	await scheduleLifecyclePass("p1");

	const after = listWorkspaceRecords("p1");
	const legacyAfter = after.find((r) => r.id === legacy.id);
	expect(legacyAfter?.lastActiveAt).toBeGreaterThan(0);
	expect(legacyAfter?.settledOverride).toBe("settled");
	expect(after.find((r) => r.id === stamped.id)?.lastActiveAt).toBe(1234);
	expect(after.find((r) => r.kind === "default")?.review).toBeUndefined();
});
