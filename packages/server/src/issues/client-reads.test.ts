import { describe, expect, test } from "bun:test";
import { createGitLabClient, type GitLabClient, type GitLabClientOptions } from "./client";

const token = "delivery-fixture-secret";
const project = { id: 42, path_with_namespace: "group/repo" };
const options = { instanceUrl: "https://gitlab.example/sub/", project: 42, token };
function client(value: unknown, extra: Partial<GitLabClientOptions> = {}): GitLabClient {
	return createGitLabClient({ ...options, fetch: async () => Response.json(value), ...extra });
}
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

describe("GitLab delivery read primitives", () => {
	test("project fields stay unknown when omitted or null; no guessed default branch", async () => {
		for (const optional of [
			{},
			{ default_branch: null, http_url_to_repo: null, ssh_url_to_repo: null },
		]) {
			expect(await client({ ...project, ...optional }).project()).toEqual({
				id: 42,
				pathWithNamespace: "group/repo",
				defaultBranch: null,
				httpUrlToRepo: null,
				sshUrlToRepo: null,
			});
		}
	});
	test("project returns validated clone facts and checks numeric selection", async () => {
		for (const ssh of [
			"git@gitlab.example:group/repo.git",
			"ssh://git@gitlab.example:2222/group/repo.git",
		]) {
			expect(
				await client({
					...project,
					default_branch: "trunk",
					http_url_to_repo: "https://gitlab.example/group/repo.git",
					ssh_url_to_repo: ssh,
				}).project(),
			).toEqual({
				id: 42,
				pathWithNamespace: "group/repo",
				defaultBranch: "trunk",
				httpUrlToRepo: "https://gitlab.example/group/repo.git",
				sshUrlToRepo: ssh,
			});
		}
		// A self-hosted instance may be HTTP-only: its own clone/web URLs keep that scheme.
		const insecure = await client({
			...project,
			http_url_to_repo: "http://gitlab.internal:8080/group/repo.git",
		}).project();
		expect(insecure.httpUrlToRepo).toBe("http://gitlab.internal:8080/group/repo.git");
		await sanitized(() => client({ ...project, id: 43 }).project());
		await sanitized(() => client({ ...project, id: 43 }, { project: "42" }).project());
		expect((await client(project, { project: "group/repo" }).project()).id).toBe(42);
	});
	test("malformed present project fields fail sanitized", async () => {
		for (const fields of [
			{ id: "42" },
			{ id: 0 },
			{ id: 1.5 },
			...[false, 12, "", " trunk", "bad\nbranch"].map((default_branch) => ({ default_branch })),
			...[
				"https://user:pass@gitlab.example/repo.git",
				"https://gitlab.example/repo.git?token=x",
				"https://gitlab.example/repo.git#x",
				"https://GITLAB.example/repo.git",
				12,
			].map((http_url_to_repo) => ({ http_url_to_repo })),
			...[
				"ssh://git:pass@gitlab.example/repo.git",
				"git@gitlab.example:repo.git?x",
				"git@gitlab.example:repo.git#x",
				"git:pass@gitlab.example:repo.git",
				"ssh://git@gitlab.example/repo.git?x",
				"bad",
				false,
			].map((ssh_url_to_repo) => ({ ssh_url_to_repo })),
		])
			await sanitized(() => client({ ...project, ...fields }).project());
	});
	test("current user uses the instance API, authenticated header and no body", async () => {
		let calls = 0;
		const api = client(null, {
			fetch: async (url, init) => {
				calls++;
				expect(url).toBe("https://gitlab.example/sub/api/v4/user");
				expect(url).not.toContain(token);
				expect(new Headers(init.headers).get("PRIVATE-TOKEN")).toBe(token);
				expect(init.redirect).toBe("error");
				expect(init.body).toBeUndefined();
				return Response.json({ id: 7, username: "person" });
			},
		});
		expect(await api.currentUser()).toEqual({ id: 7 });
		expect(calls).toBe(1);
		expect(api).not.toHaveProperty("token");
	});
	test("current user and project failures are bounded, sanitized and never retried", async () => {
		for (const respond of [
			async () => Response.json({ id: 0 }),
			async () => Response.json({ id: "7" }),
			async () => Response.json({}),
			async () => Response.json({ id: 7, echo: token }),
			async () => {
				throw new Error(token);
			},
			async () => new Response(token, { status: 401 }),
			async () => new Response("not JSON"),
			async () =>
				new Response(null, { status: 302, headers: { location: "https://other.example" } }),
			async () => new Response("x".repeat(1000)),
			() => new Promise<Response>(() => {}),
			async () =>
				new Response(
					new ReadableStream({
						start(c) {
							c.enqueue(new TextEncoder().encode("{"));
						},
					}),
				),
		]) {
			let calls = 0;
			const api = client(null, {
				timeoutMs: 10,
				maxBytes: 500,
				fetch: async () => {
					calls++;
					return respond();
				},
			});
			await sanitized(() => api.currentUser());
			await sanitized(() => api.project());
			expect(calls).toBe(2);
		}
	});
});
