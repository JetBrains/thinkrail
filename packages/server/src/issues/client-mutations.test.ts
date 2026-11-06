import { describe, expect, test } from "bun:test";
import { createGitLabClient, type GitLabClientOptions } from "./client";

const token = "mutation-fixture-secret";
const sha = "a".repeat(40);
const options = { instanceUrl: "https://gitlab.example/sub", project: "group/repo", token };
const issue = {
	iid: 7,
	title: "Task",
	description: "fresh design",
	state: "opened",
	labels: ["workflow::design"],
	updated_at: "2026-11-04T00:00:00Z",
};
const mr = {
	id: 90,
	iid: 8,
	web_url: "https://gitlab.example/group/repo/-/merge_requests/8",
	state: "opened",
	source_branch: "work/topic",
	target_branch: "main",
	sha,
	merge_status: "can_be_merged",
	head_pipeline: { status: "success" },
};
function client(
	fetch: NonNullable<GitLabClientOptions["fetch"]>,
	extra: Partial<GitLabClientOptions> = {},
) {
	return createGitLabClient({ ...options, ...extra, fetch });
}

describe("GitLab provider mutations and MR reads", () => {
	test("writes explicit methods, JSON bodies and header-only credentials; returns fresh metadata", async () => {
		const calls: { path: string; method: string | undefined; body: unknown }[] = [];
		const api = client(async (url, init) => {
			expect(url).not.toContain(token);
			expect(new Headers(init.headers).get("PRIVATE-TOKEN")).toBe(token);
			expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
			expect(init.redirect).toBe("error");
			calls.push({
				path: new URL(url).pathname,
				method: init.method,
				body: JSON.parse(String(init.body)),
			});
			if (url.endsWith("/notes"))
				return Response.json({ id: 12, body: "handoff", created_at: issue.updated_at });
			if (url.endsWith("/merge")) return Response.json({ ...mr, state: "merged" });
			if (String(init.body).includes("state_event"))
				return Response.json({ ...issue, state: "closed" });
			return Response.json(url.includes("merge_requests") ? mr : issue);
		});
		expect(
			(await api.updateIssue(7, { description: "design", labels: ["workflow::design", "other"] }))
				.description,
		).toBe("fresh design");
		expect((await api.addNote(7, "handoff")).id).toBe(12);
		expect(
			(
				await api.createMergeRequest({
					sourceBranch: "work/topic",
					targetBranch: "main",
					title: "Task",
					description: "Closes #7",
				})
			).iid,
		).toBe(8);
		expect(await api.mergeMergeRequest(8, sha)).toMatchObject({
			state: "merged",
			sha,
			headPipeline: { status: "success" },
		});
		expect((await api.closeIssue(7)).state).toBe("closed");
		expect(calls).toEqual([
			{
				path: "/sub/api/v4/projects/group%2Frepo/issues/7",
				method: "PUT",
				body: { description: "design", labels: "workflow::design,other" },
			},
			{
				path: "/sub/api/v4/projects/group%2Frepo/issues/7/notes",
				method: "POST",
				body: { body: "handoff" },
			},
			{
				path: "/sub/api/v4/projects/group%2Frepo/merge_requests",
				method: "POST",
				body: {
					source_branch: "work/topic",
					target_branch: "main",
					title: "Task",
					description: "Closes #7",
				},
			},
			{
				path: "/sub/api/v4/projects/group%2Frepo/merge_requests/8/merge",
				method: "PUT",
				body: { sha },
			},
			{
				path: "/sub/api/v4/projects/group%2Frepo/issues/7",
				method: "PUT",
				body: { state_event: "close" },
			},
		]);
	});

	test("partial issue updates preserve omitted fields and permit clearing labels", async () => {
		const bodies: unknown[] = [];
		const api = client(async (_url, init) => {
			bodies.push(JSON.parse(String(init.body)));
			return Response.json(issue);
		});
		await api.updateIssue(7, { description: "" });
		await api.updateIssue(7, { labels: [] });
		expect(bodies).toEqual([{ description: "" }, { labels: "" }]);
		await expect(api.updateIssue(7, {})).rejects.toHaveProperty("code", "RANGE_INVALID");
		expect(bodies).toHaveLength(2);
	});

	test("reads paginated source-branch MRs and fresh MR detail with nullable pipeline", async () => {
		const urls: URL[] = [];
		const api = client(async (url, init) => {
			const parsed = new URL(url);
			urls.push(parsed);
			expect(init.body).toBeUndefined();
			if (parsed.pathname.endsWith("/8"))
				return Response.json({ ...mr, head_pipeline: null, sha: null });
			expect(parsed.searchParams.get("source_branch")).toBe("work/topic & more");
			expect(parsed.searchParams.get("per_page")).toBe("100");
			return Response.json(
				[{ ...mr, source_branch: "work/topic & more", head_pipeline: undefined }],
				{ headers: { "x-next-page": parsed.searchParams.get("page") === "1" ? "2" : "" } },
			);
		});
		expect(await api.mergeRequests("work/topic & more")).toEqual(
			[0, 1].map(() => ({
				id: 90,
				iid: 8,
				webUrl: mr.web_url,
				state: "opened",
				sourceBranch: "work/topic & more",
				targetBranch: "main",
				sha,
				mergeStatus: "can_be_merged",
				sourceProjectId: null,
				targetProjectId: null,
				draft: null,
				detailedMergeStatus: null,
				mergeCommitSha: null,
				squashCommitSha: null,
				headPipeline: null,
			})),
		);
		expect(await api.mergeRequest(8)).toMatchObject({ sha: null, headPipeline: null });
		expect(urls).toHaveLength(3);
	});

	test("MR delivery facts are nullable unknowns, or validated full identities", async () => {
		const unknown = {
			sourceProjectId: null,
			targetProjectId: null,
			draft: null,
			detailedMergeStatus: null,
			mergeCommitSha: null,
			squashCommitSha: null,
			headPipeline: { id: null, sha: null, status: "success" },
		};
		expect(await client(async () => Response.json(mr)).mergeRequest(8)).toMatchObject(unknown);
		const fields = {
			source_project_id: 41,
			target_project_id: 42,
			draft: false,
			detailed_merge_status: "mergeable",
			merge_commit_sha: sha,
			squash_commit_sha: sha,
			head_pipeline: { id: 123, sha, status: "success" },
		};
		expect(
			await client(async () => Response.json({ ...mr, ...fields })).mergeRequest(8),
		).toMatchObject({
			sourceProjectId: 41,
			targetProjectId: 42,
			draft: false,
			detailedMergeStatus: "mergeable",
			mergeCommitSha: sha,
			squashCommitSha: sha,
			headPipeline: { id: 123, sha, status: "success" },
		});
		const nullFields = Object.fromEntries(Object.keys(fields).map((key) => [key, null]));
		expect(
			await client(async () => Response.json({ ...mr, ...nullFields })).mergeRequest(8),
		).toMatchObject({ ...unknown, headPipeline: null });
	});

	test("malformed present MR facts fail sanitized across reads and writes without retry", async () => {
		for (const fields of [
			{ source_project_id: "41" },
			{ target_project_id: 0 },
			{ source_project_id: 1.5 },
			{ draft: "false" },
			{ draft: 0 },
			{ detailed_merge_status: "" },
			{ detailed_merge_status: false },
			{ merge_commit_sha: "main" },
			{ squash_commit_sha: "123" },
			{ head_pipeline: { id: 0, sha, status: "success" } },
			{ head_pipeline: { id: 1, sha: "bad", status: "success" } },
			{ head_pipeline: {} },
		]) {
			let calls = 0;
			const api = client(async (url) => {
				calls++;
				const value = { ...mr, ...fields };
				return Response.json(url.includes("source_branch=") ? [value] : value);
			});
			for (const operation of [
				() => api.mergeRequest(8),
				() => api.mergeRequests("work/topic"),
				() => api.mergeMergeRequest(8, sha),
			]) {
				try {
					await operation();
					throw new Error("unexpected success");
				} catch (error) {
					expect(error).toHaveProperty("code", "RESOURCE_UNAVAILABLE");
					expect(String(error)).not.toContain(token);
					expect(error).not.toHaveProperty("cause");
				}
			}
			expect(calls).toBe(3);
		}
	});

	test("uncertain writes fail sanitized without retry, including malformed success", async () => {
		for (const respond of [
			async () => {
				throw new Error(token);
			},
			async () => new Response(token, { status: 500 }),
			async () => new Response("not JSON"),
			async () => Response.json({}),
			async () => Response.json({ ...issue, iid: 999 }),
			async () => Response.json({ ...issue, description: token }),
			async () => new Response(null, { status: 204 }),
			() => new Promise<Response>(() => {}),
		]) {
			let calls = 0;
			const api = client(
				async () => {
					calls++;
					return respond();
				},
				{ timeoutMs: 10 },
			);
			for (const write of [
				() => api.updateIssue(7, { description: "x" }),
				() => api.addNote(7, "x"),
				() =>
					api.createMergeRequest({
						sourceBranch: "work",
						targetBranch: "main",
						title: "x",
						description: "",
					}),
				() => api.mergeMergeRequest(8, sha),
				() => api.closeIssue(7),
			]) {
				const before = calls;
				try {
					await write();
					throw new Error("unexpected success");
				} catch (error) {
					expect(error).toHaveProperty("code", "RESOURCE_UNAVAILABLE");
					expect(String(error)).not.toContain(token);
					expect(error).not.toHaveProperty("cause");
				}
				expect(calls - before).toBe(1);
			}
		}
	});

	test("rejects unsafe identifiers before fetch and unsafe MR links in responses", async () => {
		let calls = 0;
		const api = client(async () => {
			calls++;
			return Response.json(mr);
		});
		for (const write of [
			() => api.closeIssue(0),
			() => api.mergeRequest(-1),
			() => api.mergeMergeRequest(8, "main"),
			() => api.mergeRequests("bad\nbranch"),
			() => api.mergeRequests(`work/${token}`),
			() => api.addNote(7, token),
			() => api.updateIssue(7, { labels: ["one,two"] }),
		]) {
			await expect(write()).rejects.toHaveProperty("code", "RANGE_INVALID");
		}
		expect(calls).toBe(0);
		for (const web_url of [
			"https://u:p@example.test/mr/8",
			"javascript:alert(1)",
			"ftp://example.test/mr/8",
		]) {
			await expect(
				client(async () => Response.json({ ...mr, web_url })).mergeRequest(8),
			).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
		}
	});

	test("bounds writes and MR lists by bytes, pages, items and streamed deadline", async () => {
		await expect(
			client(async () => Response.json(issue), { maxBytes: 4 }).closeIssue(7),
		).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
		for (const extra of [{ maxPages: 1 }, { maxItems: 1 }]) {
			await expect(
				client(
					async () => Response.json([mr], { headers: { "x-next-page": "2" } }),
					extra,
				).mergeRequests("work/topic"),
			).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
		}
		await expect(
			client(
				async () =>
					new Response(
						new ReadableStream({
							start(c) {
								c.enqueue(new TextEncoder().encode("{"));
							},
						}),
					),
				{ timeoutMs: 10 },
			).closeIssue(7),
		).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
	});
});
