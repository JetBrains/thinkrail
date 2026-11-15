import { describe, expect, test } from "bun:test";
import { createGitHubClient, type GitHubClientOptions } from "./github";

const token = "ghp_delivery_fixture_secret";
const options = { instanceUrl: "https://github.com", project: "octo/app", token };
function client(
	respond: (url: string, init: RequestInit) => Response | Promise<Response>,
	extra: Partial<GitHubClientOptions> = {},
) {
	const calls: { url: string; init: RequestInit }[] = [];
	const remote = createGitHubClient({
		...options,
		fetch: async (url, init) => {
			calls.push({ url, init });
			return respond(url, init);
		},
		...extra,
	});
	return { remote, calls };
}
const repository = {
	id: 42,
	full_name: "octo/app",
	default_branch: "main",
	clone_url: "https://github.com/octo/app.git",
	ssh_url: "git@github.com:octo/app.git",
};
const issuePayload = {
	number: 7,
	title: "Wire the rail",
	body: "Details",
	state: "open",
	labels: [{ name: "workflow::in-progress" }, { name: "type::bug" }],
	updated_at: "2026-01-01T00:00:00Z",
	html_url: "https://github.com/octo/app/issues/7",
};
async function sanitized(operation: () => Promise<unknown>) {
	try {
		await operation();
		throw new Error("unexpected success");
	} catch (error) {
		expect(error).toHaveProperty("code", "RESOURCE_UNAVAILABLE");
		expect(String(error)).not.toContain(token);
		expect(error).not.toHaveProperty("cause");
	}
}

function pullRequest(overrides: Record<string, unknown> = {}) {
	const head = {
		ref: "feature/topic",
		sha: "a".repeat(40),
		repo: { id: 42, full_name: "octo/app" },
	};
	const base = { ref: "main", repo: { id: 42, full_name: "octo/app" } };
	return {
		id: 90,
		number: 8,
		html_url: "https://github.com/octo/app/pull/8",
		state: "open",
		title: "Change",
		body: "Details",
		draft: true,
		merged: false,
		mergeable_state: "clean",
		merged_at: null,
		merge_commit_sha: null,
		head,
		base,
		...overrides,
	};
}

