import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import * as subprocess from "../subprocess";
import { resolveDiffRange } from "./diffScope";

const posix = test.skipIf(process.platform === "win32");
const realRunBounded = subprocess.runBounded;
let asyncDeadlineMs: number | null = null;

mock.module("../subprocess", () => ({
	...subprocess,
	runBounded: (argv: string[], opts: subprocess.BoundedRunOptions) =>
		realRunBounded(argv, asyncDeadlineMs === null ? opts : { ...opts, timeoutMs: asyncDeadlineMs }),
}));

let dir: string;
const savedPath = process.env.PATH;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "trpi-diffscope-timeout-"));
});

afterEach(() => {
	asyncDeadlineMs = null;
	if (savedPath === undefined) delete process.env.PATH;
	else process.env.PATH = savedPath;
	rmSync(dir, { recursive: true, force: true });
});

posix("the async HEAD probe throws GIT_TIMEOUT instead of reporting no commit", async () => {
	const bin = join(dir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "git"), "#!/bin/sh\nsleep 30\n");
	chmodSync(join(bin, "git"), 0o755);
	process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
	asyncDeadlineMs = 300;

	const ws = { baseBranch: "main", worktreePath: dir };
	await expect(resolveDiffRange(ws, { kind: "uncommitted" })).rejects.toMatchObject({
		code: "GIT_TIMEOUT",
	});
});

posix("a stalled HEAD probe is never read as an unborn HEAD", async () => {
	const executable = Bun.which("git");
	if (!executable) throw new Error("git not found");
	const repo = join(dir, "repo");
	mkdirSync(repo);
	const run = (...args: string[]) => Bun.spawnSync([executable, "-C", repo, ...args]).success;
	expect(run("init", "-b", "main")).toBe(true);
	expect(
		run(
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--allow-empty",
			"-m",
			"init",
		),
	).toBe(true);
	const bin = join(dir, "bin");
	mkdirSync(bin);
	writeFileSync(
		join(bin, "git"),
		`#!/bin/sh\ncase " $* " in *" HEAD^{commit} "*) sleep 30;; esac\nexec ${JSON.stringify(executable)} "$@"\n`,
	);
	chmodSync(join(bin, "git"), 0o755);
	process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
	asyncDeadlineMs = 300;

	const ws = { baseBranch: "main", diffBase: "missing", worktreePath: repo };
	for (const scope of [{ kind: "branch" }, { kind: "uncommitted" }] as const)
		await expect(resolveDiffRange(ws, scope)).rejects.toMatchObject({ code: "GIT_TIMEOUT" });
});
