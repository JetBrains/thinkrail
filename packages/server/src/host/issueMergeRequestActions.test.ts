import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueConfirmationStore } from "./issueConfirmations";
import { createIssueMergeRequestActions } from "./issueMergeRequestActions";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "issue-mr-actions-"));
	const journal = createIssueConfirmationStore(root);
	const binding = {
		sessionId: "session",
		projectId: "local",
		workspaceId: "workspace",
		reference: {
			provider: "github" as const,
			instanceUrl: "https://github.com",
			projectId: "123",
			number: 62,
		},
		stage: "implementation" as const,
		locale: "en",
	};
	let mr = {
		id: 90,
		iid: 8,
		webUrl: "https://github.com/octo/app/pull/8",
		state: "opened" as "opened" | "merged",
		sourceBranch: "feature",
		targetBranch: "main",
		sha: "a".repeat(40),
		mergeStatus: "clean",
		sourceProjectId: 42,
		targetProjectId: 42,
		draft: false as boolean | null,
		detailedMergeStatus: "clean",
		mergeCommitSha: null as string | null,
		squashCommitSha: null,
		headPipeline: { id: 4, sha: "a".repeat(40), status: "success" },
	};
	let answered = false;
	let dispatched = 0;
	let targetSha = "b".repeat(40);
	let ancestry: "ancestor" | "not-ancestor" | "unknown" = "ancestor";
	let readinessState = {
		iid: 8,
		expectedSha: "a".repeat(40),
		actualSha: "a".repeat(40),
		sourceBranch: "feature",
		targetBranch: "main",
		checks: "passed" as "passed" | "failed" | "unknown" | "pending",
		approval: "satisfied" as "satisfied" | "unknown" | "required",
		snapshot: "reviewed-snapshot",
	};
	const remote = {
		project: async () => ({
			id: 42,
			pathWithNamespace: "octo/app",
			defaultBranch: "main",
			httpUrlToRepo: "https://github.com/octo/app.git",
			sshUrlToRepo: null,
		}),
		mergeRequest: async () => structuredClone(mr),
		mergeReadiness: async () => structuredClone(readinessState),
		setMergeRequestReady: async () => {
			dispatched++;
			mr = { ...mr, draft: false };
			return mr;
		},
		mergeMergeRequest: async (_iid: number, sha: string) => {
			dispatched++;
			mr = { ...mr, state: "merged", draft: false, sha, mergeCommitSha: "c".repeat(40) };
			targetSha = "c".repeat(40);
			return mr;
		},
		targetBranchSha: async () => targetSha,
		mergeEvidence: async () => ({
			iid: 8,
			targetBranch: "main",
			mergeCommitSha: "c".repeat(40),
			targetSha,
			relationship: ancestry,
			snapshot: "evidence",
		}),
	};
	const actions = createIssueMergeRequestActions({
		binding: async () => binding,
		access: async () => ({ remote, guard: () => {} }),
		repositories: async () => [
			{ projectId: "local", workspaceId: "workspace", path: "/repo", name: "app" },
		],
		verifyAnswer: async () => {
			if (!answered) throw new Error("missing receipt");
		},
		journal,
	});
	return {
		actions,
		journal,
		setDraft: (value: boolean) => {
			mr.draft = value;
		},
		approve: () => {
			answered = true;
		},
		get dispatched() {
			return dispatched;
		},
		setTarget: (value: string) => {
			targetSha = value;
		},
		setAncestry: (value: "ancestor" | "not-ancestor" | "unknown") => {
			ancestry = value;
		},
		setReadiness: (value: typeof readinessState) => {
			readinessState = value;
		},
		dispose: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("ready confirmation changes draft state only and returns without merging", async () => {
	const f = fixture();
	f.setDraft(true);
	try {
		const prepared = await f.actions.prepare("session", "ready-mr", {
			operationId: "ready",
			projectId: "local",
			iid: 8,
			targetBranch: "main",
			expectedSha: "a".repeat(40),
		});
		expect(prepared.questions.questions[0]?.preview).toContain("No merge is authorized");
		f.approve();
		expect(await f.actions.execute("session", "ready", "answer")).toMatchObject({
			draft: false,
			headSha: "a".repeat(40),
		});
		expect(f.dispatched).toBe(1);
	} finally {
		f.dispose();
	}
});

test("uncertain ready operation is observable without requiring the pre-ready draft snapshot", async () => {
	const f = fixture();
	f.setDraft(true);
	try {
		await f.actions.prepare("session", "ready-mr", {
			operationId: "ready",
			projectId: "local",
			iid: 8,
			targetBranch: "main",
			expectedSha: "a".repeat(40),
		});
		f.approve();
		const stored = await f.journal.get("session", "ready");
		if (!stored) throw new Error("missing operation");
		f.setDraft(false);
		await expect(
			f.actions.observe(
				"session",
				stored.payload as import("./issueMergeRequestActions").MergeRequestPayload,
			),
		).resolves.toMatchObject({ result: { stage: "ready-mr", headSha: "a".repeat(40) } });
		expect(f.dispatched).toBe(0);
	} finally {
		f.dispose();
	}
});

test("provider readiness unknown refuses the merge card", async () => {
	const f = fixture();
	f.setReadiness({
		iid: 8,
		expectedSha: "a".repeat(40),
		actualSha: "a".repeat(40),
		sourceBranch: "feature",
		targetBranch: "main",
		checks: "unknown",
		approval: "unknown",
		snapshot: "unknown",
	});
	try {
		await expect(
			f.actions.prepare("session", "merge-mr", {
				operationId: "merge",
				projectId: "local",
				iid: 8,
				targetBranch: "main",
				expectedSha: "a".repeat(40),
			}),
		).rejects.toThrow("checks-or-approval-evidence-incomplete");
		expect(f.dispatched).toBe(0);
	} finally {
		f.dispose();
	}
});

test("merge refuses when target branch ancestry cannot be proven", async () => {
	const f = fixture();
	f.setDraft(false);
	f.setAncestry("unknown");
	try {
		await f.actions.prepare("session", "merge-mr", {
			operationId: "merge",
			projectId: "local",
			iid: 8,
			targetBranch: "main",
			expectedSha: "a".repeat(40),
		});
		f.approve();
		await expect(f.actions.execute("session", "merge", "answer")).rejects.toThrow(
			"uncertain_intent",
		);
		expect(f.dispatched).toBe(1);
		const operation = await f.journal.get("session", "merge");
		if (!operation) throw new Error("missing merge intent");
		await expect(
			f.actions.observe(
				"session",
				operation.payload as import("./issueMergeRequestActions").MergeRequestPayload,
			),
		).rejects.toThrow("merge-ancestry-not-proven");
		expect(f.dispatched).toBe(1);
	} finally {
		f.dispose();
	}
});

test("merge executes with unchanged passed checks and approval evidence", async () => {
	const f = fixture();
	f.setDraft(false);
	try {
		await f.actions.prepare("session", "merge-mr", {
			operationId: "merge",
			projectId: "local",
			iid: 8,
			targetBranch: "main",
			expectedSha: "a".repeat(40),
		});
		f.approve();
		expect(await f.actions.execute("session", "merge", "answer")).toMatchObject({
			stage: "merge-mr",
			targetSha: "c".repeat(40),
			mergeCommitSha: "c".repeat(40),
		});
		expect(f.dispatched).toBe(1);
	} finally {
		f.dispose();
	}
});

test("a request moved back to draft refuses before merge dispatch", async () => {
	const f = fixture();
	f.setDraft(false);
	try {
		await f.actions.prepare("session", "merge-mr", {
			operationId: "merge",
			projectId: "local",
			iid: 8,
			targetBranch: "main",
			expectedSha: "a".repeat(40),
		});
		f.setDraft(true);
		f.approve();
		await expect(f.actions.execute("session", "merge", "answer")).rejects.toThrow(
			"request-no-longer-ready",
		);
		expect(f.dispatched).toBe(0);
	} finally {
		f.dispose();
	}
});

test("readiness changes after confirmation refuse before merge dispatch", async () => {
	const f = fixture();
	f.setDraft(false);
	try {
		await f.actions.prepare("session", "merge-mr", {
			operationId: "merge",
			projectId: "local",
			iid: 8,
			targetBranch: "main",
			expectedSha: "a".repeat(40),
		});
		f.setReadiness({
			iid: 8,
			expectedSha: "a".repeat(40),
			actualSha: "a".repeat(40),
			sourceBranch: "feature",
			targetBranch: "main",
			checks: "failed",
			approval: "satisfied",
			snapshot: "changed",
		});
		f.approve();
		await expect(f.actions.execute("session", "merge", "answer")).rejects.toThrow(
			"checks-or-approval-snapshot-changed",
		);
		expect(f.dispatched).toBe(0);
	} finally {
		f.dispose();
	}
});

test("pending checks and required approval refuse merge preparation", async () => {
	const f = fixture();
	f.setReadiness({
		iid: 8,
		expectedSha: "a".repeat(40),
		actualSha: "a".repeat(40),
		sourceBranch: "feature",
		targetBranch: "main",
		checks: "pending",
		approval: "required",
		snapshot: "pending",
	});
	try {
		await expect(
			f.actions.prepare("session", "merge-mr", {
				operationId: "merge",
				projectId: "local",
				iid: 8,
				targetBranch: "main",
				expectedSha: "a".repeat(40),
			}),
		).rejects.toThrow("checks-or-approval-evidence-incomplete");
		expect(f.dispatched).toBe(0);
	} finally {
		f.dispose();
	}
});
