import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createWorkingDirectoryCache,
	foregroundPid,
	type ProcessTable,
	parseLsofCwds,
	parseProcessTable,
	processWorkingDirectories,
	type RunTool,
	runSystemTool,
	systemProcessTable,
	type ToolRun,
} from "./processCwd";

function table(
	children: Record<number, number[] | null>,
	cwds: Record<number, string> = {},
): ProcessTable {
	return {
		children: async (pid) => (pid in children ? (children[pid] ?? null) : []),
		cwds: async (pids) =>
			new Map(pids.flatMap((pid) => (cwds[pid] === undefined ? [] : [[pid, cwds[pid]] as const]))),
	};
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

describe("parseLsofCwds", () => {
	test("pairs each pid record with its name record", () => {
		expect(parseLsofCwds("p41\nfcwd\nn/w/sub\np40\nfcwd\nn/w\n")).toEqual(
			new Map([
				[41, "/w/sub"],
				[40, "/w"],
			]),
		);
	});

	test("keeps spaces and colons that are part of the directory", () => {
		expect(parseLsofCwds("p1\nfcwd\nn/tmp/a dir:with colon\n").get(1)).toBe(
			"/tmp/a dir:with colon",
		);
	});

	test("missing, empty, relative or orphaned names are no answer", () => {
		expect(parseLsofCwds("").size).toBe(0);
		expect(parseLsofCwds("p1\nfcwd\n").size).toBe(0);
		expect(parseLsofCwds("p1\nfcwd\nn\n").size).toBe(0);
		expect(parseLsofCwds("p1\nfcwd\nnrelative/dir\n").size).toBe(0);
		expect(parseLsofCwds("n/no/pid/yet\npjunk\nn/still/none\n").size).toBe(0);
	});
});

describe("parseProcessTable", () => {
	test("indexes ps pid/ppid rows by parent", () => {
		const parsed = parseProcessTable("    1     0\n  100     1\n  140   100\n  120   100\n\n");
		expect(parsed.get(100)).toEqual([140, 120]);
		expect(parsed.get(1)).toEqual([100]);
		expect(parsed.get(140)).toBeUndefined();
	});

	test("rows that are not two pids are skipped", () => {
		expect(parseProcessTable("PID PPID\nabc\n7\n").size).toBe(0);
	});
});

describe("foregroundPid", () => {
	test("a shell running nothing is its own foreground", async () => {
		expect(await foregroundPid(100, table({}).children)).toBe(100);
	});

	test("follows the newest child down to the deepest descendant", async () => {
		const walk = table({ 100: [140, 120], 140: [141], 120: [121, 122], 141: [] });
		expect(await foregroundPid(100, walk.children)).toBe(141);
	});

	test("an unanswerable child list stops the walk where it is", async () => {
		expect(await foregroundPid(100, table({ 100: [140], 140: null }).children)).toBe(140);
		expect(await foregroundPid(100, table({ 100: null }).children)).toBe(100);
	});

	test("a cycle or a runaway chain is bounded", async () => {
		expect(await foregroundPid(100, table({ 100: [200], 200: [100] }).children)).toBe(200);
		const chain: Record<number, number[]> = {};
		for (let pid = 1; pid < 100; pid += 1) chain[pid] = [pid + 1];
		expect(await foregroundPid(1, table(chain).children)).toBe(17);
	});
});

describe("processWorkingDirectories", () => {
	test("names the foreground program's cwd before the shell's", async () => {
		const walk = table({ 100: [140] }, { 100: "/w", 140: "/w/sub" });
		expect(await processWorkingDirectories(100, walk)).toEqual(["/w/sub", "/w"]);
	});

	test("a shell running nothing answers its own cwd once", async () => {
		expect(await processWorkingDirectories(100, table({}, { 100: "/w" }))).toEqual(["/w"]);
	});

	test("the same directory twice is listed once", async () => {
		const walk = table({ 100: [140] }, { 100: "/w", 140: "/w" });
		expect(await processWorkingDirectories(100, walk)).toEqual(["/w"]);
	});

	test("unanswerable cwds are dropped rather than guessed", async () => {
		expect(await processWorkingDirectories(100, table({ 100: [140] }, { 100: "/w" }))).toEqual([
			"/w",
		]);
		expect(await processWorkingDirectories(100, table({ 100: [140] }))).toEqual([]);
	});

	test("an implausible pid has no directories", async () => {
		expect(await processWorkingDirectories(0, table({}, { 0: "/w" }))).toEqual([]);
		expect(await processWorkingDirectories(Number.NaN, table({}))).toEqual([]);
	});
});

describe("systemProcessTable on macOS", () => {
	const ok = (stdout: string, exitCode = 0): ToolRun => ({ stdout, exitCode, timedOut: false });

	function fakeTools(answers: Record<string, ToolRun | null>) {
		const calls: string[][] = [];
		const run: RunTool = async (argv) => {
			calls.push([...argv]);
			return answers[argv[0] ?? ""] ?? null;
		};
		return { calls, run };
	}

	test("one ps snapshot and one lsof call cover a deep tree", async () => {
		const tools = fakeTools({
			ps: ok("100 1\n110 100\n120 110\n130 120\n140 130\n150 140\n"),
			lsof: ok("p150\nfcwd\nn/w/pkg\np100\nfcwd\nn/w\n", 1),
		});
		const cwds = await processWorkingDirectories(100, systemProcessTable("darwin", tools.run));
		expect(cwds).toEqual(["/w/pkg", "/w"]);
		expect(tools.calls).toEqual([
			["ps", "-A", "-o", "pid=,ppid="],
			["lsof", "-b", "-w", "-a", "-d", "cwd", "-Fpn", "-p", "150,100"],
		]);
	});

	test("a failed snapshot still answers the shell's own cwd", async () => {
		const tools = fakeTools({ ps: null, lsof: ok("p100\nfcwd\nn/w\n") });
		expect(await processWorkingDirectories(100, systemProcessTable("darwin", tools.run))).toEqual([
			"/w",
		]);
	});

	test("a timed-out probe answers nothing, leaving the worktree root", async () => {
		const timedOut: ToolRun = { stdout: "p100\nfcwd\nn/w\n", exitCode: null, timedOut: true };
		const tools = fakeTools({ ps: timedOut, lsof: timedOut });
		expect(await processWorkingDirectories(100, systemProcessTable("darwin", tools.run))).toEqual(
			[],
		);
	});

	test("Windows asks nothing", async () => {
		const tools = fakeTools({});
		expect(await processWorkingDirectories(100, systemProcessTable("win32", tools.run))).toEqual(
			[],
		);
		expect(tools.calls).toEqual([]);
	});
});

describe("createWorkingDirectoryCache", () => {
	test("concurrent asks for one shell share a single probe", async () => {
		const probe = deferred<string[]>();
		let probes = 0;
		const cwds = createWorkingDirectoryCache({
			ttlMs: 1_000,
			lookup: () => {
				probes += 1;
				return probe.promise;
			},
		});
		const first = cwds(7);
		const second = cwds(7);
		await Bun.sleep(0);
		expect(probes).toBe(1);
		probe.resolve(["/w"]);
		expect(await Promise.all([first, second])).toEqual([["/w"], ["/w"]]);
	});

	test("answers are reused for the window after the probe settles, then asked again", async () => {
		let now = 1_000;
		const asked: number[] = [];
		const cwds = createWorkingDirectoryCache({
			ttlMs: 1_000,
			now: () => now,
			lookup: async (pid) => {
				asked.push(pid);
				return [`/w/${asked.length}`];
			},
		});
		expect(await cwds(7)).toEqual(["/w/1"]);
		now += 999;
		expect(await cwds(7)).toEqual(["/w/1"]);
		expect(await cwds(8)).toEqual(["/w/2"]);
		now += 1;
		expect(await cwds(7)).toEqual(["/w/3"]);
		expect(asked).toEqual([7, 8, 7]);
	});

	test("a slow probe is not expired while it is still running", async () => {
		let now = 0;
		const probe = deferred<string[]>();
		let probes = 0;
		const cwds = createWorkingDirectoryCache({
			ttlMs: 10,
			now: () => now,
			lookup: () => {
				probes += 1;
				return probe.promise;
			},
		});
		const first = cwds(7);
		now = 500;
		const second = cwds(7);
		probe.resolve(["/w"]);
		expect(await second).toEqual(["/w"]);
		expect(await first).toEqual(["/w"]);
		expect(probes).toBe(1);
	});

	test("a failing probe answers no directories", async () => {
		const cwds = createWorkingDirectoryCache({
			ttlMs: 1_000,
			lookup: () => Promise.reject(new Error("ps exploded")),
		});
		expect(await cwds(7)).toEqual([]);
	});
});

const unixTest = process.platform === "win32" ? test.skip : test;

unixTest("a system tool that overruns its timeout is killed and reported", async () => {
	const started = performance.now();
	const run = await runSystemTool(["sleep", "5"], 100);
	expect(run?.timedOut).toBe(true);
	expect(performance.now() - started).toBeLessThan(2_000);
	expect(await runSystemTool(["no-such-tool-thinkrail"], 100)).toBeNull();
});

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
			cwds = await processWorkingDirectories(shell.pid, systemProcessTable());
			if (cwds.length === 2) break;
			await Bun.sleep(50);
		}
		expect(cwds).toEqual([sub, base]);
	} finally {
		shell.kill();
		rmSync(base, { recursive: true, force: true });
	}
});