describe("GitHub Issue reads", () => {
	test("GitHub merge readiness binds GraphQL checks and review decision to REST head", async () => {
		const { remote } = client((url) => {
			const path = new URL(String(url)).pathname;
			if (path === "/repos/octo/app") return Response.json(repository);
			if (path === "/repos/octo/app/pulls/8") return Response.json(pullRequest({ draft: false }));
			if (path === "/graphql")
				return Response.json({
					data: {
						repository: {
							pullRequest: {
								number: 8,
								headRefName: "feature/topic",
								headRefOid: "a".repeat(40),
								baseRefName: "main",
								mergeStateStatus: "CLEAN",
								reviewDecision: "APPROVED",
								commits: {
									nodes: [
										{ commit: { oid: "a".repeat(40), statusCheckRollup: { state: "SUCCESS" } } },
									],
								},
							},
						},
					},
				});
			throw new Error(`Unexpected ${path}`);
		});
		if (!remote.mergeReadiness) throw new Error("merge readiness unsupported");
		await expect(remote.mergeReadiness(8, "a".repeat(40))).resolves.toMatchObject({
			checks: "passed",
			approval: "satisfied",
			sourceBranch: "feature/topic",
			targetBranch: "main",
		});
	});

	test("GitHub null check and review evidence remains unknown", async () => {
		const { remote } = client((url) => {
			const path = new URL(String(url)).pathname;
			if (path === "/repos/octo/app") return Response.json(repository);
			if (path === "/repos/octo/app/pulls/8") return Response.json(pullRequest({ draft: false }));
			if (path === "/graphql")
				return Response.json({
					data: {
						repository: {
							pullRequest: {
								number: 8,
								headRefName: "feature/topic",
								headRefOid: "a".repeat(40),
								baseRefName: "main",
								mergeStateStatus: "UNKNOWN",
								reviewDecision: null,
								commits: { nodes: [{ commit: { oid: "a".repeat(40), statusCheckRollup: null } }] },
							},
						},
					},
				});
			throw new Error(`Unexpected ${path}`);
		});
		if (!remote.mergeReadiness) throw new Error("merge readiness unsupported");
		await expect(remote.mergeReadiness(8, "a".repeat(40))).resolves.toMatchObject({
			checks: "unknown",
			approval: "unknown",
		});
	});

	test("marks a Draft PR ready without changing its source, target or head", async () => {
		let reads = 0;
		const { remote, calls } = client((url, init) => {
			const path = new URL(String(url)).pathname;
			if (path === "/repos/octo/app") return Response.json(repository);
			if (path === "/repos/octo/app/pulls/8" && init.method === "GET") {
				reads++;
				return Response.json({
					...pullRequest({ draft: reads > 1 ? false : true }),
					node_id: "PR_node_8",
				});
			}
			if (path === "/graphql")
				return Response.json({
					data: {
						markPullRequestReadyForReview: { pullRequest: { id: "PR_node_8", isDraft: false } },
					},
				});
			throw new Error(`Unexpected ${path} ${init.method}`);
		});
		await expect(remote.setMergeRequestReady(8)).resolves.toMatchObject({
			iid: 8,
			draft: false,
			sourceBranch: "feature/topic",
			targetBranch: "main",
		});
		expect(calls.find((call) => call.url.endsWith("/graphql"))?.init.method).toBe("POST");
	});

	test("merges only the frozen PR head and reads back the same source and target", async () => {
		let readback = pullRequest({ state: "open", draft: false });
		let mergeRequested = false;
		const { remote } = client((_url, init) => {
			const path = new URL(String(_url)).pathname;
			if (path === "/repos/octo/app") return Response.json(repository);
			if (path === "/repos/octo/app/pulls/8" && init.method === "GET") {
				if (mergeRequested)
					readback = pullRequest({
						state: "closed",
						draft: false,
						merged: true,
						merged_at: "2026-11-13T08:00:00Z",
					});
				return Response.json(readback);
			}
			if (path === "/repos/octo/app/pulls/8/merge") {
				mergeRequested = true;
				return Response.json({ merged: true, message: "Merged" });
			}
			if (path === "/repos/octo/app/branches/main")
				return Response.json({
					name: "main",
					_links: { self: "https://api.github.com/repos/octo/app/branches/main" },
					commit: { sha: "b".repeat(40) },
				});
			throw new Error(`Unexpected ${path} ${init.method}`);
		});
		const result = await remote.mergeMergeRequest(8, "a".repeat(40));
		expect(result).toMatchObject({ state: "merged", sha: "a".repeat(40), targetBranch: "main" });
		expect(await remote.targetBranchSha("main")).toBe("b".repeat(40));
		readback = pullRequest({
			...readback,
			base: { ref: "release", repo: { id: 42, full_name: "octo/app" } },
		});
		await sanitized(() => remote.mergeMergeRequest(8, "a".repeat(40)));
	});

	test("closes an Issue once and reads back its closed timestamp", async () => {
		const { remote, calls } = client(() =>
			Response.json({
				...issuePayload,
				state: "closed",
				closed_at: "2026-11-13T08:00:00Z",
			}),
		);
		await expect(remote.closeIssue(7)).resolves.toMatchObject({
			state: "closed",
			closedAt: "2026-11-13T08:00:00Z",
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.init).toMatchObject({
			method: "PATCH",
			body: JSON.stringify({ state: "closed" }),
		});
	});
	test("associating reads the repository and keeps its clone facts", async () => {
		const { remote, calls } = client(() => Response.json(repository));
		expect(await remote.project()).toEqual({
			id: 42,
			pathWithNamespace: "octo/app",
			defaultBranch: "main",
			httpUrlToRepo: "https://github.com/octo/app.git",
			sshUrlToRepo: "git@github.com:octo/app.git",
		});
		expect(calls[0]?.url).toBe("https://api.github.com/repos/octo/app");
		const headers = new Headers(calls[0]?.init.headers);
		expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
		expect(headers.get("Accept")).toBe("application/vnd.github+json");
		expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
		expect(calls[0]?.url).not.toContain(token);
		expect(remote.provider).toBe("github");
	});

	test("a numeric repository id addresses the repository without an owner path", async () => {
		const { remote, calls } = client(() => Response.json(repository), { project: 42 });
		await remote.project();
		expect(calls[0]?.url).toBe("https://api.github.com/repositories/42");
		await expect(
			client(() => Response.json({ ...repository, id: 43 }), { project: 42 }).remote.project(),
		).rejects.toHaveProperty("code", "RANGE_INVALID");
	});

	test("projects GitHub label colors without changing names or order", async () => {
		const { remote } = client(() =>
			Response.json({
				...issuePayload,
				labels: [
					{ name: "workflow::in-progress", color: "d73a4a" },
					{ name: "plain", color: "not-hex" },
				],
			}),
		);
		expect(await remote.issue(7)).toMatchObject({
			labels: ["workflow::in-progress", "plain"],
			labelColors: [{ name: "workflow::in-progress", color: "#D73A4A" }],
		});
	});

	test("the issue list drops pull requests and maps open state to the GitLab stage words", async () => {
		const { remote } = client(() =>
			Response.json([
				issuePayload,
				{ ...issuePayload, number: 8, state: "closed" },
				{ ...issuePayload, number: 9, pull_request: { url: "https://api.github.com" } },
			]),
		);
		expect(await remote.issues()).toEqual([
			{
				iid: 7,
				title: "Wire the rail",
				description: "Details",
				state: "opened",
				labels: ["workflow::in-progress", "type::bug"],
				updatedAt: "2026-01-01T00:00:00Z",
				closedAt: null,
			},
			{
				iid: 8,
				title: "Wire the rail",
				description: "Details",
				state: "closed",
				labels: ["workflow::in-progress", "type::bug"],
				updatedAt: "2026-01-01T00:00:00Z",
				closedAt: null,
			},
		]);
	});

	test("a pull request is never returned as one issue", async () => {
		const { remote } = client(() =>
			Response.json({ ...issuePayload, pull_request: { url: "https://api.github.com" } }),
		);
		await expect(remote.issue(7)).rejects.toHaveProperty("code", "RANGE_INVALID");
	});

	test("a null body reads as an empty description and plain string labels are accepted", async () => {
		const { remote } = client(() =>
			Response.json({ ...issuePayload, body: null, labels: ["workflow::backlog"] }),
		);
		expect(await remote.issue(7)).toMatchObject({ description: "", labels: ["workflow::backlog"] });
	});

	test("pagination follows the rel=next link and stops at its bound", async () => {
		const pages: string[] = [];
		const { remote } = client((url) => {
			pages.push(url);
			const page = new URL(url).searchParams.get("page") ?? "1";
			return Response.json([{ ...issuePayload, number: Number(page) }], {
				headers: {
					link:
						page === "1" ? '<https://api.github.com/repos/octo/app/issues?page=2>; rel="next"' : "",
				},
			});
		});
		expect((await remote.issues()).map((issue) => issue.iid)).toEqual([1, 2]);
		expect(pages).toHaveLength(2);
	});

	test("a foreign pagination link or an unbounded page count fails sanitized", async () => {
		const foreign = client(() =>
			Response.json([], { headers: { link: '<https://evil.test/x?page=2>; rel="next"' } }),
		);
		await expect(foreign.remote.issues()).rejects.toHaveProperty("code", "RANGE_INVALID");
		const bounded = client(
			(url) => {
				const page = Number(new URL(url).searchParams.get("page") ?? "1");
				return Response.json([], {
					headers: {
						link: `<https://api.github.com/repos/octo/app/issues?page=${page + 1}>; rel="next"`,
					},
				});
			},
			{ maxPages: 2 },
		);
		await expect(bounded.remote.issues()).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
	});

	test("notes read comments and addNote posts exactly one comment", async () => {
		const writes: { url: string; method: string; body: string }[] = [];
		const { remote } = client((url, init) => {
			if (init.method === "POST") {
				writes.push({ url, method: String(init.method), body: String(init.body) });
				return Response.json({ id: 9, body: "handoff", created_at: "2026-01-02T00:00:00Z" });
			}
			return Response.json([{ id: 8, body: "hello", created_at: "2026-01-01T00:00:00Z" }]);
		});
		expect(await remote.notes(7)).toEqual([
			{ id: 8, body: "hello", createdAt: "2026-01-01T00:00:00Z", author: null, system: false },
		]);
		expect(await remote.addNote(7, "handoff")).toEqual({
			id: 9,
			body: "handoff",
			createdAt: "2026-01-02T00:00:00Z",
			author: null,
			system: false,
		});
		expect(writes).toEqual([
			{
				url: "https://api.github.com/repos/octo/app/issues/7/comments",
				method: "POST",
				body: JSON.stringify({ body: "handoff" }),
			},
		]);
	});

	test("Unicode handoff content stays in the JSON body and never becomes a header", async () => {
		const body = "交接摘要：已修复中文评论发布。\n验证通过 ✅";
		const { remote, calls } = client((url, init) => {
			const request = new Request(url, init);
			expect(request.headers.get("Content-Type")).toBe("application/json");
			expect(request.headers.has("body")).toBe(false);
			return Response.json({ id: 9, body, created_at: "2026-01-02T00:00:00Z" });
		});
		expect(await remote.addNote(7, body)).toEqual({
			id: 9,
			body,
			createdAt: "2026-01-02T00:00:00Z",
			author: null,
			system: false,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.init.body).toBe(JSON.stringify({ body }));
	});

	test("credential, permission and missing-repository responses keep distinct readable reasons", async () => {
		for (const [status, reason] of [
			[401, "credential"],
			[403, "rate limited"],
			[404, "not accessible"],
		] as const) {
			const { remote } = client(() => new Response(null, { status }));
			try {
				await remote.issues();
				throw new Error("unexpected success");
			} catch (error) {
				expect(error).toHaveProperty("code", "RESOURCE_UNAVAILABLE");
				expect(String(error)).toContain(reason);
				expect(String(error)).not.toContain(token);
			}
		}
	});

	test("oversized, malformed and token-echoing payloads fail closed", async () => {
		const huge = client(() => Response.json([], { headers: { "content-length": "999999999" } }));
		await expect(huge.remote.issues()).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
		const malformed = client(() => Response.json([{ ...issuePayload, state: "opened" }]));
		await expect(malformed.remote.issues()).rejects.toHaveProperty("code", "RANGE_INVALID");
		const echo = client(() => Response.json([{ ...issuePayload, title: token }]));
		await sanitized(() => echo.remote.issues());
	});

	test("a non-github instance is rejected before any request", () => {
		let calls = 0;
		expect(() =>
			createGitHubClient({
				instanceUrl: "https://gitlab.com",
				project: "octo/app",
				token,
				fetch: async () => {
					calls++;
					return Response.json(repository);
				},
			}),
		).toThrow();
		expect(calls).toBe(0);
	});
});
