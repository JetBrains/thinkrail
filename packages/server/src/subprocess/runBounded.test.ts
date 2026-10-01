import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAIN_GRACE_MS, runBounded, streamBounded } from "./runBounded";

const posix = test.skipIf(process.platform === "win32");

let dir: string;

const bun = (source: string) => [process.execPath, "-e", source];

const outlivingChild = (grandchild: string) =>
	`Bun.spawn([process.execPath, "-e", ${JSON.stringify(grandchild)}], { stdout: "inherit", stderr: "inherit" }).unref();`;

const pipeHoldingChild = (body: string) =>
	bun(
		`Bun.spawn(["sh", "-c", "sleep 5"], { stdout: "inherit", stderr: "inherit" }).unref(); ${body}`,
	);

const escapedPipeHolder = `Bun.spawn(["sh", "-c", "sleep 5"], { stdout: "inherit", stderr: "inherit", detached: true }).unref();`;

const SENTINEL = "THINKRAIL_SPAWN_SENTINEL";

async function gone(pid: number): Promise<boolean> {
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			process.kill(pid, 0);
		} catch {
			return true;
		}
		await Bun.sleep(50);
	}
	return false;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "trpi-subprocess-test-"));
});

afterEach(() => {
	delete process.env[SENTINEL];
	rmSync(dir, { recursive: true, force: true });
});

test("captures stdout, stderr and the exit code", async () => {
	const result = await runBounded(
		bun('process.stdout.write("out"); process.stderr.write("err"); process.exit(3);'),
		{ timeoutMs: 10_000 },
	);

	expect(result).toEqual({
		ok: false,
		out: "out",
		err: "err",
		timedOut: false,
		launchFailed: false,
		waitedMs: expect.any(Number),
	});
});

test("captures output larger than a pipe buffer", async () => {
	const result = await runBounded(bun('process.stdout.write("x".repeat(300_000));'), {
		timeoutMs: 10_000,
	});

	expect(result.ok).toBe(true);
	expect(result.out.length).toBe(300_000);
});

test("the bytes mode preserves stdout that is not valid UTF-8", async () => {
	const result = await runBounded(
		bun("process.stdout.write(Uint8Array.from([0, 255, 128, 65])); process.stderr.write('err');"),
		{ timeoutMs: 10_000, stdout: "bytes" },
	);

	expect(result.ok).toBe(true);
	expect(result.out).toEqual(new Uint8Array([0, 255, 128, 65]));
	expect(result.err).toBe("err");
});

test("a failed launch is a result, not a throw", async () => {
	const result = await runBounded(["thinkrail-no-such-binary"], { timeoutMs: 10_000 });

	expect(result.ok).toBe(false);
	expect(result.timedOut).toBe(false);
	expect(result.launchFailed).toBe(true);
	expect(result.err).not.toBe("");
});

test("completes when the child exits, even while a grandchild still holds the pipes", async () => {
	const result = await runBounded(
		bun(`${outlivingChild("setTimeout(() => {}, 30_000);")} process.stdout.write("done");`),
		{ timeoutMs: 10_000 },
	);

	expect(result.timedOut).toBe(false);
	expect(result.ok).toBe(true);
	expect(result.out).toBe("done");
});

posix("a child that exits inside the drain grace is not reported as a timeout", async () => {
	const result = await runBounded(pipeHoldingChild('process.stdout.write("done");'), {
		timeoutMs: 250,
	});

	expect(result.timedOut).toBe(false);
	expect(result.ok).toBe(true);
	expect(result.out).toBe("done");
});

posix("the exit path waits out the drain grace when the pipes cannot reach EOF", async () => {
	const result = await runBounded(pipeHoldingChild('process.stdout.write("done");'), {
		timeoutMs: 10_000,
	});

	expect(result.ok).toBe(true);
	expect(result.out).toBe("done");
	expect(result.waitedMs).toBeGreaterThanOrEqual(DRAIN_GRACE_MS);
	expect(result.waitedMs).toBeLessThan(DRAIN_GRACE_MS * 8);
});

test("cwd and env reach the child", async () => {
	const result = await runBounded(
		bun(`process.stdout.write(\`\${process.cwd()}|\${process.env.${SENTINEL}}\`);`),
		{ timeoutMs: 10_000, cwd: dir, env: { ...process.env, [SENTINEL]: "from-opts" } },
	);

	expect(result.ok).toBe(true);
	expect(result.out).toBe(`${realpathSync(dir)}|from-opts`);
});

