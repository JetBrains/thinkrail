import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTrashImplementationForTests } from "../trash";
import {
	artifactsStoreRoot,
	discardArtifact,
	isArtifactPath,
	isSameFile,
	listArtifacts,
	noteArtifactPathsChanged,
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
	mock.restore();
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
		toolCallId: "call-1",
		toolName: "write",
		args: { path: `${CONTEXT}/report.md` },
	});
	write(`${CONTEXT}/report.md`, "report");
	write(`${CONTEXT}/from-bash.txt`, "bash");
	await observeArtifactSessionEvent("w1", "s2", {
		type: "tool_execution_end",
		toolCallId: "call-1",
		toolName: "write",
	});
	const byPath = new Map((await listArtifacts("w1")).artifacts.map((a) => [a.path, a]));
	expect(byPath.get(`${CONTEXT}/report.md`)?.sessionId).toBe("s2");
	expect(byPath.get(`${CONTEXT}/from-bash.txt`)?.sessionId).toBeUndefined();
});

test("a file made while exactly one chat runs belongs to that chat", async () => {
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_start" });
	write(`${CONTEXT}/shot.png`, "png");
	await observeArtifactSessionEvent("w1", "s1", {
		type: "tool_execution_end",
		toolCallId: "call-2",
		toolName: "bash",
	});
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
	const hourAgo = new Date(Date.now() - 3_600_000);
	utimesSync(join(root, "old", "stale.txt"), hourAgo, hourAgo);
	utimesSync(join(root, "old"), hourAgo, hourAgo);
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

function linksUnsupported(): void {
	spyOn(fs, "linkSync").mockImplementation(() => {
		throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
	});
}

test("an inode is a rename only while a hard link holds it, otherwise size and time must match too", () => {
	const file = { dev: "1", ino: "7", size: 10, mtimeMs: 100 };
	expect(isSameFile({ ...file, kept: "k" }, { ...file, size: 99 })).toBe(true);
	expect(isSameFile({ ...file, kept: "k", keptCopy: true }, { ...file, size: 99 })).toBe(false);
	expect(isSameFile({ ...file, kept: "k", keptCopy: true }, file)).toBe(true);
	expect(isSameFile({ ...file }, { ...file, mtimeMs: 200 })).toBe(false);
	expect(isSameFile({ ...file, kept: "k" }, { ...file, ino: "8" })).toBe(false);
});

test("the scan skips dependency folders and delete claims inside the artifacts folder", async () => {
	write(`${CONTEXT}/app/index.html`, "<h1>app</h1>");
	write(`${CONTEXT}/app/node_modules/pkg/index.js`, "x");
	write(`${CONTEXT}/.thinkrail-delete-123/trashing.md`, "x");
	expect((await listArtifacts("w1")).artifacts.map((a) => a.path)).toEqual([
		`${CONTEXT}/app/index.html`,
	]);
});

test("an artifacts folder replaced by a link is never walked and marks nothing deleted", async () => {
	write(`${CONTEXT}/a.md`, "a");
	reconcileArtifacts("w1");
	const outside = join(dataDir, "outside");
	mkdirSync(outside);
	writeFileSync(join(outside, "secret.md"), "secret");
	rmSync(join(root, CONTEXT), { recursive: true });
	symlinkSync(outside, join(root, CONTEXT));
	expect((await listArtifacts("w1")).artifacts).toEqual([
		expect.objectContaining({ path: `${CONTEXT}/a.md`, state: "live" }),
	]);
});

test("restoring a file the agent moved into the project copies it instead of sharing its inode", async () => {
	write(`${CONTEXT}/TASK-x.md`, "design");
	reconcileArtifacts("w1");
	mkdirSync(join(root, "docs"));
	renameSync(join(root, CONTEXT, "TASK-x.md"), join(root, "docs", "SPEC.md"));
	expect((await listArtifacts("w1")).artifacts[0]?.state).toBe("deleted");
	restoreArtifact("w1", `${CONTEXT}/TASK-x.md`);
	const restored = join(root, CONTEXT, "TASK-x.md");
	expect(lstatSync(restored).ino).not.toBe(lstatSync(join(root, "docs", "SPEC.md")).ino);
	writeFileSync(restored, "changed");
	expect(readFileSync(join(root, "docs", "SPEC.md"), "utf8")).toBe("design");
	rmSync(restored);
	expect((await listArtifacts("w1")).artifacts[0]?.state).toBe("deleted");
	restoreArtifact("w1", `${CONTEXT}/TASK-x.md`);
	expect(readFileSync(restored, "utf8")).toBe("changed");
});

test("a path the agent writes again while its kept copy goes to the trash keeps its new row", async () => {
	write(`${CONTEXT}/a.md`, "old");
	reconcileArtifacts("w1");
	rmSync(join(root, CONTEXT, "a.md"));
	reconcileArtifacts("w1");
	setTrashImplementationForTests(async (input) => {
		if (typeof input !== "string") throw new Error("expected one path");
		rmSync(input, { recursive: true });
		write(`${CONTEXT}/a.md`, "new");
		reconcileArtifacts("w1");
	});
	await discardArtifact("w1", `${CONTEXT}/a.md`);
	expect((await listArtifacts("w1")).artifacts).toEqual([
		expect.objectContaining({ path: `${CONTEXT}/a.md`, state: "live", size: 3 }),
	]);
});

test("with copies instead of links, a restore keeps the artifact's chat", async () => {
	linksUnsupported();
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_start" });
	write(`${CONTEXT}/a.md`, "a");
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_settled" });
	rmSync(join(root, CONTEXT, "a.md"));
	expect((await listArtifacts("w1")).artifacts[0]).toMatchObject({
		state: "deleted",
		sessionId: "s1",
	});
	await observeArtifactSessionEvent("w1", "s2", { type: "agent_start" });
	restoreArtifact("w1", `${CONTEXT}/a.md`);
	expect((await listArtifacts("w1")).artifacts[0]).toMatchObject({
		state: "live",
		sessionId: "s1",
	});
	expect(readFileSync(join(root, CONTEXT, "a.md"), "utf8")).toBe("a");
});

test("a write tool's @-prefixed path names its writer like pi resolves it", async () => {
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_start" });
	await observeArtifactSessionEvent("w1", "s2", { type: "agent_start" });
	await observeArtifactSessionEvent("w1", "s2", {
		type: "tool_execution_start",
		toolCallId: "call-1",
		toolName: "write",
		args: { path: `@${CONTEXT}/x.md` },
	});
	write(`${CONTEXT}/x.md`, "x");
	await observeArtifactSessionEvent("w1", "s2", {
		type: "tool_execution_end",
		toolCallId: "call-1",
		toolName: "write",
	});
	expect((await listArtifacts("w1")).artifacts[0]?.sessionId).toBe("s2");
});

test("a writer hint ends with its tool call, so a failed edit never names a later writer", async () => {
	await observeArtifactSessionEvent("w1", "a", { type: "agent_start" });
	await observeArtifactSessionEvent("w1", "b", { type: "agent_start" });
	await observeArtifactSessionEvent("w1", "a", {
		type: "tool_execution_start",
		toolCallId: "edit-1",
		toolName: "edit",
		args: { path: `${CONTEXT}/later.md` },
	});
	await observeArtifactSessionEvent("w1", "a", {
		type: "tool_execution_end",
		toolCallId: "edit-1",
		toolName: "edit",
	});
	write(`${CONTEXT}/later.md`, "from b's shell");
	await observeArtifactSessionEvent("w1", "b", {
		type: "tool_execution_end",
		toolCallId: "bash-1",
		toolName: "bash",
	});
	expect((await listArtifacts("w1")).artifacts[0]).toMatchObject({ path: `${CONTEXT}/later.md` });
	expect((await listArtifacts("w1")).artifacts[0]?.sessionId).toBeUndefined();
});

test("restoring after the whole artifacts folder was cleaned recreates its self-ignoring .gitignore", async () => {
	write(`${CONTEXT}/report.md`, "report");
	reconcileArtifacts("w1");
	rmSync(join(root, ".thinkrail"), { recursive: true });
	expect((await listArtifacts("w1")).artifacts[0]?.state).toBe("deleted");
	restoreArtifact("w1", `${CONTEXT}/report.md`);
	expect(readFileSync(join(root, CONTEXT, ".gitignore"), "utf8")).toBe("*\n");
	expect(readFileSync(join(root, CONTEXT, "report.md"), "utf8")).toBe("report");
});

async function recordDistOutput(): Promise<void> {
	git("init", "-q");
	writeFileSync(join(root, ".gitignore"), "dist/\n");
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_start" });
	write("dist/a.js", "a");
	expect((await listArtifacts("w1")).outputs).toEqual([]);
	await observeArtifactSessionEvent("w1", "s1", { type: "agent_settled" });
}

async function publishedAtLeast(count: number): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (published.length < count) {
		if (Date.now() > deadline)
			throw new Error(`expected ${count} publishes, saw ${published.length}`);
		await Bun.sleep(10);
	}
}

test("a run's ignored outputs are found when it settles, and a listing never walks them", async () => {
	await recordDistOutput();
	expect((await listArtifacts("w1")).outputs).toEqual([
		expect.objectContaining({ path: "dist", files: 1, sessionId: "s1" }),
	]);
	write("dist/b.js", "b");
	expect((await listArtifacts("w1")).outputs?.[0]?.files).toBe(1);
});

test("a user change inside a recorded output recounts it and nudges clients", async () => {
	await recordDistOutput();
	write("dist/b.js", "b");
	const before = published.length;
	noteArtifactPathsChanged("w1", ["dist/b.js"], false);
	await publishedAtLeast(before + 1);
	expect((await listArtifacts("w1")).outputs?.[0]?.files).toBe(2);
});

test("deleting a recorded output drops its row and nudges clients", async () => {
	await recordDistOutput();
	rmSync(join(root, "dist"), { recursive: true });
	const before = published.length;
	noteArtifactPathsChanged("w1", ["dist"], false);
	await publishedAtLeast(before + 1);
	expect((await listArtifacts("w1")).outputs).toEqual([]);
});

test("a change elsewhere neither recounts outputs nor nudges", async () => {
	await recordDistOutput();
	const before = published.length;
	noteArtifactPathsChanged("w1", ["src/index.ts"], false);
	await Bun.sleep(50);
	expect(published.length).toBe(before);
});

test("a kept copy that cannot be removed is left behind without failing the user's delete or the teardown", async () => {
	write(`${CONTEXT}/report.csv`, "a,b");
	reconcileArtifacts("w1");
	const realRm = fs.rmSync;
	spyOn(fs, "rmSync").mockImplementation(((path: fs.PathLike, options?: fs.RmOptions) => {
		if (String(path).startsWith(artifactsStoreRoot()))
			throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
		return realRm(path, options);
	}) as typeof fs.rmSync);
	await withUserRemoval("w1", `${CONTEXT}/report.csv`, async () => {
		realRm(join(root, CONTEXT, "report.csv"));
	});
	expect((await listArtifacts("w1")).artifacts).toEqual([]);
	expect(() => removeWorkspaceArtifacts("w1")).not.toThrow();
});
