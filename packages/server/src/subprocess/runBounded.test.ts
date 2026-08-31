import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAIN_GRACE_MS, runBounded } from "./runBounded";

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