test("the env defaults to the live process.env, not a launch-time snapshot", async () => {
	process.env[SENTINEL] = "mutated-after-startup";

	const result = await runBounded(bun(`process.stdout.write(String(process.env.${SENTINEL}));`), {
		timeoutMs: 10_000,
	});

	expect(result.ok).toBe(true);
	expect(result.out).toBe("mutated-after-startup");
});

test("a timeoutMs setTimeout cannot represent does not collapse into an instant timeout", async () => {
	const slow = bun('await Bun.sleep(150); process.stdout.write("late");');

	for (const timeoutMs of [Number.POSITIVE_INFINITY, 2 ** 31]) {
		const result = await runBounded(slow, { timeoutMs });

		expect(result.timedOut).toBe(false);
		expect(result.out).toBe("late");
	}

	for (const timeoutMs of [-1, Number.NaN]) {
		expect((await runBounded(slow, { timeoutMs })).timedOut).toBe(true);
	}
});

posix("the timeout kills the whole process group, not just the child", async () => {
	const pidFile = join(dir, "grandchild.pid");
	const grandchild = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 30_000);`;

	const result = await runBounded(
		bun(`${outlivingChild(grandchild)} await new Promise(() => {});`),
		{ timeoutMs: 1_000 },
	);

	expect(result.timedOut).toBe(true);
	expect(result.ok).toBe(false);
	expect(existsSync(pidFile)).toBe(true);
	expect(await gone(Number(readFileSync(pidFile, "utf8")))).toBe(true);
});

posix("the timeout path drains after the kill, bounded by the grace", async () => {
	const budget = 500;

	const result = await runBounded(
		bun(
			`${escapedPipeHolder} process.stderr.write("REMOTE-SAID-THIS"); await new Promise(() => {});`,
		),
		{ timeoutMs: budget },
	);

	expect(result.timedOut).toBe(true);
	expect(result.err).toBe("REMOTE-SAID-THIS");
	expect(result.waitedMs).toBeGreaterThanOrEqual(budget + DRAIN_GRACE_MS);
	expect(result.waitedMs).toBeLessThan(budget + DRAIN_GRACE_MS * 8);
});

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

test("streamBounded hands stdout over as it arrives and closes on a clean exit", async () => {
	const run = streamBounded(
		bun(
			"const chunk = Buffer.alloc(1 << 20, 7); for (let i = 0; i < 4; i++) process.stdout.write(chunk);",
		),
		{ timeoutMs: 10_000 },
	);
	const reader = run.stdout.getReader();
	const first = await reader.read();
	expect(first.done).toBe(false);
	let total = first.value?.byteLength ?? 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		total += next.value.byteLength;
	}
	expect(total).toBe(4 << 20);
	expect(await run.exited).toMatchObject({ ok: true, timedOut: false, launchFailed: false });
});

test("streamBounded errors the stream instead of closing it when the child exits nonzero", async () => {
	const run = streamBounded(
		bun('process.stdout.write("partial"); console.error("boom"); process.exit(3);'),
		{ timeoutMs: 10_000 },
	);
	await expect(collect(run.stdout)).rejects.toThrow("boom");
	expect(await run.exited).toMatchObject({ ok: false, err: "boom\n", timedOut: false });
});

posix("streamBounded kills the child when the consumer cancels, and on expiry", async () => {
	const cancelled = streamBounded(
		bun('process.stdout.write("x"); setInterval(() => process.stdout.write("x"), 10);'),
		{ timeoutMs: 10_000 },
	);
	const reader = cancelled.stdout.getReader();
	expect((await reader.read()).done).toBe(false);
	await reader.cancel();
	expect(await cancelled.exited).toMatchObject({ ok: false, timedOut: false });

	const expired = streamBounded(bun("setInterval(() => {}, 1000);"), { timeoutMs: 100 });
	await expect(collect(expired.stdout)).rejects.toThrow("timed out");
	expect((await expired.exited).timedOut).toBe(true);
});

posix(
	"streamBounded completes when the child exits, even while a grandchild still holds stdout",
	async () => {
		const startedAt = performance.now();
		const run = streamBounded(pipeHoldingChild('process.stdout.write("held-open");'), {
			timeoutMs: 10_000,
		});
		const bytes = await collect(run.stdout);
		expect(new TextDecoder().decode(bytes)).toBe("held-open");
		expect(await run.exited).toMatchObject({ ok: true, timedOut: false });
		expect(performance.now() - startedAt).toBeLessThan(4_000);
	},
);

test("streamBounded reports a failed launch through both the stream and the exit", async () => {
	const run = streamBounded(["/definitely/not/a/binary"], { timeoutMs: 1000 });
	await expect(collect(run.stdout)).rejects.toThrow();
	expect(await run.exited).toMatchObject({ ok: false, launchFailed: true });
});
