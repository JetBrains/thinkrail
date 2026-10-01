import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ChangeReceipt, GitDiffScope, LineSpan, RevertTarget } from "@thinkrail/contracts";
import { hashBytes } from "../fs";
import { setTrashImplementationForTests } from "../trash";
import { revertChange, undoChange } from "./changes";
import { splitLines } from "./textSplice";

const BYTES = new TextEncoder();
const UNCOMMITTED: GitDiffScope = { kind: "uncommitted" };

let dataDir: string;
let repo: string;
let workspaceId: string;
let trashed: string[];
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
let nextWorkspace = 0;

function git(...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], {
		stdout: "ignore",
		stderr: "ignore",
	});
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function gitText(...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
	return new TextDecoder().decode(result.stdout).trim();
}

function commitAll(message: string): string {
	git("add", "-A");
	git("commit", "-m", message);
	return gitText("rev-parse", "HEAD");
}

function write(path: string, content: string | Uint8Array): void {
	writeFileSync(join(repo, path), content);
}

function read(path: string): Uint8Array {
	return readFileSync(join(repo, path));
}

function text(path: string): string {
	return readFileSync(join(repo, path), "utf8");
}

function hash(content: string | Uint8Array | null): string | null {
	if (content === null) return null;
	return hashBytes(typeof content === "string" ? BYTES.encode(content) : content);
}

function expectTrashClaim(path: string | undefined): string {
	if (path === undefined) throw new Error("missing trash claim");
	expect(dirname(path)).toBe(repo);
	expect(basename(path)).toMatch(/^\.thinkrail-revert-[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
	return path;
}

function recoveryFiles(): string[] {
	return readdirSync(repo)
		.filter((name) => /^\.thinkrail-recovery-[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(name))
		.map((name) => join(repo, name));
}

function revert(
	path: string,
	target: RevertTarget,
	expect: { originalHash: string | null; modifiedHash: string | null },
	scope: GitDiffScope = UNCOMMITTED,
): Promise<ChangeReceipt> {
	return revertChange({ workspaceId, path, scope, target, expect });
}

function range(original: LineSpan, modified: LineSpan): RevertTarget {
	return { kind: "range", original, modified };
}

function blobAt(ref: string, path: string): Uint8Array {
	const result = Bun.spawnSync(["git", "-C", repo, "show", `${ref}:${path}`], { stdout: "pipe" });
	return result.stdout;
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-changes-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git("init", "-b", "main");
	git("config", "user.email", "t@thinkrail.test");
	git("config", "user.name", "test");
	git("config", "commit.gpgsign", "false");
	write("a.ts", "one\ntwo\nthree\n");
	commitAll("init");
	workspaceId = `w${++nextWorkspace}`;
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: workspaceId,
				projectId: "p1",
				name: workspaceId,
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
				createdAt: 1,
			},
		]),
	);
	trashed = [];
	setTrashImplementationForTests(async (input) => {
		const path = typeof input === "string" ? input : (input[0] ?? "");
		trashed.push(path);
		rmSync(path, { force: true });
	});
});

