import { expect, test } from "bun:test";
import { spawnDetached, spawnSyncCaptured } from "./spawn";

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

test("spawnDetached confirms a real launch and rejects empty or missing commands", () => {
	expect(spawnDetached([process.execPath, "-e", ""])).toBe(true);
	expect(spawnDetached([])).toBe(false);
	expect(spawnDetached(["thinkrail-no-such-binary-xyz"])).toBe(false);
});
