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

describe("GitHub Issue reads", () => {
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
			},
			{
				iid: 8,
				title: "Wire the rail",
				description: "Details",
				state: "closed",
				labels: ["workflow::in-progress", "type::bug"],
				updatedAt: "2026-01-01T00:00:00Z",
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
			{ id: 8, body: "hello", createdAt: "2026-01-01T00:00:00Z" },
		]);
		expect(await remote.addNote(7, "handoff")).toEqual({
			id: 9,
			body: "handoff",
			createdAt: "2026-01-02T00:00:00Z",
		});
		expect(writes).toEqual([
			{
				url: "https://api.github.com/repos/octo/app/issues/7/comments",
				method: "POST",
				body: JSON.stringify({ body: "handoff" }),
			},
		]);
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
