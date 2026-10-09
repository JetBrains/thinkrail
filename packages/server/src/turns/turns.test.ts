import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiEvent, TurnChangeSet } from "@thinkrail/contracts";
import * as gitModule from "../git";
import { gitDiffFile, gitStatus, snapshotWorktree } from "../git";
import { loadTurns, saveWorkspaces } from "../persistence";
import { forgetWorkspaceTurns, listTurns, setTurnPublisher, TurnTracker, turnScope } from "./turns";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
	return result.stdout.toString().trim();
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-turns-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	writeFileSync(join(repo, ".gitignore"), "ignored.log\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				name: "w1",
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
				createdAt: 1,
			},
		]),
	);
	setTurnPublisher(() => {});
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

const resolve = () => ({ workspaceId: "w1", worktreePath: repo });

const start: PiEvent = { type: "agent_start" };
const settle: PiEvent = { type: "agent_settled", terminal: null };

test("a worktree snapshot captures tracked edits and untracked files without touching the index", async () => {
	const head = git(repo, "rev-parse", "HEAD^{tree}");
	expect(await snapshotWorktree(repo)).toBe(head);

	writeFileSync(join(repo, "README.md"), "# repo\n\nedited\n");
	writeFileSync(join(repo, "new.txt"), "new\n");
	writeFileSync(join(repo, "ignored.log"), "noise\n");
	const tree = await snapshotWorktree(repo);
	expect(tree).not.toBeNull();
	expect(tree).not.toBe(head);
	const listed = git(repo, "ls-tree", "--name-only", tree ?? "");
	expect(listed.split("\n").sort()).toEqual([".gitignore", "README.md", "new.txt"]);
	expect(git(repo, "status", "--porcelain")).toContain("?? new.txt");
	expect(git(repo, "diff", "--cached", "--name-only")).toBe("");
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
	"an unreadable untracked file does not void the snapshot of everything else",
	async () => {
		writeFileSync(join(repo, "new.txt"), "new\n");
		writeFileSync(join(repo, "locked.txt"), "secret\n");
		chmodSync(join(repo, "locked.txt"), 0o000);
		try {
			const tree = await snapshotWorktree(repo);
			expect(tree).not.toBeNull();
			expect(git(repo, "ls-tree", "--name-only", tree ?? "").split("\n")).toContain("new.txt");
		} finally {
			chmodSync(join(repo, "locked.txt"), 0o644);
		}
	},
);

test("a run that changes files is recorded once with its change set, published, and diffable as a turn scope", async () => {
	const published: TurnChangeSet[] = [];
	setTurnPublisher((turn) => published.push(turn));
	let clock = 1_000;
	const tracker = new TurnTracker(resolve, () => (clock += 1));

	await tracker.observe("s1", start);
	await tracker.observe("s1", start);
	writeFileSync(join(repo, "README.md"), "# repo\n\nedited by the agent\n");
	writeFileSync(join(repo, "feature.ts"), "export const feature = true;\n");
	await tracker.observe("s1", settle);

	const turns = listTurns("w1");
	expect(turns).toHaveLength(1);
	const turn = turns[0];
	if (!turn) throw new Error("expected a turn");
	expect(turn).toMatchObject({ workspaceId: "w1", sessionId: "s1", startedAt: 1_001 });
	expect(turn.settledAt).toBeGreaterThan(turn.startedAt);
	expect(turn.changes.map((change) => `${change.status}:${change.path}`).sort()).toEqual([
		"added:feature.ts",
		"modified:README.md",
	]);
	expect(published).toEqual([turn]);
	expect(existsSync(join(dataDir, "turns.json"))).toBe(true);
	expect(loadTurns().byWorkspace.w1).toEqual([turn]);

	const scope = turnScope(turn);
	const status = await gitStatus("w1", scope);
	expect(status.changes.map((change) => change.path).sort()).toEqual(["README.md", "feature.ts"]);
	const diff = await gitDiffFile("w1", "README.md", scope);
	expect(diff.original).toBe("# repo\n");
	expect(diff.modified).toBe("# repo\n\nedited by the agent\n");
	expect(diff.originalOid).toBe(turn.baseTree);

	// later edits by the user do not move the recorded turn: both sides are snapshots
	writeFileSync(join(repo, "README.md"), "# repo\n\nedited again by the user\n");
	expect((await gitDiffFile("w1", "README.md", scope)).modified).toBe(
		"# repo\n\nedited by the agent\n",
	);

	forgetWorkspaceTurns("w1");
	expect(listTurns("w1")).toEqual([]);
});

function snapshotNow(cwd: string): string {
	const scratch = mkdtempSync(join(tmpdir(), "trpi-turns-scratch-"));
	try {
		const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
		const added = Bun.spawnSync(["git", "-C", cwd, "add", "-A", "--", "."], {
			env,
			stderr: "ignore",
		});
		if (!added.success) throw new Error("git add failed");
		const tree = Bun.spawnSync(["git", "-C", cwd, "write-tree"], { env, stdout: "pipe" });
		if (!tree.success) throw new Error("git write-tree failed");
		return tree.stdout.toString().trim();
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("the head is captured the moment the run settles, not after a slow base snapshot", async () => {
	const base = deferred<string | null>();
	const seen: string[] = [];
	const tracker = new TurnTracker(resolve, Date.now, (cwd) => {
		const tree = snapshotNow(cwd);
		seen.push(tree);
		return seen.length === 1 ? base.promise : Promise.resolve(tree);
	});

	const started = tracker.observe("s1", start);
	writeFileSync(join(repo, "run-one.ts"), "export const one = 1;\n");
	const settled = tracker.observe("s1", settle);
	writeFileSync(join(repo, "run-two.ts"), "export const two = 2;\n");
	base.resolve(seen[0] ?? null);
	await Promise.all([started, settled]);

	const [turn] = listTurns("w1");
	expect(turn?.changes.map((change) => change.path)).toEqual(["run-one.ts"]);
});

test.each([
	"before",
	"after",
] as const)("session membership removed %s settlement does not discard its workspace's receipt", async (when) => {
	const published: TurnChangeSet[] = [];
	setTurnPublisher((turn) => published.push(turn));
	let attached = true;
	const head = deferred<string | null>();
	let calls = 0;
	const tracker = new TurnTracker(
		() => (attached ? resolve() : null),
		Date.now,
		(cwd) => (++calls === 1 ? snapshotWorktree(cwd) : head.promise),
	);

	await tracker.observe("s1", start);
	writeFileSync(join(repo, "feature.ts"), "export const feature = true;\n");
	if (when === "before") attached = false;
	const settled = tracker.observe("s1", settle);
	attached = false;
	head.resolve(await snapshotWorktree(repo));
	await settled;

	const turns = listTurns("w1");
	expect(turns).toHaveLength(1);
	expect(turns[0]?.changes.map((change) => change.path)).toEqual(["feature.ts"]);
	expect(published).toEqual(turns);
});

test("a workspace removed while its run is settling records and publishes nothing", async () => {
	const published: TurnChangeSet[] = [];
	setTurnPublisher((turn) => published.push(turn));
	const statusReady = deferred<void>();
	const releaseStatus = deferred<void>();
	const realStatus = gitStatus;
	const statusSpy = spyOn(gitModule, "gitStatus").mockImplementation(async (...args) => {
		const status = await realStatus(...args);
		statusReady.resolve();
		await releaseStatus.promise;
		return status;
	});
	const tracker = new TurnTracker(resolve);
	try {
		await tracker.observe("s1", start);
		writeFileSync(join(repo, "feature.ts"), "export const feature = true;\n");
		const settled = tracker.observe("s1", settle);
		await statusReady.promise;
		saveWorkspaces([]);
		forgetWorkspaceTurns("w1");
		releaseStatus.resolve();
		await settled;

		expect(listTurns("w1")).toEqual([]);
		expect(published).toEqual([]);
		expect(existsSync(join(dataDir, "turns.json"))).toBe(false);
	} finally {
		releaseStatus.resolve();
		statusSpy.mockRestore();
	}
});

test("attempt-level agent_end does not end a run before agent_settled", async () => {
	const tracker = new TurnTracker(resolve);
	await tracker.observe("s1", start);
	writeFileSync(join(repo, "first.txt"), "first attempt\n");
	await tracker.observe("s1", { type: "agent_end", messages: [], willRetry: true });
	expect(listTurns("w1")).toEqual([]);
	await tracker.observe("s1", start);
	writeFileSync(join(repo, "retry.txt"), "retry\n");
	await tracker.observe("s1", settle);
	expect(listTurns("w1")[0]?.changes.map((change) => change.path)).toEqual([
		"first.txt",
		"retry.txt",
	]);
});

test("turns are kept in start order even when a later-started run settles first", async () => {
	let clock = 1_000;
	const tracker = new TurnTracker(resolve, () => (clock += 1));
	await tracker.observe("early", start);
	await tracker.observe("late", start);
	writeFileSync(join(repo, "late.ts"), "export const late = true;\n");
	await tracker.observe("late", settle);
	writeFileSync(join(repo, "early.ts"), "export const early = true;\n");
	await tracker.observe("early", settle);
	expect(listTurns("w1").map((turn) => turn.sessionId)).toEqual(["early", "late"]);
});

test("a run that changes nothing records no turn", async () => {
	const tracker = new TurnTracker(resolve);
	await tracker.observe("s1", start);
	await tracker.observe("s1", settle);
	expect(listTurns("w1")).toEqual([]);
	expect(existsSync(join(dataDir, "turns.json"))).toBe(false);
});

test("a settle without a matching start, or a session the host cannot place, is ignored", async () => {
	const tracker = new TurnTracker(() => null);
	await tracker.observe("s1", start);
	await tracker.observe("s1", settle);
	const placed = new TurnTracker(resolve);
	await placed.observe("s2", settle);
	expect(listTurns("w1")).toEqual([]);
});
