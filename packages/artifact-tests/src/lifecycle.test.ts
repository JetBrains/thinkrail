import { expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pollUntil, terminateProcess, within } from "./lifecycle";

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

test("within clears its timer on success and timeout", async () => {
	const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");
	try {
		expect(await within(Promise.resolve("ready"), 10_000, "success")).toBe("ready");
		await expect(within(new Promise<never>(() => {}), 20, "bounded work")).rejects.toThrow(
			"timed out after 20ms: bounded work",
		);
		expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
	} finally {
		clearTimeoutSpy.mockRestore();
	}
});

test("pollUntil stops polling after success", async () => {
	let checks = 0;
	await pollUntil(() => ++checks === 3, {
		timeoutMs: 1_000,
		intervalMs: 5,
		what: "condition",
	});
	const settledChecks = checks;
	await Bun.sleep(20);
	expect(checks).toBe(settledChecks);
});

test("pollUntil stops polling at its deadline", async () => {
	let checks = 0;
	await expect(
		pollUntil(
			() => {
				checks += 1;
				return false;
			},
			{ timeoutMs: 20, intervalMs: 5, what: "condition" },
		),
	).rejects.toThrow("timed out after 20ms: condition");
	const settledChecks = checks;
	await Bun.sleep(20);
	expect(checks).toBe(settledChecks);
});

test("pollUntil stops polling after an early child exit", async () => {
	let resolveExit: ((code: number) => void) | undefined;
	const exited = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	let checks = 0;
	setTimeout(() => resolveExit?.(7), 15);
	await expect(
		pollUntil(
			() => {
				checks += 1;
				return false;
			},
			{
				timeoutMs: 1_000,
				intervalMs: 5,
				what: "ready",
				exited,
				exitError: (code) => new Error(`child exited early with ${code}`),
			},
		),
	).rejects.toThrow("child exited early with 7");
	const settledChecks = checks;
	await Bun.sleep(20);
	expect(checks).toBe(settledChecks);
});

test("terminateProcess kills and reaps a live root with its child and grandchild", async () => {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-artifact-lifecycle-test-"));
	const childPidPath = join(root, "child.pid");
	const grandchildPidPath = join(root, "grandchild.pid");
	const grandchildSource = `
			const { writeFileSync } = require("node:fs");
			writeFileSync(${JSON.stringify(grandchildPidPath)}, String(process.pid));
			await new Promise(() => {});
		`;
	const childSource = `
			const { writeFileSync } = require("node:fs");
			writeFileSync(${JSON.stringify(childPidPath)}, String(process.pid));
			Bun.spawn([process.execPath, "-e", ${JSON.stringify(grandchildSource)}], {
				stdin: "ignore", stdout: "ignore", stderr: "ignore"
			});
			await new Promise(() => {});
		`;
	const parent = Bun.spawn(
		[
			process.execPath,
			"-e",
			`
			Bun.spawn([process.execPath, "-e", ${JSON.stringify(childSource)}], {
				stdin: "ignore", stdout: "ignore", stderr: "ignore"
			});
			await new Promise(() => {});
		`,
		],
		{
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		},
	);

	let childPid: number | undefined;
	let grandchildPid: number | undefined;
	try {
		await pollUntil(() => existsSync(childPidPath) && existsSync(grandchildPidPath), {
			timeoutMs: 2_000,
			what: "process tree fixture",
			exited: parent.exited,
			exitError: (code) => new Error(`fixture parent exited early with ${code}`),
		});
		childPid = Number(readFileSync(childPidPath, "utf8"));
		grandchildPid = Number(readFileSync(grandchildPidPath, "utf8"));
		expect(processAlive(parent.pid)).toBe(true);
		expect(processAlive(childPid)).toBe(true);
		expect(processAlive(grandchildPid)).toBe(true);

		const failure = new Error("fixture failure");
		let observedFailure: unknown;
		try {
			await terminateProcess(parent, failure, { timeoutMs: 3_000 });
		} catch (error) {
			observedFailure = error;
		}
		expect(observedFailure).toBe(failure);
		expect(processAlive(parent.pid)).toBe(false);
		expect(processAlive(childPid)).toBe(false);
		expect(processAlive(grandchildPid)).toBe(false);
	} finally {
		for (const pid of [grandchildPid, childPid, parent.pid]) {
			if (pid !== undefined && processAlive(pid)) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {}
			}
		}
		await within(parent.exited, 2_000, "fixture parent cleanup").catch(() => {});
		rmSync(root, { recursive: true, force: true });
	}
}, 10_000);