afterEach(() => {
	setTrashImplementationForTests(undefined);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("a range revert restores the original lines and leaves the rest of the worktree file alone", async () => {
	write("a.ts", "one\nTWO\nthree\nfour\n");
	const receipt = await revert("a.ts", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
		originalHash: hash("one\ntwo\nthree\n"),
		modifiedHash: hash("one\nTWO\nthree\nfour\n"),
	});

	expect(text("a.ts")).toBe("one\ntwo\nthree\nfour\n");
	expect(receipt.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
	expect(receipt.kind).toBe("revert");
	expect(receipt.path).toBe("a.ts");
	expect(receipt.before.hash).toBe(hash("one\nTWO\nthree\nfour\n"));
	expect(receipt.after).toEqual({
		hash: hash("one\ntwo\nthree\nfour\n"),
		byteLength: 19,
		mode: 0o644,
	});
	expect(receipt.trashed).toBeUndefined();
});

test("an insertion-point span deletes added lines one way and restores deleted lines the other", async () => {
	write("a.ts", "one\ninserted\ntwo\nthree\n");
	await revert("a.ts", range({ start: 2, count: 0 }, { start: 2, count: 1 }), {
		originalHash: hash("one\ntwo\nthree\n"),
		modifiedHash: hash("one\ninserted\ntwo\nthree\n"),
	});
	expect(text("a.ts")).toBe("one\ntwo\nthree\n");

	write("a.ts", "one\nthree\n");
	await revert("a.ts", range({ start: 2, count: 1 }, { start: 2, count: 0 }), {
		originalHash: hash("one\ntwo\nthree\n"),
		modifiedHash: hash("one\nthree\n"),
	});
	expect(text("a.ts")).toBe("one\ntwo\nthree\n");
});

test("reverting the last lines takes the original's final-newline state", async () => {
	write("b.txt", "one\ntwo");
	write("c.txt", "one\ntwo\n");
	commitAll("two final-newline states");
	write("b.txt", "one\nTWO\n");
	await revert("b.txt", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
		originalHash: hash("one\ntwo"),
		modifiedHash: hash("one\nTWO\n"),
	});
	expect(text("b.txt")).toBe("one\ntwo");

	write("c.txt", "one\nTWO");
	await revert("c.txt", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
		originalHash: hash("one\ntwo\n"),
		modifiedHash: hash("one\nTWO"),
	});
	expect(text("c.txt")).toBe("one\ntwo\n");
});

test("a range ending only at the modified tail preserves the worktree's missing final newline", async () => {
	write("tail-lf.txt", "a\nb\nc\n");
	write("tail-crlf.txt", "a\r\nb\r\nc\r\n");
	commitAll("tail fixtures");

	write("tail-lf.txt", "a\nX");
	await revert("tail-lf.txt", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
		originalHash: hash("a\nb\nc\n"),
		modifiedHash: hash("a\nX"),
	});
	expect(text("tail-lf.txt")).toBe("a\nb");

	write("tail-crlf.txt", "a\r\nX");
	await revert("tail-crlf.txt", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
		originalHash: hash("a\r\nb\r\nc\r\n"),
		modifiedHash: hash("a\r\nX"),
	});
	expect(text("tail-crlf.txt")).toBe("a\r\nb");
});

test("count-zero spans at EOF take the original final-newline state in LF and CRLF files", async () => {
	write("append-lf.txt", "a");
	write("delete-lf.txt", "a\nremoved\n");
	write("append-crlf.txt", "a");
	write("delete-crlf.txt", "a\r\nremoved\r\n");
	commitAll("EOF insertion fixtures");

	write("append-lf.txt", "a\nadded\n");
	await revert("append-lf.txt", range({ start: 2, count: 0 }, { start: 2, count: 1 }), {
		originalHash: hash("a"),
		modifiedHash: hash("a\nadded\n"),
	});
	expect(text("append-lf.txt")).toBe("a");

	write("delete-lf.txt", "a");
	await revert("delete-lf.txt", range({ start: 2, count: 1 }, { start: 2, count: 0 }), {
		originalHash: hash("a\nremoved\n"),
		modifiedHash: hash("a"),
	});
	expect(text("delete-lf.txt")).toBe("a\nremoved\n");

	write("append-crlf.txt", "a\r\nadded\r\n");
	await revert("append-crlf.txt", range({ start: 2, count: 0 }, { start: 2, count: 1 }), {
		originalHash: hash("a"),
		modifiedHash: hash("a\r\nadded\r\n"),
	});
	expect(text("append-crlf.txt")).toBe("a");

	write("delete-crlf.txt", "a");
	await revert("delete-crlf.txt", range({ start: 2, count: 1 }, { start: 2, count: 0 }), {
		originalHash: hash("a\r\nremoved\r\n"),
		modifiedHash: hash("a"),
	});
	expect(text("delete-crlf.txt")).toBe("a\r\nremoved\r\n");
});

test("an interior span never loses a line ending, and an append keeps the worktree's own tail", async () => {
	write("c.txt", "one");
	commitAll("single unterminated line");
	write("c.txt", "ONE\ntwo\n");
	await revert("c.txt", range({ start: 1, count: 1 }, { start: 1, count: 1 }), {
		originalHash: hash("one"),
		modifiedHash: hash("ONE\ntwo\n"),
	});
	expect(text("c.txt")).toBe("one\ntwo\n");

	write("d.txt", "one");
	commitAll("another unterminated line");
	write("d.txt", "one\nadded\n");
	await revert("d.txt", range({ start: 2, count: 0 }, { start: 2, count: 1 }), {
		originalHash: hash("one"),
		modifiedHash: hash("one\nadded\n"),
	});
	expect(text("d.txt")).toBe("one");
});

