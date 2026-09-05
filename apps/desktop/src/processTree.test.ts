import { expect, test } from "bun:test";
import { killWindowsProcessTree, type WindowsProcessTreeHost } from "./processTree";

function recorder(
	platform: NodeJS.Platform,
	fail = false,
): WindowsProcessTreeHost & { calls: number[] } {
	const calls: number[] = [];
	return {
		calls,
		platform,
		taskkill: (pid) => {
			calls.push(pid);
			if (fail) throw new Error("taskkill unavailable");
		},
	};
}

test("terminates the launcher and everything under it on Windows", () => {
	const host = recorder("win32");

	killWindowsProcessTree(1234, host);

	expect(host.calls).toEqual([1234]);
});

test("leaves POSIX termination to the caller's own signal", () => {
	const host = recorder("linux");

	killWindowsProcessTree(1234, host);

	expect(host.calls).toEqual([]);
});

test("ignores an unknown pid and a tree that is already gone", () => {
	const host = recorder("win32", true);

	killWindowsProcessTree(undefined, host);
	expect(host.calls).toEqual([]);

	expect(() => killWindowsProcessTree(1234, host)).not.toThrow();
	expect(host.calls).toEqual([1234]);
});
