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
		// Stands in for a terminal with a job in it: the shell is the pid we ask about and the sleep is its child.
		// The trailing `:` matters — given a single final command a shell `exec`s it and *becomes* the process
		// rather than forking, so there would be no child to find. The bare `sleep` is the idle-prompt case: a
		// live process with nothing under it.
		const withChild = Bun.spawn(["sh", "-c", "sleep 30; :"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		const withoutChild = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
		try {
			// The shell has to reach its fork before the answer means anything.
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
	// Cannot be executed from CI on Linux, so what is pinned here is the property that does not need Windows:
	// the pid never reaches PowerShell's parser as text. Interpolating it would be the injection minefield
	// `apps/cli/src/powershell.ts` exists to avoid.
	test("passes the pid by environment, never by string interpolation", () => {
		expect(WINDOWS_CHILD_COUNT).toContain("$env:TR_PARENT_PID");
		expect(WINDOWS_CHILD_COUNT).not.toMatch(/ParentProcessId=\d/);
	});

	test("prints a count rather than relying on the exit code", () => {
		// PowerShell exits 0 whether or not the query matched, so an exit-code answer could not tell "no
		// children" from "the query failed" — and we would report not-busy on a host where it actually works.
		expect(WINDOWS_CHILD_COUNT).toContain("Write-Output");
		expect(WINDOWS_CHILD_COUNT).toContain("$ErrorActionPreference = 'Stop'");
	});
});