test("CRLF survives a revert, and a restored CRLF line keeps its own ending", async () => {
	write("crlf.txt", "one\r\ntwo\r\nthree\r\n");
	commitAll("crlf file");
	write("crlf.txt", "one\r\nTWO\r\nthree\r\n");
	await revert("crlf.txt", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
		originalHash: hash("one\r\ntwo\r\nthree\r\n"),
		modifiedHash: hash("one\r\nTWO\r\nthree\r\n"),
	});
	expect(text("crlf.txt")).toBe("one\r\ntwo\r\nthree\r\n");
});

test("line splitting matches jsdiff for CR-only and mixed CRLF/LF content", async () => {
	expect(splitLines("one\rtwo\rthree")).toEqual(["one\rtwo\rthree"]);
	expect(splitLines("one\r\ntwo\nthree\r\n")).toEqual(["one\r\n", "two\n", "three\r\n"]);

	write("cr-only.txt", "one\rtwo\rthree");
	write("mixed.txt", "one\r\ntwo\nthree\r\n");
	commitAll("mixed line endings");
	write("cr-only.txt", "one\rTWO\rthree");
	write("mixed.txt", "one\r\nTWO\nthree\r\n");

	await revert("cr-only.txt", range({ start: 1, count: 1 }, { start: 1, count: 1 }), {
		originalHash: hash("one\rtwo\rthree"),
		modifiedHash: hash("one\rTWO\rthree"),
	});
	await revert("mixed.txt", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
		originalHash: hash("one\r\ntwo\nthree\r\n"),
		modifiedHash: hash("one\r\nTWO\nthree\r\n"),
	});

	expect(text("cr-only.txt")).toBe("one\rtwo\rthree");
	expect(text("mixed.txt")).toBe("one\r\ntwo\nthree\r\n");
});

test("a whole-file revert rewrites a modified file and restores a deleted one", async () => {
	write("a.ts", "rewritten\n");
	chmodSync(join(repo, "a.ts"), 0o755);
	const modified = await revert(
		"a.ts",
		{ kind: "file" },
		{
			originalHash: hash("one\ntwo\nthree\n"),
			modifiedHash: hash("rewritten\n"),
		},
	);
	expect(text("a.ts")).toBe("one\ntwo\nthree\n");
	expect(statSync(join(repo, "a.ts")).mode & 0o777).toBe(0o644);
	expect(modified.before.mode).toBe(0o755);
	expect(modified.after.mode).toBe(0o644);
	await undoChange({
		workspaceId,
		receiptId: modified.id,
		expect: { modifiedHash: hash("one\ntwo\nthree\n") },
	});
	expect(text("a.ts")).toBe("rewritten\n");
	expect(statSync(join(repo, "a.ts")).mode & 0o777).toBe(0o755);

	rmSync(join(repo, "a.ts"));
	const restored = await revert(
		"a.ts",
		{ kind: "file" },
		{
			originalHash: hash("one\ntwo\nthree\n"),
			modifiedHash: null,
		},
	);
	expect(text("a.ts")).toBe("one\ntwo\nthree\n");
	expect(restored.before).toEqual({ hash: null, byteLength: null, mode: null });
});

test("a mode-only change is unsupported", async () => {
	chmodSync(join(repo, "a.ts"), 0o755);
	await expect(
		revert(
			"a.ts",
			{ kind: "file" },
			{
				originalHash: hash("one\ntwo\nthree\n"),
				modifiedHash: hash("one\ntwo\nthree\n"),
			},
		),
	).rejects.toMatchObject({ code: "UNSUPPORTED_CHANGE" });
	expect(statSync(join(repo, "a.ts")).mode & 0o777).toBe(0o755);
});

