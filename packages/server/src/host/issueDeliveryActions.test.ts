import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueDeliveryRemote, IssueMergeRequest } from "../issues";
import { createIssueConfirmationStore } from "./issueConfirmations";
import { createIssueDeliveryActions, type DeliveryPayload } from "./issueDeliveryActions";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function fixture() {
	const root = mkdtempSync(join(tmpdir(), "issue-delivery-"));
	roots.push(root);
	const journal = createIssueConfirmationStore(root);
	const reference = {
		provider: "github" as const,
		instanceUrl: "https://github.com",
		projectId: "123",
		number: 38,
	};
	const binding = {
		sessionId: "session",
		projectId: "primary",
		workspaceId: "primary-workspace",
		reference,
		stage: "implementation" as "implementation" | "design",
		locale: "en",
	};
	const repository = {
		projectId: "associated",
		workspaceId: "associated-workspace",
		path: "/associated",
		name: "Associated",
		role: "associated" as const,
	};
	const state = { sha: "a".repeat(40), branch: "feature/38", dirty: false };
	const host = {
		repositoryId: "456",
		url: "https://github.com/owner/associated.git",
		targetBranch: "develop",
	};
	const issue = {
		iid: 38,
		title: "Issue",
		description: "Description",
		state: "opened" as "opened" | "closed",
		labels: ["workflow::in-review"],
		updatedAt: "1",
	};
	let requests: IssueMergeRequest[] = [];
	let answered = false;
	let failCreate = false;
	let createdOverrides: Partial<IssueMergeRequest> = {};
	let race = false;
	const effects: unknown[] = [];
	const authorizations: unknown[] = [];
	const request = (): IssueMergeRequest => ({
		id: 91,
		iid: 9,
		webUrl: "https://github.com/owner/associated/pull/9",
		state: "opened",
		sourceBranch: "feature/38",
		targetBranch: "develop",
		sha: "a".repeat(40),
		draft: true,
		sourceProjectId: 456,
		targetProjectId: 456,
		mergeStatus: "unknown",
		detailedMergeStatus: null,
		mergeCommitSha: null,
		squashCommitSha: null,
		headPipeline: null,
	});
	const remote: IssueDeliveryRemote = {
		provider: "github",
		project: async () => ({
			id: 456,
			pathWithNamespace: "owner/associated",
			defaultBranch: "develop",
			httpUrlToRepo: host.url,
			sshUrlToRepo: null,
		}),
		issue: async () => structuredClone(issue),
		closeIssue: async () => ({
			...issue,
			state: "closed" as const,
			closedAt: "2026-11-13T00:00:00Z",
		}),
		issues: async () => [],
		notes: async () => [],
		addNote: async () => {
			throw new Error("Unexpected comment");
		},
		updateIssue: async () => {
			throw new Error("Unexpected Issue update");
		},
		mergeRequest: async (iid) => {
			const current = requests.find((item) => item.iid === iid);
			if (!current) throw new Error("Missing request");
			return structuredClone(current);
		},
		setMergeRequestReady: async (iid) => {
			const current = requests.find((item) => item.iid === iid);
			if (!current) throw new Error("Missing request");
			return { ...current, draft: false };
		},
		mergeMergeRequest: async (iid) => {
			const current = requests.find((item) => item.iid === iid);
			if (!current) throw new Error("Missing request");
			return { ...current, state: "merged" };
		},
		targetBranchSha: async () => "b".repeat(40),
		mergeRequests: async () => structuredClone(requests),
		createMergeRequest: async (input) => {
			effects.push(input);
			if (failCreate) throw new Error("uncertain create");
			return { ...request(), ...createdOverrides };
		},
	};
	const actions = createIssueDeliveryActions({
		binding: async () => structuredClone(binding),
		access: async () => ({ remote, guard: () => {} }),
		repositories: async () => [structuredClone(repository)],
		checkout: async () => structuredClone(state),
		repositoryRemote: async () => ({ ...host, remote }),
		push: async (repo, input, onDispatch) => {
			onDispatch();
			effects.push({ repository: repo.projectId, ...input });
			requests = requests.map((entry) =>
				["opened", "locked"].includes(entry.state) ? { ...entry, sha: input.sha } : entry,
			);
			if (race) requests = [request()];
		},
		verifyAnswer: async (_sessionId, _payload: DeliveryPayload, toolCallId) => {
			if (!answered || toolCallId !== "answer") throw new Error("Unverified answer");
		},
		authorize: async (_sessionId: string, _payload: DeliveryPayload, authorization: unknown) => {
			authorizations.push(authorization);
		},
		journal,
	});
	const prepare = (targetBranch?: string) =>
		actions.prepare("session", {
			operationId: "deliver",
			projectId: "associated",
			title: "Deliver exact title",
			body: "Exact draft body",
			...(targetBranch === undefined ? {} : { targetBranch }),
		});
	return {
		actions,
		journal,
		prepare,
		effects,
		authorizations,
		binding,
		repository,
		state,
		host,
		issue,
		request,
		approve: () => {
			answered = true;
		},
		setRequests: (value: IssueMergeRequest[]) => {
			requests = value;
		},
		fail: () => {
			failCreate = true;
		},
		invalid: () => {
			createdOverrides = { draft: false };
		},
		created: (overrides: Partial<IssueMergeRequest>) => {
			createdOverrides = overrides;
		},
		race: () => {
			race = true;
		},
	};
}

