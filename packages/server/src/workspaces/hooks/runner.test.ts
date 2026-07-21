import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShellCommand } from "./runner";

/** True if a process with this pid currently exists (checked via `ps`, portable across macOS/Linux). */
function isProcessAlive(pid: number): boolean {
	return Bun.spawnSync(["ps", "-p", String(pid)]).exitCode === 0;
}

test("runShellCommand reports ok:true and exitCode 0 for a successful command", async () => {
	const result = await runShellCommand({ command: "true", cwd: tmpdir(), env: {} });
	expect(result).toEqual({ ok: true, exitCode: 0, timedOut: false });
});

test("runShellCommand reports ok:false and the real exit code for a failing command", async () => {
	const result = await runShellCommand({ command: "exit 7", cwd: tmpdir(), env: {} });
	expect(result.ok).toBe(false);
	expect(result.exitCode).toBe(7);
	expect(result.timedOut).toBe(false);
});

test("runShellCommand streams stdout chunks via onChunk", async () => {
	const chunks: Array<{ stream: string; chunk: string }> = [];
	await runShellCommand({
		command: "echo hello",
		cwd: tmpdir(),
		env: {},
		onChunk: (stream, chunk) => chunks.push({ stream, chunk }),
	});
	const stdout = chunks
		.filter((c) => c.stream === "stdout")
		.map((c) => c.chunk)
		.join("");
	expect(stdout).toBe("hello\n");
});

test("runShellCommand runs in the given cwd", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-runner-test-"));
	try {
		await runShellCommand({ command: "touch marker.txt", cwd: dir, env: {} });
		expect(existsSync(join(dir, "marker.txt"))).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runShellCommand marks timedOut and kills a command that overruns timeoutMs", async () => {
	const result = await runShellCommand({
		command: "sleep 5",
		cwd: tmpdir(),
		env: {},
		timeoutMs: 50,
	});
	expect(result.ok).toBe(false);
	expect(result.timedOut).toBe(true);
});

test("runShellCommand kills the whole process tree, not just the shell, when a compound command overruns timeoutMs", async () => {
	// This command forks a real descendant (the backgrounded `sleep 5`) distinct from the "sh -c ..."
	// process the runner spawns: `sh` must fork here (rather than exec-replacing itself) because it has
	// more work to do (the `wait`) after starting the background job. `$!` captures that descendant's
	// real pid so the test can check on it directly, independent of whatever pid `sh` itself has.
	const dir = mkdtempSync(join(tmpdir(), "trpi-runner-test-"));
	const pidFile = join(dir, "descendant.pid");
	try {
		// The whole point of timeoutMs is a bounded-execution guarantee: runShellCommand must return
		// promptly once the timeout fires. Race it against a generous-but-bounded window (well past the
		// 100ms timeoutMs, but well short of the leaked descendant's 5s sleep) — if the runner is stuck
		// waiting for an orphaned descendant to close inherited stdout/stderr pipes, this fails fast
		// instead of the whole test hanging for ~5s.
		const BOUND_MS = 2000;
		const boundExceeded = Symbol("bound-exceeded");
		const raced = await Promise.race([
			runShellCommand({
				command: `sleep 5 & echo $! > ${pidFile}; wait`,
				cwd: dir,
				env: {},
				timeoutMs: 100,
			}),
			new Promise((resolve) => setTimeout(() => resolve(boundExceeded), BOUND_MS)),
		]);
		expect(raced).not.toBe(boundExceeded);
		const result = raced as Awaited<ReturnType<typeof runShellCommand>>;
		expect(result.ok).toBe(false);
		expect(result.timedOut).toBe(true);

		expect(existsSync(pidFile)).toBe(true);
		const descendantPid = Number(readFileSync(pidFile, "utf8").trim());
		expect(Number.isInteger(descendantPid)).toBe(true);

		// Give the OS a brief moment to finish tearing down the signaled descendant.
		await Bun.sleep(200);
		expect(isProcessAlive(descendantPid)).toBe(false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 10000);
