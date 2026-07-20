import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShellCommand } from "./runner";

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