test("delivery needs no prior implementation receipt and pushes the reviewed current SHA", async () => {
	const f = await fixture();
	const card = await f.prepare();
	expect(card.questions.questions[0]?.options).toEqual([
		{ label: "Looks right", description: expect.any(String) },
	]);
	const preview = card.questions.questions[0]?.preview;
	for (const text of ["Exact draft body", f.state.sha, f.host.url, "develop", "Non-force push"])
		expect(preview).toContain(text);
	await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
	expect(f.effects).toEqual([]);
	f.approve();
	expect(await f.actions.execute("session", "deliver", "answer")).toEqual({
		stage: "delivery",
		projectId: "associated",
		sha: f.state.sha,
		url: f.request().webUrl,
		number: 9,
		created: true,
	});
	expect(f.effects).toEqual([
		{ repository: "associated", sha: f.state.sha, branch: f.state.branch, url: f.host.url },
		{
			sourceBranch: f.state.branch,
			targetBranch: "develop",
			title: "Deliver exact title",
			description: "Exact draft body",
			draft: true,
		},
	]);
	await f.actions.execute("session", "deliver", "answer");
	expect(f.effects).toHaveLength(2);
});

test("historical implementation commits do not block review of the current checkout", async () => {
	const f = await fixture();
	const old = await f.journal.prepare("old-session", "old-implementation", {
		stage: "implementation",
		report: "Earlier implementation",
		commits: [{ ...f.repository, sha: "b".repeat(40), branch: "old-branch" }],
	});
	await f.journal.execute(
		"old-session",
		"old-implementation",
		old.digest,
		"old-answer",
		async () => ({
			stage: "implementation",
			noteId: 7,
		}),
	);
	const card = await f.prepare();
	expect(card.questions.questions[0]?.preview).toContain(f.state.sha);
	expect(card.questions.questions[0]?.preview).toContain(f.state.branch);
	expect(f.effects).toEqual([]);
});

test("a closed Issue offers a warned one-shot card rather than a permanent delivery block", async () => {
	const f = await fixture();
	f.issue.state = "closed";
	await expect(f.prepare()).rejects.toMatchObject({
		code: "ISSUE_DELIVERY_REFUSED",
		message: expect.stringContaining("continueDespiteChecks:true"),
	});
	const card = await f.actions.prepare("session", {
		operationId: "deliver",
		projectId: f.repository.projectId,
		title: "Deliver exact title",
		body: "Exact draft body",
		continueDespiteChecks: true,
	});
	expect(card.questions.questions[0]?.preview).toContain("ONE-SHOT EXCEPTION");
	expect(card.questions.questions[0]?.preview).toContain("issue-not-open");
	await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
	expect(f.effects).toEqual([]);
	f.approve();
	await f.actions.execute("session", "deliver", "answer");
	expect(f.effects).toHaveLength(2);
	expect(f.issue.state).toBe("closed");
});

