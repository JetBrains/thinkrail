import { expect, test } from "bun:test";
import { spawnDetached, spawnSyncCaptured, spawnSyncCapturedBytes } from "./spawn";

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
