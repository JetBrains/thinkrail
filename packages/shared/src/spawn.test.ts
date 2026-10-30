import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	setInterruptForwardingForTests,
	spawnDetached,
	spawnSyncCaptured,
	spawnSyncCapturedBytes,
} from "./spawn";

const posix = test.skipIf(process.platform === "win32");

afterEach(() => setInterruptForwardingForTests(undefined));

test("spawnSyncCaptured captures stdout and a zero exit", () => {
	const result = spawnSyncCaptured([process.execPath, "-e", 'process.stdout.write("hi")']);
	expect(result.launched).toBe(true);
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toBe("hi");
});

test("spawnSyncCaptured reports a non-zero exit and stderr without throwing", () => {
	const result = spawnSyncCaptured([
		process.execPath,
		"-e",
		'process.stderr.write("boom"); process.exit(3)',
	]);
	expect(result.launched).toBe(true);
	expect(result.exitCode).toBe(3);
	expect(result.stderr).toBe("boom");
});

test("spawnSyncCaptured turns a missing binary into launched:false, not a throw", () => {
	const result = spawnSyncCaptured(["thinkrail-no-such-binary-xyz"]);
	expect(result.launched).toBe(false);
	expect(result.exitCode).toBe(null);
});

for (const forwarding of [false, true]) {
	describe(forwarding ? "under a terminal" : "without a terminal", () => {
		const withMode = () => setInterruptForwardingForTests(forwarding);

		test("spawnSyncCaptured kills a child at its deadline and says it timed out", () => {
			withMode();
			const started = performance.now();
			const result = spawnSyncCaptured([process.execPath, "-e", "setTimeout(() => {}, 30_000)"], {
				timeoutMs: 300,
			});
			expect(performance.now() - started).toBeLessThan(5_000);
			expect(result.launched).toBe(true);
			expect(result.timedOut).toBe(true);
			expect(spawnSyncCaptured([process.execPath, "-e", ""], { timeoutMs: 5_000 }).timedOut).toBe(
				false,
			);
		});

		posix("spawnSyncCaptured kills the child's whole process group at its deadline", () => {
			withMode();
			const marker = `sleep ${40 + Math.floor(Math.random() * 1_000) / 1_000}`;
			const result = spawnSyncCaptured(["sh", "-c", `${marker} & ${marker}; :`], {
				timeoutMs: 300,
			});
			expect(result.timedOut).toBe(true);
			const survivors = spawnSyncCaptured(["pgrep", "-f", marker]);
			expect(survivors.exitCode).toBe(1);
		});

		posix("spawnSyncCaptured sends SIGTERM at the deadline so the child can clean up", () => {
			withMode();
			const dir = mkdtempSync(join(tmpdir(), "spawn-term-"));
			const cleaned = join(dir, "cleaned");
			try {
				const result = spawnSyncCaptured(
					["sh", "-c", `trap 'touch "${cleaned}"; exit 1' TERM; sleep 30 & wait`],
					{ timeoutMs: 300 },
				);
				expect(result.timedOut).toBe(true);
				expect(existsSync(cleaned)).toBe(true);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		test("a deadline keeps capture, exit code and launch failure", () => {
			withMode();
			const result = spawnSyncCaptured(
				[
					process.execPath,
					"-e",
					'process.stdout.write("hi"); process.stderr.write("boom"); process.exit(3)',
				],
				{ timeoutMs: 5_000 },
			);
			expect(result).toMatchObject({ launched: true, exitCode: 3, timedOut: false });
			expect(result.stdout).toBe("hi");
			expect(result.stderr).toBe("boom");
			expect(
				spawnSyncCaptured(["thinkrail-no-such-binary-xyz"], { timeoutMs: 5_000 }).launched,
			).toBe(false);
		});
	});
}

posix(
	"under a terminal, Ctrl-C stops a sync child that has a deadline",
	async () => {
		const spawnModule = join(import.meta.dir, "spawn.ts");
		const host = Bun.spawn(
			[
				process.execPath,
				"-e",
				`const { setInterruptForwardingForTests, spawnSyncCaptured } = await import(${JSON.stringify(spawnModule)});
setInterruptForwardingForTests(true);
process.on("SIGINT", () => process.exit(42));
spawnSyncCaptured(["sh", "-c", "sleep 20"], { timeoutMs: 30_000 });
setTimeout(() => {}, 1_000);`,
			],
			{ detached: true, stdout: "ignore", stderr: "inherit" },
		);
		await Bun.sleep(700);
		const started = performance.now();
		process.kill(-host.pid, "SIGINT");
		const code = await Promise.race([host.exited, Bun.sleep(5_000).then(() => "stuck")]);
		if (code === "stuck") process.kill(-host.pid, "SIGKILL");
		expect(code).toBe(42);
		expect(performance.now() - started).toBeLessThan(3_000);
	},
	10_000,
);

test("spawnSyncCaptured passes env through", () => {
	const result = spawnSyncCaptured(
		[process.execPath, "-e", "process.stdout.write(String(process.env.TR_SPAWN_TEST))"],
		{ env: { ...process.env, TR_SPAWN_TEST: "from-env" } },
	);
	expect(result.stdout).toBe("from-env");
});

test("spawnSyncCapturedBytes keeps stdout byte-exact where the text capture substitutes", () => {
	const argv = [
		process.execPath,
		"-e",
		"process.stdout.write(Buffer.from([0x89, 0xff, 0x00, 0x41]))",
	];
	const result = spawnSyncCapturedBytes(argv);
	expect(result.launched).toBe(true);
	expect(result.exitCode).toBe(0);
	expect(Array.from(result.stdout)).toEqual([0x89, 0xff, 0x00, 0x41]);
	expect(spawnSyncCaptured(argv).stdout).not.toBe("\u0089\u00ff\u0000A");
});

test("spawnSyncCapturedBytes reports exit + decoded stderr and a missing binary as launched:false", () => {
	const failed = spawnSyncCapturedBytes([
		process.execPath,
		"-e",
		'process.stderr.write("boom"); process.exit(3)',
	]);
	expect(failed.launched).toBe(true);
	expect(failed.exitCode).toBe(3);
	expect(failed.stderr).toBe("boom");

	const missing = spawnSyncCapturedBytes(["thinkrail-no-such-binary-xyz"]);
	expect(missing.launched).toBe(false);
	expect(missing.exitCode).toBe(null);
	expect(missing.stdout.length).toBe(0);
	expect(spawnSyncCapturedBytes([]).launched).toBe(false);
});

test("spawnDetached confirms a real launch and rejects empty or missing commands", () => {
	expect(spawnDetached([process.execPath, "-e", ""])).toBe(true);
	expect(spawnDetached([])).toBe(false);
	expect(spawnDetached(["thinkrail-no-such-binary-xyz"])).toBe(false);
});
