import { afterAll, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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

test("structured credentials are redacted at any depth without changing the thrown value", () => {
	const error = {
		message: "provider stream died",
		code: "ECONNRESET",
		password: "synthetic-password",
		request: {
			headers: { Authorization: "Bearer synthetic-bearer", Cookie: "session=synthetic-cookie" },
			api_key: "synthetic-api-key",
			credentials: { username: "synthetic-user", password: "synthetic-nested-password" },
		},
		attempts: [{ accessToken: "synthetic-access", refresh_token: "synthetic-refresh" }],
		OPENAI_API_KEY: "synthetic-env-key",
		AWS_SECRET_ACCESS_KEY: "synthetic-access-key",
		client: { secret_key: "synthetic-secret-key", pwd: "synthetic-pwd" },
		tokenCount: 42,
	};
	const before = JSON.stringify(error);
	const record = formatCrashRecord("unhandledRejection", error, AT, 1);
	expect(record).not.toContain("synthetic-");
	expect(record).toContain("[REDACTED]");
	expect(record).toContain("provider stream died");
	expect(record).toContain("ECONNRESET");
	expect(record).toContain('"tokenCount":42');
	expect(JSON.stringify(error)).toBe(before);
});

test.each([
	"Authorization: Bearer synthetic-header-secret",
	'authorization="Basic c3ludGhldGljOnNlY3JldA=="',
	"Bearer synthetic-bare-secret",
	'api_key="synthetic-quoted\\"secret"',
	"password='synthetic secret with spaces'",
	"GITHUB_TOKEN=synthetic-env-secret",
	"secret_key=synthetic-format-key",
	"Cookie: session=synthetic-session; refresh=synthetic-refresh",
	"https://synthetic-user:synthetic-password@example.invalid/path?access_token=synthetic-query",
	"-----BEGIN PRIVATE KEY-----\nsynthetic-private-key\n-----END PRIVATE KEY-----",
])("error stacks redact recognizable credential text: %s", (detail) => {
	const error = new Error("provider rejected credentials");
	error.stack = `Error: ${detail}\n    at stream (pi.js:1:1)`;
	const record = formatCrashRecord("uncaughtException", error, AT, 1);
	expect(record).not.toContain("synthetic");
	expect(record).not.toContain("c3ludGhldGljOnNlY3JldA==");
	expect(record).toContain("[REDACTED]");
	expect(record).toContain("at stream (pi.js:1:1)");
});

test("record size is bounded in UTF-8 bytes after redaction without splitting a character", () => {
	const record = formatCrashRecord(
		"unhandledRejection",
		{ token: "synthetic-secret", detail: "汉🙂".repeat(100_000) },
		AT,
		1,
	);
	expect(Buffer.byteLength(record)).toBeLessThanOrEqual(64 * 1024);
	expect(record).toContain("unhandledRejection (thinkrail source");
	expect(record).toContain("[crash report truncated]");
	expect(record).not.toContain("synthetic-secret");
	expect(record).not.toContain("\uFFFD");
});

const dirs: string[] = [];

afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function runCrashing(
	body: string,
	prepare?: (dir: string) => void,
): Promise<{ exitCode: number; stderr: string; log: string; dir: string }> {
	const dir = mkdtempSync(join(tmpdir(), "trpi-crashlog-"));
	dirs.push(dir);
	prepare?.(dir);
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
	const timeout = setTimeout(() => proc.kill("SIGKILL"), 4_000);
	try {
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;
		const path = join(dir, "logs", "crash.log");
		const log = existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : "";
		return { exitCode, stderr, log, dir };
	} finally {
		clearTimeout(timeout);
	}
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

test.skipIf(process.platform === "win32")(
	"new crash paths are private even with umask 000",
	async () => {
		const { exitCode, dir } = await runCrashing(
			`process.umask(0); setTimeout(() => { throw new Error("private report"); }, 0);`,
		);
		expect(exitCode).toBe(1);
		expect(statSync(join(dir, "logs")).mode & 0o777).toBe(0o700);
		expect(statSync(join(dir, "logs", "crash.log")).mode & 0o777).toBe(0o600);
	},
);

test.skipIf(process.platform === "win32")(
	"reusing a permissive report tightens it and preserves earlier records",
	async () => {
		const { exitCode, dir, log } = await runCrashing(
			`setTimeout(() => { throw new Error("next private report"); }, 0);`,
			(dir) => {
				mkdirSync(join(dir, "logs"));
				chmodSync(join(dir, "logs"), 0o755);
				writeFileSync(join(dir, "logs", "crash.log"), "previous record\n");
				chmodSync(join(dir, "logs", "crash.log"), 0o644);
			},
		);
		expect(exitCode).toBe(1);
		expect(log.startsWith("previous record\n")).toBe(true);
		expect(log).toContain("next private report");
		expect(statSync(join(dir, "logs")).mode & 0o777).toBe(0o700);
		expect(statSync(join(dir, "logs", "crash.log")).mode & 0o777).toBe(0o600);
	},
);

test("the same bounded, redacted report reaches the file and piped stderr before exit", async () => {
	const { exitCode, stderr, log } = await runCrashing(
		`setTimeout(() => { void Promise.reject({ apiKey: "synthetic-pipe-secret", detail: "x".repeat(1024 * 1024) }); }, 0);`,
	);
	expect(exitCode).toBe(1);
	expect(Buffer.byteLength(log)).toBeLessThanOrEqual(64 * 1024);
	expect(log).toContain("[crash report truncated]");
	expect(log).not.toContain("synthetic-pipe-secret");
	expect(stderr).not.toContain("synthetic-pipe-secret");
	expect(stderr.includes(log)).toBe(true);
});

test("piped stderr includes the entire record rather than only the pipe's first buffer", async () => {
	const { exitCode, stderr, log } = await runCrashing(
		`setTimeout(() => { void Promise.reject("payload:" + "a.".repeat(512 * 1024)); }, 0);`,
	);
	expect(exitCode).toBe(1);
	expect(log.length).toBeGreaterThan(32 * 1024);
	expect(stderr.includes(log)).toBe(true);
});

test("exit waits for asynchronous stderr callbacks, including a fault arriving during the flush", async () => {
	const { exitCode, stderr, log } = await runCrashing(
		`const write = process.stderr.write.bind(process.stderr);\n` +
			`process.stderr.write = (chunk, callback) => { setTimeout(() => write(chunk, callback), 60); return true; };\n` +
			`process.emit("uncaughtException", new Error("first delayed report"));\n` +
			`setTimeout(() => process.emit("unhandledRejection", "later delayed report", Promise.resolve()), 15);`,
	);
	expect(exitCode).toBe(1);
	expect(log.match(/thinkrail 9\.9\.9-test/g)).toHaveLength(2);
	const split = log.indexOf("\n\n") + 2;
	expect(stderr.includes(log.slice(0, split))).toBe(true);
	expect(stderr.includes(log.slice(split))).toBe(true);
});

test("file failures still deliver the report to stderr and terminate", async () => {
	const { exitCode, stderr, log } = await runCrashing(
		`setTimeout(() => { throw new Error("file sink unavailable"); }, 0);`,
		(dir) => writeFileSync(join(dir, "logs"), "not a directory"),
	);
	expect(exitCode).toBe(1);
	expect(log).toBe("");
	expect(stderr).toContain("file sink unavailable");
	expect(stderr).toContain("could not write the crash report");
});

test.skipIf(process.platform === "win32")(
	"a linked crash file is not written or chmodded",
	async () => {
		const { exitCode, dir, stderr } = await runCrashing(
			`setTimeout(() => { throw new Error("linked crash file"); }, 0);`,
			(dir) => {
				const target = join(dir, "unrelated.txt");
				writeFileSync(target, "leave this alone");
				chmodSync(target, 0o644);
				mkdirSync(join(dir, "logs"));
				symlinkSync(target, join(dir, "logs", "crash.log"));
			},
		);
		expect(exitCode).toBe(1);
		expect(readFileSync(join(dir, "unrelated.txt"), "utf8")).toBe("leave this alone");
		expect(statSync(join(dir, "unrelated.txt")).mode & 0o777).toBe(0o644);
		expect(stderr).toContain("could not write the crash report");
	},
);

test.skipIf(process.platform === "win32")(
	"a linked log directory is not chmodded or used",
	async () => {
		const { exitCode, dir, stderr, log } = await runCrashing(
			`setTimeout(() => { throw new Error("linked directory"); }, 0);`,
			(dir) => {
				const target = join(dir, "unrelated");
				mkdirSync(target);
				chmodSync(target, 0o755);
				symlinkSync(target, join(dir, "logs"));
			},
		);
		expect(exitCode).toBe(1);
		expect(log).toBe("");
		expect(statSync(join(dir, "unrelated")).mode & 0o777).toBe(0o755);
		expect(stderr).toContain("could not write the crash report");
	},
);

test.skipIf(process.platform === "win32")(
	"a FIFO crash path cannot block termination",
	async () => {
		const { exitCode, stderr, log } = await runCrashing(
			`setTimeout(() => { throw new Error("FIFO destination"); }, 0);`,
			(dir) => {
				mkdirSync(join(dir, "logs"));
				const fifo = Bun.spawnSync(["mkfifo", join(dir, "logs", "crash.log")]);
				if (fifo.exitCode !== 0) throw new Error(fifo.stderr.toString());
			},
		);
		expect(exitCode).toBe(1);
		expect(log).toBe("");
		expect(stderr).toContain("FIFO destination");
		expect(stderr).toContain("could not write the crash report");
	},
);

test("a throwing stderr sink cannot recurse or prevent exit", async () => {
	const { exitCode, log } = await runCrashing(
		`process.stderr.write = () => { throw new Error("synthetic sink failure"); };\n` +
			`setTimeout(() => { throw new Error("original failure"); }, 0);`,
	);
	expect(exitCode).toBe(1);
	expect(log).toContain("original failure");
	expect(log).not.toContain("synthetic sink failure");
	expect(log.match(/uncaughtException \(thinkrail/g)).toHaveLength(1);
});

test("a stderr sink that never completes cannot keep the crashed host alive", async () => {
	const { exitCode, log } = await runCrashing(
		`process.stderr.write = () => false;\n` +
			`setTimeout(() => { throw new Error("stalled sink"); }, 0);`,
	);
	expect(exitCode).toBe(1);
	expect(log).toContain("stalled sink");
}, 5_000);

test("installing twice and reporting a later fault appends both records and flushes both", async () => {
	const { exitCode, stderr, log } = await runCrashing(
		`installCrashLog("duplicate-install");\n` +
			`process.emit("uncaughtException", new Error("first failure"));\n` +
			`process.emit("unhandledRejection", { detail: "later failure:" + "x".repeat(100_000) }, Promise.resolve());`,
	);
	expect(exitCode).toBe(1);
	expect(log).not.toContain("duplicate-install");
	expect(log.match(/thinkrail 9\.9\.9-test/g)).toHaveLength(2);
	expect(log).toContain("first failure");
	expect(log).toContain("later failure");
	const second = log.slice(log.indexOf("\n\n") + 2);
	expect(stderr.includes(second)).toBe(true);
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

test("a crash is reported to PostHog as a fatal exception before the process exits", async () => {
	const batches: Array<{ event: string; properties: Record<string, unknown> }> = [];
	const collector = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			batches.push(...((await request.json()) as { batch: typeof batches }).batch);
			return new Response("{}");
		},
	});
	try {
		const { exitCode, log } = await runCrashing(
			`import { initializeAnalytics } from ${JSON.stringify(join(import.meta.dir, "..", "analytics", "index.ts"))};\n` +
				`initializeAnalytics({ posthogApiKey: "phc_test", posthogHost: "http://127.0.0.1:${collector.port}", build: "binary", additionalEnabled: false, env: {} });\n` +
				`setTimeout(() => { throw new Error("boom in " + ${JSON.stringify(tmpdir())} + "/private-project"); }, 0);`,
		);
		expect(exitCode).toBe(1);
		expect(log).toContain("private-project");
		const crash = batches.find((entry) => entry.event === "$exception");
		expect(crash?.properties).toMatchObject({
			source: "host_crash",
			scope: "uncaughtException",
			handled: false,
			$exception_level: "fatal",
		});
		expect(JSON.stringify(crash)).not.toContain("private-project");
	} finally {
		collector.stop(true);
	}
});
