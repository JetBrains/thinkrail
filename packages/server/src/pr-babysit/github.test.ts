import { expect, test } from "bun:test";
import { isFailedCheck, isIgnoredComment, parsePrSnapshot, tailLog } from "./github";

const response = {
	data: {
		repository: {
			pullRequest: {
				number: 7,
				url: "https://github.com/o/r/pull/7",
				state: "OPEN",
				baseRefName: "main",
				headRefName: "feat",
				headRefOid: "abc123",
				reviewDecision: "CHANGES_REQUESTED",
				reviewThreads: {
					nodes: [
						{
							id: "T1",
							isResolved: false,
							isOutdated: false,
							path: "src/a.ts",
							line: null,
							originalLine: 12,
							comments: {
								nodes: [
									{
										id: "C1",
										databaseId: 101,
										author: { login: "alice" },
										body: "null check please",
										createdAt: "2026-01-01T00:00:00Z",
									},
									{ id: "C2", databaseId: null, author: null, body: "dropped" },
								],
							},
						},
						{ id: null },
					],
				},
				commits: {
					nodes: [
						{
							commit: {
								oid: "abc123",
								statusCheckRollup: {
									state: "FAILURE",
									contexts: {
										nodes: [
											{
												__typename: "CheckRun",
												name: "test",
												conclusion: "FAILURE",
												detailsUrl: "https://x/1",
												checkSuite: { workflowRun: { databaseId: 99 } },
											},
											{ __typename: "CheckRun", name: "lint", conclusion: null },
											{ __typename: "StatusContext", context: "ci/legacy", state: "ERROR" },
										],
									},
								},
							},
						},
					],
				},
			},
		},
	},
};

test("parses PR state, threads and check runs from the GraphQL response", () => {
	const snapshot = parsePrSnapshot(response);
	expect(snapshot).not.toBeNull();
	if (!snapshot) return;
	expect(snapshot.state).toBe("OPEN");
	expect(snapshot.headRefOid).toBe("abc123");
	expect(snapshot.checks).toBe("failure");
	expect(snapshot.threads).toHaveLength(1);
	expect(snapshot.threads[0]?.originalLine).toBe(12);
	expect(snapshot.threads[0]?.line).toBeUndefined();
	expect(snapshot.threads[0]?.comments.map((c) => c.databaseId)).toEqual([101]);
	expect(snapshot.checkRuns).toEqual([
		{ name: "test", conclusion: "failure", detailsUrl: "https://x/1", runId: 99 },
		{ name: "lint", conclusion: null },
		{ name: "ci/legacy", conclusion: "error" },
	]);
	expect(snapshot.checkRuns.filter(isFailedCheck).map((c) => c.name)).toEqual([
		"test",
		"ci/legacy",
	]);
});

test("a non-PR or malformed response is null", () => {
	expect(parsePrSnapshot(null)).toBeNull();
	expect(parsePrSnapshot({ data: { repository: { pullRequest: null } } })).toBeNull();
	expect(
		parsePrSnapshot({
			data: { repository: { pullRequest: { number: 1, state: "DRAFT", headRefOid: "x" } } },
		}),
	).toBeNull();
});

test("self-loop guard ignores our login and either agent's marker", () => {
	expect(isIgnoredComment({ author: "Me", body: "hi" }, "me")).toBe(true);
	expect(isIgnoredComment({ author: "bob", body: "[helios-babysit] Fixed in abc" }, "me")).toBe(
		true,
	);
	expect(isIgnoredComment({ author: "bob", body: "[helios-review] Warning" }, undefined)).toBe(
		true,
	);
	expect(isIgnoredComment({ author: "bob", body: "please fix" }, "me")).toBe(false);
});

test("log tail keeps the end within both bounds", () => {
	const log = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
	expect(tailLog(log, 3, 1000)).toBe("line 497\nline 498\nline 499");
	expect(tailLog("x".repeat(50), 10, 10)).toHaveLength(10);
});