test("a deleted executable is restored with its Git mode", async () => {
	write("run.sh", "#!/bin/sh\necho ready\n");
	chmodSync(join(repo, "run.sh"), 0o755);
	commitAll("add executable");
	rmSync(join(repo, "run.sh"));

	const receipt = await revert(
		"run.sh",
		{ kind: "file" },
		{ originalHash: hash("#!/bin/sh\necho ready\n"), modifiedHash: null },
	);
	expect(statSync(join(repo, "run.sh")).mode & 0o777).toBe(0o755);
	expect(receipt.after.mode).toBe(0o755);
});

test("symbolic links on either side are unsupported", async () => {
	write("target.txt", "target\n");
	symlinkSync("target.txt", join(repo, "link.txt"));
	commitAll("add symlink");
	await expect(
		revert("link.txt", { kind: "file" }, { originalHash: hash("target.txt"), modifiedHash: null }),
	).rejects.toMatchObject({ code: "UNSUPPORTED_CHANGE" });

	rmSync(join(repo, "link.txt"));
	write("regular.txt", "regular\n");
	commitAll("replace symlink with regular file");
	rmSync(join(repo, "regular.txt"));
	symlinkSync("target.txt", join(repo, "regular.txt"));
	await expect(
		revert(
			"regular.txt",
			{ kind: "file" },
			{ originalHash: hash("regular\n"), modifiedHash: hash("target\n") },
		),
	).rejects.toMatchObject({ code: "UNSUPPORTED_CHANGE" });
});

test("a whole-file revert of an added or untracked file moves it to the trash", async () => {
	write("untracked.txt", "fresh\n");
	const untracked = await revert(
		"untracked.txt",
		{ kind: "file" },
		{
			originalHash: null,
			modifiedHash: hash("fresh\n"),
		},
	);
	expect(existsSync(join(repo, "untracked.txt"))).toBe(false);
	const untrackedClaim = expectTrashClaim(untracked.trashed);
	expect(untracked.after).toEqual({ hash: null, byteLength: null, mode: null });

	write("added.txt", "staged\n");
	git("add", "added.txt");
	await revert(
		"added.txt",
		{ kind: "file" },
		{
			originalHash: null,
			modifiedHash: hash("staged\n"),
		},
	);
	expect(existsSync(join(repo, "added.txt"))).toBe(false);
	expect(trashed).toHaveLength(2);
	expect(trashed[0]).toBe(untrackedClaim);
	expectTrashClaim(trashed[1]);
});

test("a write landing while revert trashes its claim survives and the receipt restores prior bytes", async () => {
	write("raced.txt", "before revert\n");
	let enteredTrash!: () => void;
	let releaseTrash!: () => void;
	const entered = new Promise<void>((resolve) => {
		enteredTrash = resolve;
	});
	const released = new Promise<void>((resolve) => {
		releaseTrash = resolve;
	});
	let claimed = "";
	setTrashImplementationForTests(async (input) => {
		claimed = typeof input === "string" ? input : (input[0] ?? "");
		enteredTrash();
		await released;
		rmSync(claimed, { force: true });
	});

	const pending = revert(
		"raced.txt",
		{ kind: "file" },
		{ originalHash: null, modifiedHash: hash("before revert\n") },
	);
	await entered;
	expectTrashClaim(claimed);
	expect(existsSync(join(repo, "raced.txt"))).toBe(false);
	write("raced.txt", "agent write\n");
	releaseTrash();
	const receipt = await pending;

	expect(text("raced.txt")).toBe("agent write\n");
	expect(receipt.trashed).toBe(claimed);
	await undoChange({
		workspaceId,
		receiptId: receipt.id,
		expect: { modifiedHash: hash("agent write\n") },
	});
	expect(text("raced.txt")).toBe("before revert\n");
});

test("a failed revert trash preserves its claim without overwriting a concurrent recreation", async () => {
	write("failed-race.txt", "claimed bytes\n");
	let enteredTrash!: () => void;
	let releaseTrash!: () => void;
	const entered = new Promise<void>((resolve) => {
		enteredTrash = resolve;
	});
	const released = new Promise<void>((resolve) => {
		releaseTrash = resolve;
	});
	setTrashImplementationForTests(async () => {
		enteredTrash();
		await released;
		throw new Error("trash unavailable");
	});

	const pending = revert(
		"failed-race.txt",
		{ kind: "file" },
		{ originalHash: null, modifiedHash: hash("claimed bytes\n") },
	);
	await entered;
	write("failed-race.txt", "agent recreation\n");
	releaseTrash();
	const failure = await pending.then(
		() => null,
		(error: unknown) => error,
	);
	const [recovery] = recoveryFiles();
	if (!recovery) throw new Error("missing recovery file");

	expect(text("failed-race.txt")).toBe("agent recreation\n");
	expect(readFileSync(recovery, "utf8")).toBe("claimed bytes\n");
	expect(failure).toBeInstanceOf(Error);
	expect((failure as Error).message).toContain(recovery);
});

