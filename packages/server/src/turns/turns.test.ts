import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnChangeSet } from "@thinkrail/contracts";
import { gitDiffFile, gitStatus, snapshotWorktree } from "../git";
import { loadTurns } from "../persistence";
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

const start = { type: "agent_start" } as never;
const settle = { type: "agent_settled", messages: [] } as never;

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