test("one exact existing PR is reused without push or modification", async () => {
	const f = await fixture();
	f.setRequests([f.request()]);
	expect((await f.prepare()).questions.questions[0]?.preview).toContain("Reuse existing");
	f.approve();
	expect(await f.actions.execute("session", "deliver", "answer")).toMatchObject({
		created: false,
		number: 9,
	});
	expect(f.effects).toEqual([]);
});

test("an older MR head can be updated repeatedly without creating another request", async () => {
	const f = await fixture();
	f.setRequests([{ ...f.request(), sha: "b".repeat(40) }]);
	const card = await f.prepare();
	expect(card.questions.questions[0]?.preview).toContain("Update existing PR/MR #9");
	expect(card.questions.questions[0]?.preview).toContain("b".repeat(40));
	f.approve();
	const result = await f.actions.execute("session", "deliver", "answer");
	expect(result).toMatchObject({ number: 9, created: false, sha: f.state.sha });
	expect(f.effects).toHaveLength(1);
	f.state.sha = "c".repeat(40);
	await f.actions.prepare("session", {
		operationId: "deliver-next",
		projectId: f.repository.projectId,
		title: "Fix CI",
		body: "New committed repair",
	});
	await f.actions.execute("session", "deliver-next", "answer");
	expect(f.effects).toHaveLength(2);
	expect(f.effects[1]).toMatchObject({ sha: "c".repeat(40) });
});

test("pipeline and review metadata changes do not block a confirmed MR update", async () => {
	const f = await fixture();
	const old = { ...f.request(), sha: "b".repeat(40) };
	f.setRequests([old]);
	await f.prepare();
	f.setRequests([{ ...old, mergeStatus: "can_be_merged", detailedMergeStatus: "ci_must_pass" }]);
	f.approve();
	await f.actions.execute("session", "deliver", "answer");
	expect(f.effects).toHaveLength(1);
});

test("recovery observes the same updated MR without dispatching another push", async () => {
	const f = await fixture();
	f.setRequests([{ ...f.request(), sha: "b".repeat(40) }]);
	await f.prepare();
	const stored = await f.journal.get("session", "deliver");
	if (!stored) throw new Error("Missing payload");
	await expect(f.actions.observe("session", stored.payload as DeliveryPayload)).rejects.toThrow();
	f.setRequests([f.request()]);
	const observed = await f.actions.observe("session", stored.payload as DeliveryPayload);
	expect(observed.result).toMatchObject({ number: 9, sha: f.state.sha, created: false });
	expect(f.effects).toEqual([]);
	f.setRequests([{ ...f.request(), id: 92, iid: 10 }]);
	await expect(f.actions.observe("session", stored.payload as DeliveryPayload)).rejects.toThrow();
});

test("prepare refuses design stage, invalid SHA and missing default", async () => {
	for (const mutate of [
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.binding.stage = "design";
		},
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.state.sha = "a".repeat(41);
		},
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.host.targetBranch = "";
		},
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.host.targetBranch = f.state.branch;
		},
	]) {
		const f = await fixture();
		mutate(f);
		await expect(f.prepare()).rejects.toThrow();
		expect(f.effects).toEqual([]);
	}
});

test("prepare identifies checkout and existing-request refusals without exposing private data", async () => {
	for (const [reason, mutate] of [
		[
			"source-branch-invalid",
			(f: Awaited<ReturnType<typeof fixture>>) => {
				f.state.branch = "";
			},
		],
		[
			"target-equals-source",
			(f: Awaited<ReturnType<typeof fixture>>) => {
				f.host.targetBranch = f.state.branch;
			},
		],
	] as const) {
		const f = await fixture();
		mutate(f);
		await expect(f.prepare()).rejects.toMatchObject({
			code: "ISSUE_DELIVERY_REFUSED",
			message: expect.stringContaining(`[${reason}]`),
		});
		expect(f.effects).toEqual([]);
	}
});