test("a failed undo trash preserves its claim without overwriting a concurrent recreation", async () => {
	rmSync(join(repo, "a.ts"));
	const restored = await revert(
		"a.ts",
		{ kind: "file" },
		{ originalHash: hash("one\ntwo\nthree\n"), modifiedHash: null },
	);
	let enteredTrash!: () => void;
	let releaseTrash!: () => void;
	const entered = new Promise<void>((resolve) => {
		enteredTrash = resolve;
	});
	const released = new Promise<void>((resolve) => {
		releaseTrash = resolve;
	});
	setTrashImplementationForTests(async () => {
		enteredTrash();
		await released;
		throw new Error("trash unavailable");
	});

	const pending = undoChange({
		workspaceId,
		receiptId: restored.id,
		expect: { modifiedHash: hash("one\ntwo\nthree\n") },
	});
	await entered;
	write("a.ts", "agent recreation\n");
	releaseTrash();
	const failure = await pending.then(
		() => null,
		(error: unknown) => error,
	);
	const [recovery] = recoveryFiles();
	if (!recovery) throw new Error("missing recovery file");

	expect(text("a.ts")).toBe("agent recreation\n");
	expect(readFileSync(recovery, "utf8")).toBe("one\ntwo\nthree\n");
	expect(failure).toBeInstanceOf(Error);
	expect((failure as Error).message).toContain(recovery);
});

test("a byte-only side refuses a range revert and keeps the file untouched", async () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
	write("shot.png", png);
	commitAll("add image");
	const edited = new Uint8Array([...png, 0x02]);
	write("shot.png", edited);

	await expect(
		revert("shot.png", range({ start: 1, count: 1 }, { start: 1, count: 1 }), {
			originalHash: hash(png),
			modifiedHash: hash(edited),
		}),
	).rejects.toMatchObject({ code: "RANGE_INVALID" });
	expect(read("shot.png")).toEqual(edited);

	await revert(
		"shot.png",
		{ kind: "file" },
		{
			originalHash: hash(png),
			modifiedHash: hash(edited),
		},
	);
	expect(read("shot.png")).toEqual(png);
});

test("a span outside either side is RANGE_INVALID", async () => {
	write("a.ts", "one\nTWO\nthree\n");
	const expectation = {
		originalHash: hash("one\ntwo\nthree\n"),
		modifiedHash: hash("one\nTWO\nthree\n"),
	};
	await expect(
		revert("a.ts", range({ start: 4, count: 1 }, { start: 2, count: 1 }), expectation),
	).rejects.toMatchObject({ code: "RANGE_INVALID" });
	await expect(
		revert("a.ts", range({ start: 2, count: 1 }, { start: 3, count: 2 }), expectation),
	).rejects.toMatchObject({ code: "RANGE_INVALID" });
	expect(text("a.ts")).toBe("one\nTWO\nthree\n");
});

test("a stale hash on either side refuses the revert and writes nothing", async () => {
	write("a.ts", "one\nTWO\nthree\n");
	await expect(
		revert("a.ts", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
			originalHash: hash("one\ntwo\nthree\n"),
			modifiedHash: hash("what the client last saw\n"),
		}),
	).rejects.toMatchObject({ code: "STALE_VIEW" });
	await expect(
		revert("a.ts", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
			originalHash: hash("an older base\n"),
			modifiedHash: hash("one\nTWO\nthree\n"),
		}),
	).rejects.toMatchObject({ code: "STALE_VIEW" });
	expect(text("a.ts")).toBe("one\nTWO\nthree\n");
});

