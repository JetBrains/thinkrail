import { expect, test } from "bun:test";
import { AbandonmentReporter } from "./abandonmentReporter";

function fixture() {
	const debug: string[] = [];
	const warn: string[] = [];
	const reports: string[] = [];
	const reporter = new AbandonmentReporter(
		{ debug: (message) => debug.push(message), warn: (message) => warn.push(message) },
		(method) => reports.push(method),
	);
	return { reporter, debug, warn, reports };
}

test("polling abandonment logs one warning per summary while retaining every method count", () => {
	const { reporter, debug, warn, reports } = fixture();
	for (let batch = 0; batch < 1_500; batch++) {
		reporter.record(["todo.list", "todo.list", "workspace.branchStatus"]);
	}
	expect(warn).toEqual([]);
	expect(debug).toHaveLength(1_500);
	expect(debug[0]).toBe(
		"requests abandoned before their handlers settled: todo.list ×2, workspace.branchStatus ×1",
	);
	expect(reports).toEqual(["todo.list", "workspace.branchStatus"]);
	reporter.flush();
	expect(warn).toEqual([
		"abandoned request summary: todo.list ×3000, workspace.branchStatus ×1500",
	]);
});

test("a summary resets only its counts, not the launch-wide error report budget", () => {
	const { reporter, warn, reports } = fixture();
	reporter.record(["todo.list", "todo.list"]);
	reporter.flush();
	reporter.record(["todo.list", "fs.readDir"]);
	reporter.flush();
	expect(warn).toEqual([
		"abandoned request summary: todo.list ×2",
		"abandoned request summary: todo.list ×1, fs.readDir ×1",
	]);
	expect(reports).toEqual(["todo.list", "fs.readDir"]);
});

test("empty batches and empty summary intervals produce no diagnostics", () => {
	const { reporter, debug, warn, reports } = fixture();
	reporter.record([]);
	reporter.flush();
	expect({ debug, warn, reports }).toEqual({ debug: [], warn: [], reports: [] });
	reporter.record(["git.status"]);
	reporter.flush();
	reporter.flush();
	expect(warn).toEqual(["abandoned request summary: git.status ×1"]);
});

test("summary counts remain complete after the error reporting allowance is exhausted", () => {
	const { reporter, warn, reports } = fixture();
	const methods = Array.from({ length: 12 }, (_, index) => `method-${index}`);
	reporter.record(methods);
	reporter.flush();
	reporter.record(methods);
	reporter.flush();
	expect(reports).toEqual(methods.slice(0, 10));
	expect(warn).toHaveLength(2);
	expect(warn[0]).toBe(warn[1]);
	expect(warn[0]).toContain("method-11 ×1");
});
