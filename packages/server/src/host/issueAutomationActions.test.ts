import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueMergeRequest } from "../issues";
import { createIssueAutomationActions, type IssueAutomationPolicy } from "./issueAutomationActions";
import { createIssueConfirmationStore } from "./issueConfirmations";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const ref = {
	provider: "github" as const,
	instanceUrl: "https://github.com",
	projectId: "1",
	number: 62,
};
const repository = {
	projectId: "repo",
	workspaceId: "workspace",
	sourceBranch: "feature",
	targetBranch: "main",
	repositoryId: "42",
};
function setup(
	root: string,
	mode: IssueAutomationPolicy["mode"],
	closeIssue = false,
	includeValidation = true,
	requiresUpstream = false,
) {
	const journal = createIssueConfirmationStore(root);
	let sha = baseSha;
	let readiness = { checks: "pending", approval: "pending" };
	let request: IssueMergeRequest = {
		id: 9,
		iid: 7,
		webUrl: "https://github.com/1/7",
		state: "opened",
		draft: true,
		sha: baseSha,
		sourceBranch: "feature",
		targetBranch: "main",
		sourceProjectId: 42,
		targetProjectId: 42,
		mergeStatus: "can_be_merged",
		detailedMergeStatus: "mergeable",
		mergeCommitSha: null,
		squashCommitSha: null,
		headPipeline: null,
	};
	const calls: string[] = [];
	const common = {
		journal,
		binding: async (sessionId: string) => ({ sessionId, reference: ref }),
		repositories: async () => [repository],
		checkout: async () => ({ sha, branch: "feature" }),
		isAncestor: async (
			_sessionId: string,
			_repo: typeof repository,
			ancestor: string,
			descendant: string,
		) => ancestor === baseSha && [baseSha, headSha].includes(descendant),
		verifyAnswer: async () => {},
		request: async () => request,
		readiness: async () => readiness,
		deliveryState: async () => ({
			revision: 1,
			repositories: [
				{
					projectId: repository.projectId,
					worktreeId: repository.workspaceId,
					sourceBranch: repository.sourceBranch,
					policy: mode,
					targetBranch: repository.targetBranch,
					dependsOn: requiresUpstream ? ["upstream"] : [],
					checkoutSha: sha,
					checkoutTree: "c".repeat(40),
					validations: includeValidation
						? [
								{
									result: "passed",
									source: "host-observed",
									sha,
									tree: "c".repeat(40),
									targetBranch: repository.targetBranch,
								},
							]
						: [],
				},
			],
		}),
		dependencyPreflight: async () => {
			calls.push("dependency-preflight");
			return { version: 1, snapshot: "evidence" } as never;
		},
		observeMerged: async () => request.state === "merged",
		delivery: {
			prepare: async (
				sessionId: string,
				input: {
					operationId: string;
					projectId: string;
					title: string;
					body: string;
					targetBranch: string;
				},
			) =>
				journal.prepare(sessionId, input.operationId, {
					stage: "delivery",
					sessionId,
					operationId: input.operationId,
					reference: ref,
					repository: { ...repository, name: "repo", path: "/repo", role: "primary" },
					repositoryId: "42",
					title: input.title,
					body: input.body,
					sha,
					branch: "feature",
					url: "https://github.com/1/repo.git",
					targetBranch: input.targetBranch,
					hostTargetBranch: input.targetBranch,
					issueSnapshot: {},
					existing: null,
				}),
			execute: async (
				sessionId: string,
				operationId: string,
				toolCallId: string,
				auth?: unknown,
			) => {
				const stored = await journal.get(sessionId, operationId);
				if (!stored) throw new Error("delivery missing");
				return journal.execute(
					sessionId,
					operationId,
					stored.digest,
					toolCallId,
					async () => {
						calls.push("delivery");
						return { number: 7, sha };
					},
					async () => {
						if (!auth) throw new Error("policy authorization missing");
					},
				);
			},
		},
		mergeRequest: {
			prepare: async (
				sessionId: string,
				action: "ready-mr" | "merge-mr",
				input: {
					operationId: string;
					projectId: string;
					iid: number;
					targetBranch: string;
					expectedSha: string;
				},
			) =>
				journal.prepare(sessionId, input.operationId, {
					stage: action,
					sessionId,
					operationId: input.operationId,
					reference: ref,
					repository,
					repositoryId: "42",
					iid: input.iid,
					targetBranch: input.targetBranch,
					expectedSha: input.expectedSha,
					targetSha: baseSha,
					before: request,
				}),
			execute: async (
				sessionId: string,
				operationId: string,
				toolCallId: string,
				auth?: unknown,
			) => {
				const stored = await journal.get(sessionId, operationId);
				if (!stored) throw new Error("MR missing");
				return journal.execute(sessionId, operationId, stored.digest, toolCallId, async () => {
					if (!auth) throw new Error("policy authorization missing");
					const stage = (stored.payload as { stage: string }).stage;
					calls.push(stage);
					if (stage === "ready-mr") request = { ...request, draft: false };
					else request = { ...request, state: "merged" };
					return { stage, iid: 7 };
				});
			},
		},
		close: {
			prepare: async (
				sessionId: string,
				input: { operationId: string; reason: string; acceptance: string },
			) =>
				journal.prepare(sessionId, input.operationId, {
					stage: "close-issue",
					sessionId,
					operationId: input.operationId,
					reference: ref,
					reason: input.reason,
					acceptance: input.acceptance,
				}),
			execute: async (
				sessionId: string,
				operationId: string,
				toolCallId: string,
				auth?: unknown,
			) => {
				const stored = await journal.get(sessionId, operationId);
				if (!stored) throw new Error("close missing");
				return journal.execute(sessionId, operationId, stored.digest, toolCallId, async () => {
					if (!auth) throw new Error("policy authorization missing");
					calls.push("close");
					return { closed: true };
				});
			},
		},
	};
	const actions = createIssueAutomationActions(common);
	async function authorize() {
		await actions.prepare("session", {
			operationId: "policy",
			projectId: "repo",
			title: "Frozen title",
			body: "Frozen body",
			mode,
			closeIssue,
			reason: closeIssue ? "Resolved" : "",
			acceptance: closeIssue ? "Accepted" : "",
		});
		await actions.execute("session", "policy", "policy-call");
	}
	return {
		actions,
		journal,
		calls,
		authorize,
		setHead(value: string) {
			sha = value;
		},
		setReadiness(value: typeof readiness) {
			readiness = value;
		},
		setRequest(value: IssueMergeRequest) {
			request = value;
		},
	};
}
function temp(run: (root: string) => Promise<void>) {
	return async () => {
		const root = mkdtempSync(join(tmpdir(), "issue-automation-"));
		try {
			await run(root);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	};
}
test(
	"draft delivers frozen content once and stops",
	temp(async (root) => {
		const s = setup(root, "draft");
		await s.authorize();
		const result = await s.actions.advance("session", "policy", "repo");
		expect(result.status).toBe("completed");
		expect(s.calls).toEqual(["delivery"]);
		expect((await s.actions.advance("session", "policy", "repo")).status).toBe("completed");
		expect(s.calls).toEqual(["delivery"]);
	}),
);
test(
	"auto-merge delivers, readies, waits, merges, then independently closes",
	temp(async (root) => {
		const s = setup(root, "auto-merge", true);
		await s.authorize();
		expect((await s.actions.advance("session", "policy", "repo")).status).toBe("waiting");
		expect(s.calls).toEqual(["delivery", "ready-mr"]);
		s.setReadiness({ checks: "passed", approval: "satisfied" });
		expect((await s.actions.advance("session", "policy", "repo")).status).toBe("completed");
		expect(s.calls).toEqual(["delivery", "ready-mr", "merge-mr", "close"]);
	}),
);
test(
	"completed receipts resume after restart without repeating writes",
	temp(async (root) => {
		const first = setup(root, "draft");
		await first.authorize();
		await first.actions.advance("session", "policy", "repo");
		const resumed = setup(root, "draft");
		expect((await resumed.actions.advance("session", "policy", "repo")).status).toBe("completed");
		expect(resumed.calls).toEqual([]);
	}),
);
test(
	"descendant checkout is allowed, but changed target/repository binding is rejected",
	temp(async (root) => {
		const s = setup(root, "draft");
		await s.authorize();
		s.setHead(headSha);
		expect((await s.actions.advance("session", "policy", "repo")).status).toBe("completed");
	}),
);
test(
	"advance refuses a policy without a completed receipt",
	temp(async (root) => {
		const s = setup(root, "draft");
		await s.actions.prepare("session", {
			operationId: "policy",
			projectId: "repo",
			title: "T",
			body: "B",
			mode: "draft",
			closeIssue: false,
			reason: "",
			acceptance: "",
		});
		await expect(s.actions.advance("session", "policy", "repo")).rejects.toThrow();
	}),
);
test(
	"uncertain child is never replayed",
	temp(async (root) => {
		const s = setup(root, "draft");
		await s.authorize();
		const operationId = `auto:${"x"}`;
		const prepared = await s.journal.prepare("session", operationId, { stage: "delivery" });
		await expect(
			s.journal.execute("session", operationId, prepared.digest, "lost", async () => {
				throw new Error("uncertain write");
			}),
		).rejects.toThrow();
		await expect(s.actions.advance("session", "policy", "repo")).rejects.toThrow();
		expect(s.calls).toEqual([]);
	}),
);
test(
	"warnings and altered child identity cannot be implicitly authorized",
	temp(async (root) => {
		const s = setup(root, "draft");
		await s.authorize();
		const { policy } = await s.actions.proof("session", "policy");
		await expect(
			s.actions.authorizeChild(
				"session",
				{ stage: "delivery", sessionId: "session", reference: ref, warnings: ["unsafe"] },
				await s.actions.proof("session", "policy").then((value) => value.authorization),
			),
		).rejects.toThrow();
		await expect(
			s.actions.authorizeChild(
				"session",
				{
					stage: "delivery",
					sessionId: "session",
					reference: ref,
					repository,
					repositoryId: "wrong",
					sha: baseSha,
					branch: "feature",
					targetBranch: "main",
					title: policy.title,
					body: policy.body,
					operationId: "nope",
					existing: null,
				},
				(await s.actions.proof("session", "policy")).authorization,
			),
		).rejects.toThrow();
	}),
);
test(
	"automation refuses delivery when no validation evidence is recorded",
	temp(async (root) => {
		const s = setup(root, "draft", false, false);
		await s.authorize();
		await expect(s.actions.advance("session", "policy", "repo")).rejects.toThrow(
			"host-validation-evidence-required",
		);
		expect(s.calls).toEqual([]);
	}),
);

test(
	"automatic delivery rechecks cross-repository pairing before any remote write",
	temp(async (root) => {
		const s = setup(root, "draft", false, true, true);
		await s.authorize();
		await s.actions.advance("session", "policy", "repo");
		expect(s.calls).toEqual(["dependency-preflight", "dependency-preflight", "delivery"]);
	}),
);