test("a commit scope has no worktree side to revert", async () => {
	const sha = gitText("rev-parse", "HEAD");
	write("a.ts", "one\nTWO\nthree\n");
	await expect(
		revert(
			"a.ts",
			{ kind: "file" },
			{ originalHash: null, modifiedHash: null },
			{ kind: "commit", sha },
		),
	).rejects.toMatchObject({ code: "SCOPE_IMMUTABLE" });
	expect(text("a.ts")).toBe("one\nTWO\nthree\n");
});

test("undo restores the byte-exact pre-revert content and its receipt redoes the revert", async () => {
	const edited = "one\nTWO\nthree\n";
	write("a.ts", edited);
	const reverted = await revert("a.ts", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
		originalHash: hash("one\ntwo\nthree\n"),
		modifiedHash: hash(edited),
	});

	const undone = await undoChange({
		workspaceId,
		receiptId: reverted.id,
		expect: { modifiedHash: hash("one\ntwo\nthree\n") },
	});
	expect(text("a.ts")).toBe(edited);
	expect(undone.kind).toBe("undo");
	expect(undone.after.hash).toBe(hash(edited));

	const redone = await undoChange({
		workspaceId,
		receiptId: undone.id,
		expect: { modifiedHash: hash(edited) },
	});
	expect(text("a.ts")).toBe("one\ntwo\nthree\n");
	expect(redone.kind).toBe("undo");

	await expect(
		undoChange({
			workspaceId,
			receiptId: reverted.id,
			expect: { modifiedHash: hash("one\ntwo\nthree\n") },
		}),
	).rejects.toMatchObject({ code: "RECEIPT_UNKNOWN" });
});

test("undo of a trashed file writes the bytes back instead of un-trashing", async () => {
	write("new.txt", "fresh\n");
	const reverted = await revert(
		"new.txt",
		{ kind: "file" },
		{
			originalHash: null,
			modifiedHash: hash("fresh\n"),
		},
	);
	const undone = await undoChange({
		workspaceId,
		receiptId: reverted.id,
		expect: { modifiedHash: null },
	});
	expect(text("new.txt")).toBe("fresh\n");
	expect(undone.trashed).toBeUndefined();

	const redone = await undoChange({
		workspaceId,
		receiptId: undone.id,
		expect: { modifiedHash: hash("fresh\n") },
	});
	expect(existsSync(join(repo, "new.txt"))).toBe(false);
	expectTrashClaim(redone.trashed);
});

test("a write landing while undo trashes its claim survives and the undo receipt restores prior bytes", async () => {
	rmSync(join(repo, "a.ts"));
	const restored = await revert(
		"a.ts",
		{ kind: "file" },
		{
			originalHash: hash("one\ntwo\nthree\n"),
			modifiedHash: null,
		},
	);
	let enteredTrash!: () => void;
	let releaseTrash!: () => void;
	const entered = new Promise<void>((resolve) => {
		enteredTrash = resolve;
	});
	const released = new Promise<void>((resolve) => {
		releaseTrash = resolve;
	});
	let claimed = "";
	setTrashImplementationForTests(async (input) => {
		claimed = typeof input === "string" ? input : (input[0] ?? "");
		enteredTrash();
		await released;
		rmSync(claimed, { force: true });
	});

	const pending = undoChange({
		workspaceId,
		receiptId: restored.id,
		expect: { modifiedHash: hash("one\ntwo\nthree\n") },
	});
	await entered;
	expectTrashClaim(claimed);
	expect(existsSync(join(repo, "a.ts"))).toBe(false);
	write("a.ts", "agent write\n");
	releaseTrash();
	const undone = await pending;

	expect(text("a.ts")).toBe("agent write\n");
	expect(undone.trashed).toBe(claimed);
	await undoChange({
		workspaceId,
		receiptId: undone.id,
		expect: { modifiedHash: hash("agent write\n") },
	});
	expect(text("a.ts")).toBe("one\ntwo\nthree\n");
});