test("deterministic snapshot mismatch before intent remains prepared for corrected confirmation", async () => {
	const f = await fixture();
	await f.prepare();
	f.approve();
	f.state.sha = "b".repeat(40);
	await expect(f.actions.execute("session", "deliver", "answer")).rejects.toMatchObject({
		message: expect.stringContaining("checkout-commit-changed"),
	});
	expect(await f.journal.inspect("session", "deliver")).toMatchObject({ status: "prepared" });
	expect(f.effects).toEqual([]);
});

test("local edits do not block authorization or change the pushed commit", async () => {
	const f = await fixture();
	f.state.dirty = true;
	const card = await f.prepare();
	expect(card.questions.questions[0]?.preview).toContain(
		"Uncommitted workspace changes are excluded",
	);
	f.state.dirty = false;
	f.approve();
	await f.actions.execute("session", "deliver", "answer");
	expect(f.effects[0]).toMatchObject({ sha: f.state.sha, branch: f.state.branch });
});

test("local edits made after review do not invalidate the committed snapshot", async () => {
	const f = await fixture();
	await f.prepare();
	f.state.dirty = true;
	f.approve();
	await f.actions.execute("session", "deliver", "answer");
	expect(f.effects).toHaveLength(2);
});

test("explicit target is frozen instead of guessing main", async () => {
	const f = await fixture();
	f.host.targetBranch = "";
	expect((await f.prepare("release")).questions.questions[0]?.preview).toContain("Target: release");
});

for (const state of ["merged", "closed"] as const) {
	test(`a ${state} historical MR allows a new delivery on the same Issue branch`, async () => {
		const f = await fixture();
		f.setRequests([{ ...f.request(), id: 90, iid: 8, state, sha: "b".repeat(40) }]);
		const card = await f.prepare();
		expect(card.questions.questions[0]?.preview).toContain("create a draft PR/MR");
		f.approve();
		expect(await f.actions.execute("session", "deliver", "answer")).toMatchObject({
			created: true,
			sha: f.state.sha,
		});
		expect(f.effects).toHaveLength(2);
	});
}

test("historical requests do not make one open request ambiguous", async () => {
	const f = await fixture();
	f.setRequests([
		{ ...f.request(), id: 90, iid: 8, state: "merged", sha: "b".repeat(40) },
		{ ...f.request(), id: 89, iid: 7, state: "closed" },
		f.request(),
	]);
	expect((await f.prepare()).questions.questions[0]?.preview).toContain("Reuse existing PR/MR #9");
	f.approve();
	await f.actions.execute("session", "deliver", "answer");
	expect(f.effects).toEqual([]);
});

test("ambiguous or locked active PRs fail closed", async () => {
	for (const requests of [
		(f: Awaited<ReturnType<typeof fixture>>) => [f.request(), { ...f.request(), iid: 10 }],
		(f: Awaited<ReturnType<typeof fixture>>) => [{ ...f.request(), state: "locked" as const }],
	]) {
		const f = await fixture();
		f.setRequests(requests(f));
		await expect(f.prepare()).rejects.toThrow();
		expect(f.effects).toEqual([]);
	}
});

test("changed checkout, repository path, remote identity, target or Issue invalidates execution before push", async () => {
	for (const mutate of [
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.state.sha = "b".repeat(40);
		},
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.state.branch = "other";
		},
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.repository.path = "/replaced";
		},
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.host.repositoryId = "789";
		},
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.host.url += "replaced";
		},
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.host.targetBranch = "release";
		},
		(f: Awaited<ReturnType<typeof fixture>>) => {
			f.issue.updatedAt = "2";
		},
	]) {
		const f = await fixture();
		await f.prepare();
		f.approve();
		mutate(f);
		await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
		expect(f.effects).toEqual([]);
		expect((await f.journal.inspect?.("session", "deliver"))?.status).toBe("prepared");
	}
});

