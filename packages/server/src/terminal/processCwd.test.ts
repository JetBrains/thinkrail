import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createWorkingDirectoryCache,
	foregroundPid,
	type ProcessTable,
	parseLsofCwd,
	processWorkingDirectories,
	systemProcessTable,
} from "./processCwd";

function table(
	children: Record<number, number[] | null>,
	cwds: Record<number, string | null> = {},
): ProcessTable {
	return {
		children: (pid) => (pid in children ? (children[pid] ?? null) : []),
		cwd: (pid) => cwds[pid] ?? null,
	};
}

describe("parseLsofCwd", () => {
	test("reads the name record of lsof's field output", () => {
		expect(parseLsofCwd("p4242\nfcwd\nn/Users/me/proj/sub\n")).toBe("/Users/me/proj/sub");
	});

	test("keeps spaces and colons that are part of the directory", () => {
		expect(parseLsofCwd("p1\nfcwd\nn/tmp/a dir:with colon\n")).toBe("/tmp/a dir:with colon");
	});

	test("no name record, or an empty one, is no answer", () => {
		expect(parseLsofCwd("")).toBeNull();
		expect(parseLsofCwd("p1\nfcwd\n")).toBeNull();
		expect(parseLsofCwd("p1\nfcwd\nn\n")).toBeNull();
	});

	test("a relative name is not a usable cwd", () => {
		expect(parseLsofCwd("p1\nfcwd\nnrelative/dir\n")).toBeNull();
	});
});

describe("foregroundPid", () => {
	test("a shell running nothing is its own foreground", () => {
		expect(foregroundPid(100, table({}))).toBe(100);
	});

	test("follows the newest child down to the deepest descendant", () => {
		const walk = table({ 100: [140, 120], 140: [141], 120: [121, 122], 141: [] });
		expect(foregroundPid(100, walk)).toBe(141);
	});

	test("an unanswerable child list stops the walk where it is", () => {
		expect(foregroundPid(100, table({ 100: [140], 140: null }))).toBe(140);
		expect(foregroundPid(100, table({ 100: null }))).toBe(100);
	});

	test("a cycle or a runaway chain is bounded", () => {
		expect(foregroundPid(100, table({ 100: [200], 200: [100] }))).toBeGreaterThan(0);
		const chain: Record<number, number[]> = {};
		for (let pid = 1; pid < 100; pid += 1) chain[pid] = [pid + 1];
		expect(foregroundPid(1, table(chain))).toBe(17);
	});
});

describe("processWorkingDirectories", () => {
	test("names the foreground program's cwd before the shell's", () => {
		const walk = table({ 100: [140] }, { 100: "/w", 140: "/w/sub" });
		expect(processWorkingDirectories(100, walk)).toEqual(["/w/sub", "/w"]);
	});

	test("a shell running nothing answers its own cwd once", () => {
		expect(processWorkingDirectories(100, table({}, { 100: "/w" }))).toEqual(["/w"]);
	});

	test("the same directory twice is listed once", () => {
		const walk = table({ 100: [140] }, { 100: "/w", 140: "/w" });
		expect(processWorkingDirectories(100, walk)).toEqual(["/w"]);
	});

	test("unanswerable cwds are dropped rather than guessed", () => {
		expect(processWorkingDirectories(100, table({ 100: [140] }, { 100: "/w" }))).toEqual(["/w"]);
		expect(processWorkingDirectories(100, table({ 100: [140] }))).toEqual([]);
	});

	test("an implausible pid has no directories", () => {
		expect(processWorkingDirectories(0, table({}, { 0: "/w" }))).toEqual([]);
		expect(processWorkingDirectories(Number.NaN, table({}))).toEqual([]);
	});
});

describe("createWorkingDirectoryCache", () => {
	test("answers from the cache inside the window and asks again after it", () => {
		let now = 1_000;
		const asked: number[] = [];
		const cwds = createWorkingDirectoryCache({
			ttlMs: 1_000,
			now: () => now,
			lookup: (pid) => {
				asked.push(pid);
				return [`/w/${asked.length}`];
			},
		});
		expect(cwds(7)).toEqual(["/w/1"]);
		now += 999;
		expect(cwds(7)).toEqual(["/w/1"]);
		expect(cwds(8)).toEqual(["/w/2"]);
		now += 1;
		expect(cwds(7)).toEqual(["/w/3"]);
		expect(asked).toEqual([7, 8, 7]);
	});
});

const unixTest = process.platform === "win32" ? test.skip : test;

unixTest("the system table finds a real child's directory before its shell's", async () => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "trpi-cwd-")));
	const sub = join(base, "sub");
	mkdirSync(sub);
	const shell = Bun.spawn(["sh", "-c", "(cd sub && exec sleep 30); :"], {
		cwd: base,
		stdout: "ignore",
		stderr: "ignore",
	});
	try {
		const deadline = Date.now() + 5_000;
		let cwds: string[] = [];
		while (Date.now() < deadline) {
			cwds = processWorkingDirectories(shell.pid, systemProcessTable());
			if (cwds.length === 2) break;
			await Bun.sleep(50);
		}
		expect(cwds).toEqual([sub, base]);
	} finally {
		shell.kill();
		rmSync(base, { recursive: true, force: true });
	}
});
