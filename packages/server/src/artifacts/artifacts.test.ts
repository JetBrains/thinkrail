import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTrashImplementationForTests } from "../trash";
import {
	artifactsStoreRoot,
	discardArtifact,
	isArtifactPath,
	listArtifacts,
	observeArtifactSessionEvent,
	reconcileArtifacts,
	removeWorkspaceArtifacts,
	resetArtifactsForTests,
	restoreArtifact,
	setArtifactsPublisher,
	touchesArtifacts,
	withUserRemoval,
} from "./artifacts";
import { collapseIgnoredEntries } from "./outputs";

const CONTEXT = ".thinkrail/context";
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
let dataDir: string;
let root: string;
let trashed: string[];
let published: string[];

function write(rel: string, content: string): void {
	const abs = join(root, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content);
}

function git(...args: string[]): void {
	const run = Bun.spawnSync(["git", "-C", root, ...args], { stderr: "pipe" });
	if (run.exitCode !== 0) throw new Error(run.stderr.toString());
}

function workspaces(...records: object[]): void {
	writeFileSync(join(dataDir, "workspaces.json"), JSON.stringify(records));
}

beforeEach(() => {
	dataDir = realpathSync(mkdtempSync(join(tmpdir(), "trpi-artifacts-")));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	root = join(dataDir, "worktree");
	mkdirSync(join(root, CONTEXT), { recursive: true });
	writeFileSync(join(root, CONTEXT, ".gitignore"), "*\n");
	workspaces({ id: "w1", projectId: "p1", name: "w1", worktreePath: root, createdAt: 1 });
	trashed = [];
	published = [];
	setTrashImplementationForTests(async (input) => {
		if (typeof input !== "string") throw new Error("expected one path");
		trashed.push(basename(input));
		rmSync(input, { recursive: true });
	});
	resetArtifactsForTests();
	setArtifactsPublisher((id) => published.push(id));
});