test("a PR appearing after confirmation is never adopted", async () => {
	const f = await fixture();
	await f.prepare();
	f.approve();
	f.setRequests([f.request()]);
	await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
	expect(f.effects).toEqual([]);
});

test("post-push failure, malformed draft response and concurrent PR retain pending reservation with no replay", async () => {
	for (const mode of ["fail", "invalid", "race"] as const) {
		const f = await fixture();
		await f.prepare();
		f.approve();
		f[mode]();
		await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
		const count = f.effects.length;
		expect(count).toBeGreaterThan(0);
		await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
		expect(f.effects).toHaveLength(count);
		expect(
			(await f.journal.listCompleted()).filter((entry) => entry.operationId === "deliver"),
		).toEqual([]);
		await expect(f.journal.prepare("session", "another", {})).rejects.toThrow();
	}
});

test("created PR identity, branches, SHA and draft flag must match the frozen request", async () => {
	for (const overrides of [
		{ id: 0 },
		{ iid: 0 },
		{ sourceBranch: "other" },
		{ targetBranch: "other" },
		{ sha: "b".repeat(40) },
		{ sha: "a".repeat(7) },
		{ sha: null },
		{ sourceProjectId: 789 },
		{ sourceProjectId: null },
		{ targetProjectId: 789 },
		{ targetProjectId: null },
		{ draft: null },
		{ state: "closed" as const },
		{ webUrl: "https://secret@example.com/pull/9" },
	]) {
		const f = await fixture();
		await f.prepare();
		f.approve();
		f.created(overrides);
		await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
		expect(f.effects).toHaveLength(2);
		await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
		expect(f.effects).toHaveLength(2);
	}
});

test("existing same-branch fork, unknown repository IDs and inexact SHA fail closed", async () => {
	for (const overrides of [
		{ sourceProjectId: 789 },
		{ sourceProjectId: null },
		{ targetProjectId: 789 },
		{ targetProjectId: null },
		{ sha: null },
		{ sha: "a".repeat(7) },
	]) {
		const f = await fixture();
		f.setRequests([{ ...f.request(), ...overrides }]);
		await expect(f.prepare()).rejects.toThrow();
		expect(f.effects).toEqual([]);
	}
});

test("authenticated repository identity is numeric and frozen in the delivery payload", async () => {
	const f = await fixture();
	await f.prepare();
	expect((await f.journal.get("session", "deliver"))?.payload).toMatchObject({
		repositoryId: "456",
	});
	for (const repositoryId of ["", "associated", "0", "-1", "1.5", "0456", "9007199254740992"]) {
		const invalid = await fixture();
		invalid.host.repositoryId = repositoryId;
		await expect(invalid.prepare()).rejects.toThrow();
		expect(invalid.effects).toEqual([]);
	}
});

for (const older of [false, true]) {
	test(`warned locked request ${older ? "updates" : "reuses"} only after exact review`, async () => {
		const f = await fixture();
		f.setRequests([{ ...f.request(), state: "locked", ...(older ? { sha: "b".repeat(40) } : {}) }]);
		await expect(f.prepare()).rejects.toThrow("existing-request-identity-invalid");
		const card = await f.actions.prepare("session", {
			operationId: "deliver",
			projectId: f.repository.projectId,
			title: "Deliver",
			body: "Body",
			continueDespiteChecks: true,
		});
		expect(card.questions.questions[0]?.preview).toContain("state locked");
		await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
		expect(f.effects).toEqual([]);
		f.approve();
		await f.actions.execute("session", "deliver", "answer");
		expect(f.effects).toHaveLength(older ? 1 : 0);
	});
}

test("collector includes multiple checks and changed candidate facts require fresh review", async () => {
	const f = await fixture();
	f.issue.state = "closed";
	f.setRequests([{ ...f.request(), state: "locked" }]);
	const card = await f.actions.prepare("session", {
		operationId: "deliver",
		projectId: f.repository.projectId,
		title: "Deliver",
		body: "Body",
		continueDespiteChecks: true,
	});
	expect(card.questions.questions[0]?.preview).toContain("issue-not-open");
	expect(card.questions.questions[0]?.preview).toContain("existing-request-identity-invalid");
	f.approve();
	f.setRequests([{ ...f.request(), state: "locked", sourceProjectId: 789 }]);
	await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
	expect(f.effects).toEqual([]);
	expect(await f.journal.inspect("session", "deliver")).toMatchObject({ status: "prepared" });
});

