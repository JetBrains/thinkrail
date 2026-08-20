import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatCrashRecord } from "./crashLog";

const AT = new Date("2026-08-16T18:22:03.911Z");

test("a record names the fault, the build and the uptime, and keeps the stack", () => {
	const error = new Error("provider stream died");
	error.stack = "Error: provider stream died\n    at stream (pi.js:1:1)";
	const record = formatCrashRecord("uncaughtException", error, AT, 11_523.4, "0.4.1");
	expect(record).toBe(
		"[2026-08-16T18:22:03.911Z] uncaughtException (thinkrail 0.4.1, up 11523s)\n" +
			"Error: provider stream died\n    at stream (pi.js:1:1)\n\n",
	);
});

test("a run from source says so, and a stack-less throw still reports what it was", () => {
	const record = formatCrashRecord("unhandledRejection", "just a string", AT, 2);
	expect(record).toContain("unhandledRejection (thinkrail source, up 2s)");
	expect(record).toContain("Non-Error thrown: just a string");
});

test("a value that resists rendering is still reported", () => {
	const cyclic: { self?: unknown } = {};
	cyclic.self = cyclic;
	expect(formatCrashRecord("uncaughtException", cyclic, AT, 1)).toContain("Unrenderable throw:");
	expect(formatCrashRecord("unhandledRejection", { big: 1n }, AT, 1)).toContain(
		"Unrenderable throw:",
	);

	const badStack = new Error("hostile");
	Object.defineProperty(badStack, "stack", {
		get() {
			throw new Error("no stack for you");
		},
	});
	expect(formatCrashRecord("uncaughtException", badStack, AT, 1)).toContain(
		"Unrenderable throw: Error: hostile",
	);

	const noProto = Object.assign(Object.create(null), { big: 1n }) as object;
	expect(formatCrashRecord("uncaughtException", noProto, AT, 1)).toContain(
		"Unrenderable throw (object)",
	);

	const proxyStack = new Error("proxy stack");
	const revocable = Proxy.revocable({}, {});
	revocable.revoke();
	Object.defineProperty(proxyStack, "stack", { value: revocable.proxy });
	expect(formatCrashRecord("uncaughtException", proxyStack, AT, 1)).toContain("Error: proxy stack");

	const { proxy, revoke } = Proxy.revocable({}, {});
	revoke();
	expect(formatCrashRecord("unhandledRejection", proxy, AT, 1)).toContain(
		"Unrenderable throw (object)",
	);
});

const dirs: string[] = [];

afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function runCrashing(
	body: string,
): Promise<{ exitCode: number; stderr: string; log: string }> {
	const dir = mkdtempSync(join(tmpdir(), "trpi-crashlog-"));
	dirs.push(dir);
	const script = join(dir, "boom.ts");
	writeFileSync(
		script,
		`import { installCrashLog } from ${JSON.stringify(join(import.meta.dir, "crashLog.ts"))};\n` +
			`installCrashLog("9.9.9-test");\n${body}\n` +
			`setInterval(() => {}, 1_000);\n`,
	);
	const proc = Bun.spawn([process.execPath, script], {
		env: { ...process.env, NODE_ENV: "production", THINKRAIL_DATA_DIR: dir },
		stdout: "ignore",
		stderr: "pipe",
	});
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	return { exitCode, stderr, log: readFileSync(join(dir, "logs", "crash.log"), "utf8") };
}

test("an uncaught exception is written to the crash log, echoed to stderr, and still fatal", async () => {
	const { exitCode, stderr, log } = await runCrashing(
		`setTimeout(() => { throw new Error("boom from the agent"); }, 0);`,
	);
	expect(exitCode).toBe(1);
	expect(log).toContain("uncaughtException (thinkrail 9.9.9-test");
	expect(log).toContain("boom from the agent");
	expect(stderr).toContain("boom from the agent");
	expect(stderr).toContain("wrote crash report to");
});

test("an unhandled rejection is recorded the same way", async () => {
	const { exitCode, log } = await runCrashing(
		`setTimeout(() => { void Promise.reject(new Error("rejected mid-turn")); }, 0);`,
	);
	expect(exitCode).toBe(1);
	expect(log).toContain("unhandledRejection (thinkrail 9.9.9-test");
	expect(log).toContain("rejected mid-turn");
});

test("a test runner's own process is left alone — it reports faults itself", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-crashlog-"));
	dirs.push(dir);
	const script = join(dir, "boom.ts");
	writeFileSync(
		script,
		`import { installCrashLog } from ${JSON.stringify(join(import.meta.dir, "crashLog.ts"))};\n` +
			`installCrashLog("9.9.9-test");\n` +
			`process.stderr.write(String(process.listenerCount("uncaughtException")));\n`,
	);
	const proc = Bun.spawn([process.execPath, script], {
		env: { ...process.env, NODE_ENV: "test", THINKRAIL_DATA_DIR: dir },
		stdout: "ignore",
		stderr: "pipe",
	});
	expect(await new Response(proc.stderr).text()).toBe("0");
	expect(await proc.exited).toBe(0);
});