afterEach(() => {
	resetArtifactsForTests();
	setTrashImplementationForTests(undefined);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("classifies artifact paths: the scaffold and the TODO state are not artifacts", () => {
	expect(isArtifactPath(`${CONTEXT}/TASK-x.md`)).toBe(true);
	expect(isArtifactPath(`${CONTEXT}/mockups/a.html`)).toBe(true);
	expect(isArtifactPath(`${CONTEXT}/.gitignore`)).toBe(false);
	expect(isArtifactPath(`${CONTEXT}/todos/s1.json`)).toBe(false);
	expect(isArtifactPath("src/index.ts")).toBe(false);
	expect(touchesArtifacts(".thinkrail")).toBe(true);
	expect(touchesArtifacts(CONTEXT)).toBe(true);
	expect(touchesArtifacts("src")).toBe(false);
});

test("lists context files newest first and skips the TODO state", async () => {
	write(`${CONTEXT}/todos/s1.json`, "{}");
	write(`${CONTEXT}/old.md`, "old");
	await Bun.sleep(5);
	write(`${CONTEXT}/mockups/new.html`, "<h1>new</h1>");
	const snapshot = await listArtifacts("w1");
	expect(snapshot.dir).toBe(CONTEXT);
	expect(snapshot.artifacts.map((a) => a.path)).toEqual([
		`${CONTEXT}/mockups/new.html`,
		`${CONTEXT}/old.md`,
	]);
	expect(snapshot.artifacts[0]).toMatchObject({ state: "live", size: 12 });
	expect(snapshot.artifacts[0]?.sessionId).toBeUndefined();
	expect(published).toEqual(["w1"]);
});

test("a write tool names its writer even while other chats run", async () => {
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_start" });
	await observeArtifactSessionEvent("w1", "s2", { type: "agent_start" });
	await observeArtifactSessionEvent("w1", "s2", {
		type: "tool_execution_start",
		toolName: "write",
		args: { path: `${CONTEXT}/report.md` },
	});
	write(`${CONTEXT}/report.md`, "report");
	write(`${CONTEXT}/from-bash.txt`, "bash");
	await observeArtifactSessionEvent("w1", "s2", { type: "tool_execution_end", toolName: "write" });
	const byPath = new Map((await listArtifacts("w1")).artifacts.map((a) => [a.path, a]));
	expect(byPath.get(`${CONTEXT}/report.md`)?.sessionId).toBe("s2");
	expect(byPath.get(`${CONTEXT}/from-bash.txt`)?.sessionId).toBeUndefined();
});

test("a file made while exactly one chat runs belongs to that chat", async () => {
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_start" });
	write(`${CONTEXT}/shot.png`, "png");
	await observeArtifactSessionEvent("w1", "s1", { type: "tool_execution_end", toolName: "bash" });
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_settled" });
	write(`${CONTEXT}/later.md`, "by the user");
	const byPath = new Map((await listArtifacts("w1")).artifacts.map((a) => [a.path, a]));
	expect(byPath.get(`${CONTEXT}/shot.png`)?.sessionId).toBe("s1");
	expect(byPath.get(`${CONTEXT}/later.md`)?.sessionId).toBeUndefined();
});

test("a file deleted behind the user's back stays restorable with its last content", async () => {
	write(`${CONTEXT}/TASK-a.md`, "v1");
	reconcileArtifacts("w1");
	writeFileSync(join(root, CONTEXT, "TASK-a.md"), "v2");
	rmSync(join(root, CONTEXT, "TASK-a.md"));
	const [row] = (await listArtifacts("w1")).artifacts;
	expect(row).toMatchObject({ path: `${CONTEXT}/TASK-a.md`, state: "deleted" });
	restoreArtifact("w1", `${CONTEXT}/TASK-a.md`);
	expect(readFileSync(join(root, CONTEXT, "TASK-a.md"), "utf8")).toBe("v2");
	expect((await listArtifacts("w1")).artifacts[0]?.state).toBe("live");
});

test("restoring refuses a path the agent already wrote again", async () => {
	write(`${CONTEXT}/a.md`, "v1");
	reconcileArtifacts("w1");
	rmSync(join(root, CONTEXT, "a.md"));
	reconcileArtifacts("w1");
	write(`${CONTEXT}/a.md`, "fresh");
	expect(() => restoreArtifact("w1", `${CONTEXT}/a.md`)).toThrow();
	const [row] = (await listArtifacts("w1")).artifacts;
	expect(row?.state).toBe("live");
});

test("a removal the user asked for drops the row and its kept copy", async () => {
	write(`${CONTEXT}/a.md`, "a");
	reconcileArtifacts("w1");
	await withUserRemoval("w1", `${CONTEXT}/a.md`, async () => {
		rmSync(join(root, CONTEXT, "a.md"));
	});
	expect((await listArtifacts("w1")).artifacts).toEqual([]);
	expect(readdirSync(join(artifactsStoreRoot(), "w1", "kept"))).toEqual([]);
});

test("a failed user removal leaves no mark behind", async () => {
	write(`${CONTEXT}/a.md`, "a");
	reconcileArtifacts("w1");
	await expect(
		withUserRemoval("w1", `${CONTEXT}/a.md`, async () => {
			throw new Error("trash failed");
		}),
	).rejects.toThrow("trash failed");
	rmSync(join(root, CONTEXT, "a.md"));
	expect((await listArtifacts("w1")).artifacts[0]?.state).toBe("deleted");
});

test("a moved file keeps its row instead of reading as deleted", async () => {
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_start" });
	write(`${CONTEXT}/draft.md`, "draft");
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_settled" });
	const before = (await listArtifacts("w1")).artifacts[0];
	mkdirSync(join(root, CONTEXT, "done"));
	renameSync(join(root, CONTEXT, "draft.md"), join(root, CONTEXT, "done", "final.md"));
	const after = (await listArtifacts("w1")).artifacts;
	expect(after).toHaveLength(1);
	expect(after[0]).toMatchObject({
		path: `${CONTEXT}/done/final.md`,
		state: "live",
		sessionId: "s1",
		firstSeenAt: before?.firstSeenAt,
	});
});

test("deleting a kept copy sends it to the trash under its own name", async () => {
	write(`${CONTEXT}/mockups/a.html`, "a");
	reconcileArtifacts("w1");
	rmSync(join(root, CONTEXT, "mockups", "a.html"));
	reconcileArtifacts("w1");
	await discardArtifact("w1", `${CONTEXT}/mockups/a.html`);
	expect(trashed).toEqual(["a.html"]);
	expect((await listArtifacts("w1")).artifacts).toEqual([]);
	await expect(discardArtifact("w1", `${CONTEXT}/mockups/a.html`)).rejects.toThrow();
});

test("the index survives a host restart", async () => {
	write(`${CONTEXT}/a.md`, "a");
	reconcileArtifacts("w1");
	rmSync(join(root, CONTEXT, "a.md"));
	reconcileArtifacts("w1");
	resetArtifactsForTests();
	const [row] = (await listArtifacts("w1")).artifacts;
	expect(row?.state).toBe("deleted");
	restoreArtifact("w1", `${CONTEXT}/a.md`);
	expect(readFileSync(join(root, CONTEXT, "a.md"), "utf8")).toBe("a");
});

test("removing the workspace removes its store", async () => {
	write(`${CONTEXT}/a.md`, "a");
	reconcileArtifacts("w1");
	expect(existsSync(join(artifactsStoreRoot(), "w1"))).toBe(true);
	removeWorkspaceArtifacts("w1");
	expect(existsSync(join(artifactsStoreRoot(), "w1"))).toBe(false);
});

test("ignored outputs of a run are folder rows without dependencies or caches", async () => {
	git("init", "-q");
	writeFileSync(join(root, ".gitignore"), "dist/\nnode_modules/\nold/\n.cache/\n");
	write("old/stale.txt", "from before");
	await listArtifacts("w1");
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_start" });
	await Bun.sleep(5);
	write("dist/a.js", "a");
	write("dist/assets/b.css", "b");
	write("node_modules/x/index.js", "x");
	write(".cache/y", "y");
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_settled" });
	const { outputs } = await listArtifacts("w1");
	expect(outputs).toEqual([
		{
			path: "dist",
			kind: "dir",
			files: 2,
			filesTruncated: false,
			changedAt: expect.any(Number),
			sessionId: "s1",
		},
	]);
	rmSync(join(root, "dist"), { recursive: true });
	expect((await listArtifacts("w1")).outputs).toEqual([]);
});

test("a chat without a project has no ignored section", async () => {
	workspaces({
		id: "w1",
		projectId: "p1",
		name: "w1",
		worktreePath: root,
		createdAt: 1,
		kind: "chat",
	});
	expect((await listArtifacts("w1")).outputs).toBeNull();
});

test("ignored entries collapse under a listed folder and skip dependency folders", () => {
	expect([
		...collapseIgnoredEntries([
			".husky/_/",
			".husky/_/pre-commit",
			"docs/notes.md",
			"packages/a/node_modules/",
			".thinkrail/context/a.md",
			"coverage/",
		]),
	]).toEqual([
		[".husky/_", "dir"],
		["coverage", "dir"],
		["docs/notes.md", "file"],
	]);
});