test("a failed inverse leaves its receipt available for retry", async () => {
	rmSync(join(repo, "a.ts"));
	const restored = await revert(
		"a.ts",
		{ kind: "file" },
		{
			originalHash: hash("one\ntwo\nthree\n"),
			modifiedHash: null,
		},
	);
	setTrashImplementationForTests(async () => {
		throw new Error("trash unavailable");
	});
	await expect(
		undoChange({
			workspaceId,
			receiptId: restored.id,
			expect: { modifiedHash: hash("one\ntwo\nthree\n") },
		}),
	).rejects.toThrow("trash unavailable");
	expect(text("a.ts")).toBe("one\ntwo\nthree\n");

	setTrashImplementationForTests(async (input) => {
		const path = typeof input === "string" ? input : (input[0] ?? "");
		rmSync(path, { force: true });
	});
	await undoChange({
		workspaceId,
		receiptId: restored.id,
		expect: { modifiedHash: hash("one\ntwo\nthree\n") },
	});
	expect(existsSync(join(repo, "a.ts"))).toBe(false);
});

test("change paths cannot traverse .git or a symlink escaping the worktree", async () => {
	const outside = join(dataDir, "outside.txt");
	writeFileSync(outside, "outside\n");
	symlinkSync(outside, join(repo, "linked.txt"));

	await expect(
		revert("linked.txt", { kind: "file" }, { originalHash: null, modifiedHash: null }),
	).rejects.toMatchObject({ code: "UNSUPPORTED_CHANGE" });
	await expect(
		revert(".git/config", { kind: "file" }, { originalHash: null, modifiedHash: null }),
	).rejects.toThrow(".git");
	expect(readFileSync(outside, "utf8")).toBe("outside\n");
});

test("undo refuses a worktree that moved since the change, and the receipt stays usable", async () => {
	write("a.ts", "one\nTWO\nthree\n");
	const reverted = await revert(
		"a.ts",
		{ kind: "file" },
		{
			originalHash: hash("one\ntwo\nthree\n"),
			modifiedHash: hash("one\nTWO\nthree\n"),
		},
	);
	write("a.ts", "the agent wrote this\n");

	await expect(
		undoChange({
			workspaceId,
			receiptId: reverted.id,
			expect: { modifiedHash: hash("one\ntwo\nthree\n") },
		}),
	).rejects.toMatchObject({ code: "STALE_VIEW" });
	expect(text("a.ts")).toBe("the agent wrote this\n");

	const undone = await undoChange({
		workspaceId,
		receiptId: reverted.id,
		expect: { modifiedHash: hash("the agent wrote this\n") },
	});
	expect(text("a.ts")).toBe("one\nTWO\nthree\n");
	expect(undone.kind).toBe("undo");
});

test("the receipt ring keeps the newest 20 per workspace", async () => {
	const receipts: ChangeReceipt[] = [];
	for (let index = 0; index < 21; index++) {
		write("a.ts", `one\nTWO ${index}\nthree\n`);
		receipts.push(
			await revert("a.ts", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
				originalHash: hash("one\ntwo\nthree\n"),
				modifiedHash: hash(`one\nTWO ${index}\nthree\n`),
			}),
		);
	}
	const oldest = receipts[0] as ChangeReceipt;
	const newest = receipts[20] as ChangeReceipt;
	await expect(
		undoChange({
			workspaceId,
			receiptId: oldest.id,
			expect: { modifiedHash: hash("one\ntwo\nthree\n") },
		}),
	).rejects.toMatchObject({ code: "RECEIPT_UNKNOWN" });
	const undone = await undoChange({
		workspaceId,
		receiptId: newest.id,
		expect: { modifiedHash: hash("one\ntwo\nthree\n") },
	});
	expect(text("a.ts")).toBe("one\nTWO 20\nthree\n");
	expect(undone.kind).toBe("undo");
});

test("the original side is read at the range's resolved oid, not the moving ref", async () => {
	write("a.ts", "one\nTWO\nthree\n");
	const head = gitText("rev-parse", "HEAD");
	expect(new TextDecoder().decode(blobAt(head, "a.ts"))).toBe("one\ntwo\nthree\n");
	commitAll("land the edit");
	write("a.ts", "one\nTWO\nTHREE\n");

	await revert("a.ts", range({ start: 2, count: 1 }, { start: 2, count: 1 }), {
		originalHash: hash("one\nTWO\nthree\n"),
		modifiedHash: hash("one\nTWO\nTHREE\n"),
	});
	expect(text("a.ts")).toBe("one\nTWO\nTHREE\n");
});