test("warned fork and unknown-head cards disclose risk without authorizing a wrong push", async () => {
	for (const overrides of [{ sourceProjectId: 789 }, { targetProjectId: null }, { sha: null }]) {
		const f = await fixture();
		f.setRequests([{ ...f.request(), ...overrides }]);
		const card = await f.actions.prepare("session", {
			operationId: "deliver",
			projectId: f.repository.projectId,
			title: "Deliver",
			body: "Body",
			continueDespiteChecks: true,
		});
		expect(card.questions.questions[0]?.preview).toContain("ONE-SHOT EXCEPTION");
		if (!("sha" in overrides)) {
			expect(card.questions.questions[0]?.preview).toContain("Expected repository 456");
			expect(card.questions.questions[0]?.preview).toContain("Risk:");
		}
		f.approve();
		await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
		expect(f.effects).toEqual([]);
	}
});

test("override cannot expose credential-bearing URLs or invent a repository selection", async () => {
	for (const mode of ["url", "request", "repository"] as const) {
		const f = await fixture();
		if (mode === "url") f.host.url = "https://private-secret@example.com/repo.git";
		if (mode === "request")
			f.setRequests([{ ...f.request(), webUrl: "https://private-secret@example.com/pull/9" }]);
		let error: unknown;
		try {
			await f.actions.prepare("session", {
				operationId: "deliver",
				projectId: mode === "repository" ? "missing" : f.repository.projectId,
				title: "Deliver",
				body: "Body",
				continueDespiteChecks: true,
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeDefined();
		expect(String(error)).not.toContain("private-secret");
		if (mode === "repository") expect(String(error)).toContain("select-explicit-repository");
		expect(await f.journal.get("session", "deliver")).toBeNull();
		expect(f.effects).toEqual([]);
	}
});

for (const policy of ["session-stage", "same-target"] as const) {
	test(`warned ${policy} can attempt mechanically valid delivery with unchanged facts`, async () => {
		const f = await fixture();
		if (policy === "session-stage") f.binding.stage = "design";
		else f.state.branch = f.host.targetBranch;
		await expect(f.prepare()).rejects.toThrow();
		const card = await f.actions.prepare("session", {
			operationId: "deliver",
			projectId: f.repository.projectId,
			title: "Deliver",
			body: "Body",
			continueDespiteChecks: true,
		});
		expect(card.questions.questions[0]?.preview).toContain("ONE-SHOT EXCEPTION");
		f.approve();
		f.created({ sourceBranch: f.state.branch });
		await f.actions.execute("session", "deliver", "answer");
		expect(f.effects).toHaveLength(2);
	});
}

test("warned delivery still freezes checkout SHA and branch", async () => {
	for (const fact of ["sha", "branch"] as const) {
		const f = await fixture();
		f.issue.state = "closed";
		await f.actions.prepare("session", {
			operationId: "deliver",
			projectId: f.repository.projectId,
			title: "Deliver",
			body: "Body",
			continueDespiteChecks: true,
		});
		f.approve();
		f.state[fact] = fact === "sha" ? "b".repeat(40) : "changed";
		await expect(f.actions.execute("session", "deliver", "answer")).rejects.toThrow();
		expect(f.effects).toEqual([]);
	}
});

test("delivery accepts only the host-provided policy authorization path", async () => {
	const f = await fixture();
	await f.prepare();
	const authorization = { policyOperationId: "policy", payloadDigest: "digest" };
	await f.actions.execute("session", "deliver", "policy-call", authorization);
	expect(f.authorizations).toEqual([authorization]);
	expect((await f.journal.inspect("session", "deliver")).status).toBe("completed");
});
