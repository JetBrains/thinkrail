import { describe, expect, test } from "bun:test";
import { createGitLabClient } from "./client";
import { createGitHubClient, type GitHubClientOptions } from "./github";

const token = "delivery_fixture_secret";
const repository = { id: 42, full_name: "octo/app" };
const pull = {
	id: 100,
	number: 9,
	html_url: "https://github.com/octo/app/pull/9",
	state: "open",
	merged_at: null,
	draft: true,
	head: { ref: "issue/7", sha: "a".repeat(40), repo: repository },
	base: { ref: "main", repo: repository },
};
const input = {
	sourceBranch: "issue/7",
	targetBranch: "main",
	title: "Deliver 7",
	description: "Summary",
	draft: true,
};
function fixture(
	respond: (url: string, init: RequestInit) => Response,
	extra: Partial<GitHubClientOptions> = {},
) {
	const calls: { url: string; init: RequestInit }[] = [];
	const remote = createGitHubClient({
		instanceUrl: "https://github.com",
		project: 42,
		token,
		fetch: async (url, init) => {
			calls.push({ url, init });
			return respond(url, init);
		},
		...extra,
	});
	return { remote, calls };
}
async function unavailable(operation: () => Promise<unknown>) {
	try {
		await operation();
		throw new Error("unexpected success");
	} catch (error) {
		expect(error).toHaveProperty("code", "RESOURCE_UNAVAILABLE");
		expect(String(error)).not.toContain(token);
		expect(error).not.toHaveProperty("cause");
	}
}

