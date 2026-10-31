import { expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	pollUntil,
	processesUnderRoots,
	runWithCleanup,
	terminateProcess,
	within,
} from "./lifecycle";

function readPid(path: string): number | undefined {
	const pid = existsSync(path) ? Number(readFileSync(path, "utf8")) : Number.NaN;
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function processAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`refusing to probe pid ${pid}`);
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
			writeFileSync(${JSON.stringify(grandchildPidPath)}, "");
			await Bun.sleep(50);
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
		await pollUntil(
			() => {
				childPid = readPid(childPidPath);
				grandchildPid = readPid(grandchildPidPath);
				return childPid !== undefined && grandchildPid !== undefined;
			},
			{
				timeoutMs: 2_000,
				what: "process tree fixture",
				exited: parent.exited,
				exitError: (code) => new Error(`fixture parent exited early with ${code}`),
			},
		);
		if (childPid === undefined || grandchildPid === undefined)
			throw new Error("process tree fixture pids unread");
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

function busyError(): Error {
	return Object.assign(new Error("EBUSY: resource busy or locked, rm 'root'"), { code: "EBUSY" });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected a rejection");
}

test("runWithCleanup surfaces the original failure first when cleanup also fails", async () => {
	const failure = new Error("installed desktop health failed: 503");
	const cleanupError = busyError();
	const reported: unknown[] = [];
	const events: string[] = [];
	const error = await rejection(
		runWithCleanup(
			async () => {
				throw failure;
			},
			[
				({ failed }) => {
					events.push(`kill:${failed}`);
				},
				() => {
					events.push("remove");
					throw cleanupError;
				},
			],
			{
				reportFailure: (error) => {
					reported.push(error);
					events.push("report");
				},
			},
		),
	);
	expect(events).toEqual(["report", "kill:true", "remove"]);
	expect(reported).toEqual([failure]);
	expect(error).toBeInstanceOf(AggregateError);
	const aggregate = error as AggregateError;
	expect(aggregate.errors).toEqual([failure, cleanupError]);
	expect(aggregate.cause).toBe(failure);
	expect(aggregate.message).toStartWith(
		"installed desktop health failed: 503; cleanup also failed:",
	);
});

test("runWithCleanup rethrows the original failure unchanged when cleanup succeeds", async () => {
	const failure = new Error("ready document invalid");
	const error = await rejection(
		runWithCleanup(
			async () => {
				throw failure;
			},
			[() => {}],
			{ reportFailure: () => {} },
		),
	);
	expect(error).toBe(failure);
});

test("runWithCleanup labels a cleanup-only failure as cleanup", async () => {
	const cleanupError = busyError();
	const error = await rejection(
		runWithCleanup(
			async () => "ok",
			[
				({ failed }) => {
					expect(failed).toBe(false);
					throw cleanupError;
				},
			],
		),
	);
	expect(error).toBeInstanceOf(Error);
	expect((error as Error).message).toBe(`cleanup failed: ${cleanupError.message}`);
	expect((error as Error).cause).toBe(cleanupError);
	expect(await runWithCleanup(async () => "ok", [() => {}])).toBe("ok");
});

test("processesUnderRoots matches executable or command line under any root form", () => {
	const listing = [
		"4\t\t",
		"100\tC:\\Users\\runneradmin\\AppData\\Local\\Temp\\smoke-ab\\local\\ai.thinkrail.app\\canary\\app\\bin\\launcher.exe\t",
		"101\tC:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\smoke-ab\\local\\ai.thinkrail.app\\canary\\app\\bin\\bun.exe\tbun.exe main.js",
		"102\tC:\\Program Files\\WebView2\\msedgewebview2.exe\tmsedgewebview2.exe --user-data-dir=C:/Users/RUNNER~1/AppData/Local/Temp/smoke-ab/user-data",
		"103\tC:\\Windows\\System32\\conhost.exe\tconhost.exe 0x4",
		"104\tC:\\Users\\runneradmin\\AppData\\Local\\Temp\\smoke-abc\\other.exe\t",
		`${process.pid}\tC:\\Users\\runneradmin\\AppData\\Local\\Temp\\smoke-ab\\self.exe\t`,
		"",
	].join("\r\n");
	expect(
		processesUnderRoots(listing, [
			"C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\smoke-ab",
			"c:\\users\\runneradmin\\appdata\\local\\temp\\smoke-ab\\",
		]),
	).toEqual([100, 101, 102]);
});
