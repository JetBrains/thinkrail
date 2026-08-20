import { describe, expect, test } from "bun:test";
import { hasChildProcesses, parseProcChildren, WINDOWS_CHILD_COUNT } from "./shellBusy";

describe("parseProcChildren", () => {
	test("reads the pid list", () => {
		expect(parseProcChildren("1234 5678 91011\n")).toEqual([1234, 5678, 91011]);
	});

	test("no children is an empty file, not an absent one", () => {
		expect(parseProcChildren("")).toEqual([]);
		expect(parseProcChildren("\n")).toEqual([]);
	});

	test("ignores anything that is not a pid", () => {
		expect(parseProcChildren("12 junk -3 0 34")).toEqual([12, 34]);
	});
});

describe("hasChildProcesses", () => {
	test("a shell running something reports busy; a bare process does not", async () => {
		const withChild = Bun.spawn(["sh", "-c", "sleep 30; :"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		const withoutChild = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
		try {
			await Bun.sleep(300);
			expect(hasChildProcesses(withChild.pid)).toBe(true);
			expect(hasChildProcesses(withoutChild.pid)).toBe(false);
		} finally {
			withChild.kill();
			withoutChild.kill();
		}
	});

	test("an implausible pid is not busy rather than throwing", () => {
		expect(hasChildProcesses(0)).toBe(false);
		expect(hasChildProcesses(-1)).toBe(false);
		expect(hasChildProcesses(Number.NaN)).toBe(false);
	});

	test("a pid that no longer exists is not busy", () => {
		const gone = Bun.spawn(["true"], { stdout: "ignore", stderr: "ignore" });
		gone.kill();
		expect(hasChildProcesses(gone.pid)).toBe(false);
	});
});

describe("the Windows probe", () => {
	test("passes the pid by environment, never by string interpolation", () => {
		expect(WINDOWS_CHILD_COUNT).toContain("$env:TR_PARENT_PID");
		expect(WINDOWS_CHILD_COUNT).not.toMatch(/ParentProcessId=\d/);
	});

	test("prints a count rather than relying on the exit code", () => {
		expect(WINDOWS_CHILD_COUNT).toContain("Write-Output");
		expect(WINDOWS_CHILD_COUNT).toContain("$ErrorActionPreference = 'Stop'");
	});
});