describe("provider delivery primitives", () => {
	test("GitHub label updates send only labels, permit clearing, and preserve the issue body", async () => {
		const { remote, calls } = fixture(() =>
			Response.json({
				number: 7,
				title: "Issue",
				body: "Keep me",
				state: "open",
				labels: [],
				updated_at: "2026-01-01T00:00:00Z",
			}),
		);
		expect(await remote.updateIssue(7, { labels: [] })).toMatchObject({
			description: "Keep me",
			labels: [],
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.init.method).toBe("PATCH");
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ labels: [] });
	});

	test("GitHub refuses a mismatched update response without retrying", async () => {
		const { remote, calls } = fixture(() =>
			Response.json({
				number: 8,
				title: "Other",
				body: "",
				state: "open",
				labels: [],
				updated_at: "2026-01-01T00:00:00Z",
			}),
		);
		await unavailable(() => remote.updateIssue(7, { labels: ["stage"] }));
		expect(calls).toHaveLength(1);
	});

	test("GitHub verifies numeric repository ownership and lists exact-head PRs in all states across pages", async () => {
		const { remote, calls } = fixture((url) => {
			if (url.endsWith("/repositories/42")) return Response.json(repository);
			const page = new URL(url).searchParams.get("page");
			return Response.json(
				[
					{
						...pull,
						...(page === "2"
							? {
									number: 10,
									html_url: "https://github.com/octo/app/pull/10",
									state: "closed",
									merged_at: "2026-01-01T00:00:00Z",
								}
							: {}),
					},
				],
				{
					headers:
						page === "2"
							? {}
							: {
									link: '<https://api.github.com/repositories/42/pulls?state=all&head=octo%3Aissue%2F7&per_page=100&page=2>; rel="next"',
								},
				},
			);
		});
		const results = await remote.mergeRequests("issue/7");
		expect(results.map((item) => item.state)).toEqual(["opened", "merged"]);
		expect(results[0]).toMatchObject({
			iid: 9,
			sourceProjectId: 42,
			targetProjectId: 42,
			draft: true,
			sha: "a".repeat(40),
			headPipeline: null,
		});
		const query = new URL(calls[1]?.url ?? "").searchParams;
		expect(query.get("state")).toBe("all");
		expect(query.get("head")).toBe("octo:issue/7");
	});

	test("GitHub merge returns exact merge SHA and target ancestry evidence", async () => {
		const mergedSha = "c".repeat(40);
		let merged = false;
		const { remote, calls } = fixture((url) => {
			const parsed = new URL(url);
			if (parsed.pathname === "/repositories/42") return Response.json(repository);
			if (parsed.pathname === "/repositories/42/pulls/9")
				return Response.json({
					...pull,
					state: merged ? "closed" : "open",
					merged_at: merged ? "2026-01-01T00:00:00Z" : null,
					merged,
					merge_commit_sha: mergedSha,
				});
			if (parsed.pathname.endsWith("/merge")) {
				merged = true;
				return Response.json({ merged: true, message: "Merged" });
			}
			if (parsed.pathname.endsWith("/branches/main"))
				return Response.json({
					name: "main",
					_links: { self: "https://api.github.com/repositories/42/branches/main" },
					commit: { sha: "d".repeat(40) },
				});
			if (parsed.pathname.endsWith(`/compare/${mergedSha}...${"d".repeat(40)}`))
				return Response.json({
					status: "ahead",
					base_commit: { sha: mergedSha },
					merge_base_commit: { sha: mergedSha },
					commits: [{ sha: mergedSha }],
				});
			throw new Error(`Unexpected ${url}`);
		});
		const result = await remote.mergeMergeRequest(9, "a".repeat(40));
		expect(result.mergeCommitSha).toBe(mergedSha);
		if (!remote.mergeEvidence) throw new Error("Missing merge evidence capability");
		await expect(remote.mergeEvidence(9)).resolves.toMatchObject({
			mergeCommitSha: mergedSha,
			targetSha: "d".repeat(40),
			relationship: "ancestor",
		});
		expect(calls.some((call) => call.url.includes("/compare/"))).toBe(true);
	});

	test("GitHub draft creation uses the native flag and validates the returned PR", async () => {
		const { remote, calls } = fixture((url) =>
			Response.json(url.endsWith("/repositories/42") ? repository : pull),
		);
		expect(await remote.createMergeRequest(input)).toMatchObject({ iid: 9, draft: true });
		const write = calls.find((call) => call.init.method === "POST");
		if (!write) throw new Error("Missing PR creation request");
		expect(JSON.parse(String(write.init.body))).toEqual({
			head: "issue/7",
			base: "main",
			title: "Deliver 7",
			body: "Summary",
			draft: true,
		});
		expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
	});

	test("GitHub rejects wrong branch/repository, unsafe URLs and malformed draft responses", async () => {
		for (const bad of [
			{ ...pull, head: { ...pull.head, ref: "other" } },
			{ ...pull, head: { ...pull.head, repo: { id: 43, full_name: "fork/app" } } },
			{ ...pull, base: { ...pull.base, repo: { id: 43, full_name: "octo/other" } } },
			{ ...pull, html_url: "https://evil.test/octo/app/pull/9" },
			{ ...pull, html_url: "https://github.com/octo/app/pull/10" },
			{ ...pull, html_url: "https://user:pass@github.com/octo/app/pull/9" },
			{ ...pull, draft: "yes" },
			{ ...pull, draft: false },
		]) {
			const { remote } = fixture((url) =>
				Response.json(url.endsWith("/repositories/42") ? repository : bad),
			);
			await unavailable(() => remote.createMergeRequest(input));
		}
	});

	test("GitHub list refuses changed pagination filters and bounded truncation", async () => {
		for (const next of [
			"https://evil.test/pulls?page=2",
			"https://api.github.com/repositories/43/pulls?state=all&head=octo%3Aissue%2F7&page=2",
			"https://api.github.com/repositories/42/pulls?state=open&head=octo%3Aissue%2F7&page=2",
		]) {
			const { remote } = fixture((url) =>
				Response.json(url.endsWith("/repositories/42") ? repository : [pull], {
					headers: { link: `<${next}>; rel="next"` },
				}),
			);
			await unavailable(() => remote.mergeRequests("issue/7"));
		}
		const { remote } = fixture(
			(url) =>
				Response.json(url.endsWith("/repositories/42") ? repository : [pull], {
					headers: {
						link: '<https://api.github.com/repositories/42/pulls?state=all&head=octo%3Aissue%2F7&per_page=100&page=2>; rel="next"',
					},
				}),
			{ maxPages: 1 },
		);
		await unavailable(() => remote.mergeRequests("issue/7"));
	});

	test("GitHub delivery rejects unsafe input before mutation and never retries uncertain writes", async () => {
		for (const sourceBranch of ["../other", "bad\\\\branch", "bad[branch", token]) {
			const { remote, calls } = fixture(() => Response.json(repository));
			await expect(remote.createMergeRequest({ ...input, sourceBranch })).rejects.toBeDefined();
			expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(0);
		}
		for (const response of [
			() => new Response(null, { status: 502 }),
			() => Response.json({ ...pull, title: token }),
		]) {
			const { remote, calls } = fixture((url) =>
				url.endsWith("/repositories/42") ? Response.json(repository) : response(),
			);
			await unavailable(() => remote.createMergeRequest(input));
			expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
		}
	});

	test("GitLab merge verifies merge SHA ancestry against the bound target branch", async () => {
		const mergedSha = "c".repeat(40);
		const remote = createGitLabClient({
			instanceUrl: "https://gitlab.test",
			project: 42,
			token,
			fetch: async (url) => {
				const path = new URL(url).pathname;
				if (path.endsWith("/merge_requests/9/merge") || path.endsWith("/merge_requests/9"))
					return Response.json({
						id: 100,
						iid: 9,
						web_url: "https://gitlab.test/octo/app/-/merge_requests/9",
						state: "merged",
						source_branch: "issue/7",
						target_branch: "main",
						sha: "a".repeat(40),
						merge_commit_sha: mergedSha,
						merge_status: "can_be_merged",
					});
				if (path.endsWith("/repository/branches/main"))
					return Response.json({ name: "main", commit: { id: "d".repeat(40) } });
				if (path.endsWith("/repository/merge_base")) return Response.json({ id: mergedSha });
				throw new Error(`Unexpected ${url}`);
			},
		});
		await remote.mergeMergeRequest(9, "a".repeat(40));
		if (!remote.mergeEvidence) throw new Error("Missing merge evidence capability");
		await expect(remote.mergeEvidence(9)).resolves.toMatchObject({
			mergeCommitSha: mergedSha,
			targetSha: "d".repeat(40),
			relationship: "ancestor",
		});
	});

	test("GitLab draft creation uses the portable Draft title prefix", async () => {
		let written: Record<string, unknown> | undefined;
		const remote = createGitLabClient({
			instanceUrl: "https://gitlab.test",
			project: 42,
			token,
			fetch: async (_url, init) => {
				written = JSON.parse(String(init.body));
				return Response.json({
					id: 100,
					iid: 9,
					web_url: "https://gitlab.test/octo/app/-/merge_requests/9",
					state: "opened",
					source_branch: "issue/7",
					target_branch: "main",
					sha: null,
					merge_status: "checking",
					draft: true,
				});
			},
		});
		await remote.createMergeRequest(input);
		expect(written?.title).toBe("Draft: Deliver 7");
		await remote.createMergeRequest({ ...input, title: "Draft: Deliver 7" });
		expect(written?.title).toBe("Draft: Deliver 7");
	});
});
