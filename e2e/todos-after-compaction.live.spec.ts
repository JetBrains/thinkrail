import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import {
	ask,
	compact,
	pushPastCompactionTail,
	readSession,
	type SessionEntry,
	splitAtCompaction,
	toolCalls,
} from "./fixtures/skillCompaction";

function report(entries: SessionEntry[]) {
	const calls = entries.flatMap(toolCalls);
	const done = calls.filter((c) => c.name === "todo_update" && c.arguments.status === "done");
	const nonEmpty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
	return {
		planPublished: calls.some(
			(c) => c.name === "todo_write" || (c.name === "todo_add" && nonEmpty(c.arguments.group)),
		),
		doneUpdates: done.length,
		doneWithSummary: done.filter((c) => nonEmpty(c.arguments.summary)).length,
		doneWithVerification: done.filter((c) => nonEmpty(c.arguments.verification)).length,
		doneWithCommitSubject: done.filter((c) => nonEmpty(c.arguments.commitSubject)).length,
		planSummaryPrShaped: calls
			.filter((c) => c.name === "todo_plan_summary")
			.some((c) =>
				["## Summary", "## Changes", "## Testing"].every((h) =>
					String(c.arguments.summary ?? "").includes(h),
				),
			),
	};
}

test("the agent keeps following the todos skill after its body is compacted away", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(600_000);
	const workspace = await openWorkspaceChat(page);
	await ask(
		page,
		"/skill:todos Build a tiny TypeScript utility library in a new folder util/. Implement three separate modules, each in its own file with a focused function: util/math.ts exporting add(a, b), util/strings.ts exporting capitalize(s), and util/arrays.ts exporting unique(xs). Then add a util/index.ts barrel that re-exports all three, and finally write a short util/README.md documenting the API. Plan it in the chat TODO list before you start.",
	);
	await pushPastCompactionTail(page);
	await compact(page, workspace.worktreePath);
	await ask(
		page,
		"Now build a second small library in a new folder fmt/: fmt/date.ts exporting isoDay(d: Date), fmt/money.ts exporting cents(n: number), and fmt/bytes.ts exporting humanBytes(n: number), each in its own file. Then add a fmt/index.ts barrel re-exporting all three and a short fmt/README.md documenting the API. Plan it in the chat TODO list before you start.",
	);

	const split = splitAtCompaction(readSession(workspace.worktreePath), "todos");
	const before = report(split.before);
	const after = report(split.after);
	await test.info().attach("skill-compliance.json", {
		body: JSON.stringify(
			{
				before,
				after,
				skillLoadsKept: split.skillLoadsKept,
				skillLoadsCompactedAway: split.skillLoadsCompactedAway,
				compactionSummary: split.compaction.summary,
			},
			null,
			2,
		),
		contentType: "application/json",
	});

	expect(split.skillLoadsCompactedAway, "phase A loaded the todos skill").toBeGreaterThan(0);
	expect(split.skillLoadsKept, "no skill body survived the cut").toBe(0);
	expect(before.planPublished && before.planSummaryPrShaped).toBe(true);

	expect(after.planPublished, "phase B published a plan").toBe(true);
	expect(after.doneUpdates).toBeGreaterThan(0);
	expect(after.doneWithSummary).toBe(after.doneUpdates);
	expect(after.doneWithVerification).toBe(after.doneUpdates);
	expect(after.doneWithCommitSubject).toBe(after.doneUpdates);
	expect(after.planSummaryPrShaped, "phase B wrote a PR-shaped plan summary").toBe(true);
});
