import { describe, expect, test } from "bun:test";
import type { IssueReference } from "@thinkrail/contracts";
import {
	approvalPublication,
	createGitLabClient,
	designVersion,
	implementationVersion,
	tomatoLabels,
	validateApproval,
} from "./index";
import { createIssuesService, type IssueStoredBinding } from "./service";

function fakeVault() {
	const values = new Map<string, string>();
	return {
		get: async (id: string) => values.get(id) ?? null,
		set: async (id: string, token: string) => {
			values.set(id, token);
		},
		delete: async (id: string) => {
			values.delete(id);
		},
	};
}
const token = "secret-test-pat";
const event = (id: number, action: "add" | "remove", userId = 7) => ({
	id,
	action,
	userId,
	label: tomatoLabels.design,
	createdAt: `2026-11-04T00:00:0${id}Z`,
});
function evidence() {
	const version = designVersion("design");
	const publication = approvalPublication({
		stage: "design",
		version,
		noteId: 12,
		resetEventId: 1,
	});
	return {
		stage: "design" as const,
		version,
		currentVersion: version,
		publication,
		notes: [{ id: 12, body: publication.body, createdAt: "2026-11-04T00:00:01.500Z" }],
		resetConfirmedAbsent: true,
		events: [event(1, "remove"), event(2, "add")],
		labels: [tomatoLabels.design],
		members: [{ userId: 7, accessLevel: 30 }],
		beforeRevision: "remote-content-identity",
		afterRevision: "remote-content-identity",
	};
}

describe("Tomato approval", () => {
	test("fresh Developer add after reset and exact publication approves", () =>
		expect(validateApproval(evidence())).toEqual({ approved: true, eventId: 2, userId: 7 }));
	test("hashes exact design and binds code to approved design", () => {
		expect(designVersion("design ")).not.toBe(designVersion("design"));
		expect(implementationVersion("a".repeat(40), designVersion("a"))).not.toBe(
			implementationVersion("a".repeat(40), designVersion("b")),
		);
		expect(() => implementationVersion("main", designVersion("a"))).toThrow();
	});
	test("fails closed without fresh version/reset/role/record/order/snapshot", () => {
		const base = evidence();
		for (const patch of [
			{ currentVersion: designVersion("changed") },
			{ resetConfirmedAbsent: false },
			{ members: [] },
			{ members: [{ userId: 7, accessLevel: 20 }] },
			{ notes: [] },
			{ events: [event(1, "remove")] },
			{ events: [event(1, "remove"), event(2, "add"), event(3, "remove")] },
			{ afterRevision: "changed" },
			{
				events: [
					event(1, "remove"),
					{ ...event(2, "add"), createdAt: event(1, "remove").createdAt },
				],
			},
			{ labels: [] },
		])
			expect(validateApproval({ ...base, ...patch }).approved).toBe(false);
	});
	test("publication must precede approval and reset boundary must prove absence", () => {
		const base = evidence();
		for (const patch of [
			{ notes: [{ id: 12, body: base.publication.body, createdAt: "2026-11-04T00:00:03Z" }] },
			{ events: [event(1, "add"), event(2, "add")] },
			{ events: [event(2, "add")] },
			{ events: [event(1, "remove"), event(2, "add"), event(2, "add")] },
		])
			expect(validateApproval({ ...base, ...patch }).approved).toBe(false);
	});

	test("old add cannot approve a new publication", () => {
		const base = evidence();
		const publication = approvalPublication({
			stage: "design",
			version: base.version,
			noteId: 13,
			resetEventId: 2,
		});
		expect(
			validateApproval({
				...base,
				publication,
				notes: [{ id: 13, body: publication.body, createdAt: "2026-11-04T00:00:01.500Z" }],
			}).approved,
		).toBe(false);
	});
});

describe("server-only authenticated remote access", () => {
	const reference: IssueReference = {
		provider: "gitlab",
		instanceUrl: "https://gitlab.example/sub",
		projectId: "73",
		number: 42,
	};
	const input = {
		instanceUrl: "https://GITLAB.example/sub/",
		projectId: "group/repo",
		token,
	};
	async function fixture() {
		let rows: IssueStoredBinding[] = [];
		const requests: string[] = [];
		const options = {
			credentialStore: fakeVault(),
			persistence: {
				load: async () => rows,
				save: async (binding: IssueStoredBinding) => {
					rows = [{ ...binding }];
				},
			},
			fetch: async (url: string | URL | Request, init?: RequestInit) => {
				requests.push(String(url));
				expect(new Headers(init?.headers).get("PRIVATE-TOKEN")).toBe(token);
				if (String(url).includes("/issues/"))
					return Response.json({
						iid: 42,
						title: "Task",
						description: "goal",
						state: "opened",
						labels: ["workflow::backlog"],
						updated_at: "2026-11-04T00:00:00Z",
					});
				return Response.json({ id: 73, path_with_namespace: "group/repo" });
			},
		};
		return { service: await createIssuesService(options), options, requests };
	}

	test("requires a live connection after disconnect and restart; never reconstructs from bindings", async () => {
		const { service, options, requests } = await fixture();
		expect(() => service.remoteFor("local", reference)).toThrow("not connected");
		await service.connect("local", input);
		await service.disconnect("local");
		expect(() => service.remoteFor("local", reference)).toThrow("not connected");
		const restarted = await createIssuesService(options);
		expect(restarted.connection("local")?.connected).toBe(false);
		expect(() => restarted.remoteFor("local", reference)).toThrow("not connected");
		expect(requests).toHaveLength(1);
	});

	test("validates provider, exact canonical instance/project and issue number before access", async () => {
		const { service, requests } = await fixture();
		await service.connect("local", input);
		for (const patch of [
			{ provider: "github" },
			{ instanceUrl: "https://elsewhere.example/sub" },
			{ instanceUrl: `${reference.instanceUrl}/` },
			{ instanceUrl: input.instanceUrl },
			{ projectId: "group/repo" },
			{ projectId: "074" },
			{ projectId: "74" },
			{ number: 0 },
			{ number: 1.5 },
			{ number: Number.MAX_SAFE_INTEGER + 1 },
		]) {
			const invalid = { ...reference, ...patch } as IssueReference;
			expect(() => service.remoteFor("local", invalid)).toThrow("Invalid Issue binding");
		}
		expect(() => service.remoteFor("other-local", reference)).toThrow();
		expect(() => service.remoteFor("local", null as unknown as IssueReference)).toThrow();
		expect(requests).toHaveLength(1);
	});

	test("uses the current canonical authenticated client and keeps token out of outputs", async () => {
		const { service, options, requests } = await fixture();
		const connection = await service.connect("local", input);
		const remote = service.remoteFor("local", reference);
		expect(service.remoteFor("local", reference)).toBe(remote);
		const issue = await remote.issue(reference.number);
		expect(issue.title).toBe("Task");
		expect(requests[1]).toContain("/api/v4/projects/73/issues/42");
		expect(
			JSON.stringify([
				connection,
				service.connection("local"),
				remote,
				issue,
				await options.persistence.load(),
			]),
		).not.toContain(token);
		expect(remote).not.toHaveProperty("token");
		await service.connect("local", {
			...input,
			instanceUrl: "https://other.example",
			projectId: "73",
		});
		expect(() => service.remoteFor("local", reference)).toThrow("Invalid Issue binding");
	});

	test("remote and validation errors never carry credentials or causes", async () => {
		const { service, options } = await fixture();
		options.fetch = async (url) => {
			if (String(url).includes("/issues/")) throw new Error(token);
			return Response.json({ id: 73, path_with_namespace: "group/repo" });
		};
		const failing = await createIssuesService(options);
		await failing.connect("local", input);
		for (const operation of [
			() => service.remoteFor("local", reference),
			() => failing.remoteFor("local", { ...reference, projectId: token }),
			() => failing.remoteFor("local", reference).issue(42),
		]) {
			let caught: unknown;
			try {
				await operation();
			} catch (error) {
				caught = error;
			}
			expect(caught).toHaveProperty("code");
			expect(String(caught)).not.toContain(token);
			expect(JSON.stringify(caught)).not.toContain(token);
			expect(caught).not.toHaveProperty("cause");
		}
	});
});

describe("GitLab reads", () => {
	test("encodes project paths, headers only PAT, complete pagination and effective role", async () => {
		const urls: string[] = [];
		const client = createGitLabClient({
			instanceUrl: "https://gitlab.example/sub/",
			project: "group/repo",
			token,
			fetch: async (url, init) => {
				urls.push(String(url));
				expect(String(url)).not.toContain(token);
				expect(new Headers(init?.headers).get("PRIVATE-TOKEN")).toBe(token);
				expect(init?.redirect).toBe("error");
				if (String(url).includes("members/all/7"))
					return Response.json({ id: 7, access_level: 30 });
				const page = new URL(String(url)).searchParams.get("page");
				return Response.json(
					[
						{
							id: Number(page),
							action: "add",
							user: { id: 7 },
							label: { name: tomatoLabels.design },
							created_at: "2026-11-04T00:00:02Z",
						},
					],
					{ headers: { "x-next-page": page === "1" ? "2" : "" } },
				);
			},
		});
		expect((await client.labelEvents(42)).map((e) => e.id)).toEqual([1, 2]);
		expect(await client.member(7)).toEqual({ userId: 7, accessLevel: 30 });
		expect(urls[0]).toContain("/sub/api/v4/projects/group%2Frepo/issues/42/resource_label_events");
	});
	test("sanitizes transport, HTTP and malformed JSON failures", async () => {
		for (const fetcher of [
			async () => {
				throw new Error(token);
			},
			async () => new Response(token, { status: 401 }),
			async () => new Response(token),
			async () => Response.json({ token }),
		]) {
			const client = createGitLabClient({
				instanceUrl: "https://example.test",
				project: 1,
				token,
				fetch: fetcher,
			});
			try {
				await client.issue(1);
				throw new Error("unexpected success");
			} catch (error) {
				expect(error).toHaveProperty("code");
				expect(String(error)).not.toContain(token);
				expect(error).not.toHaveProperty("cause");
			}
		}
	});
	test("rejects credential URLs and unsafe identifiers before fetch", () => {
		for (const instanceUrl of [
			"https://u:p@example.test",
			"https://example.test?token=x",
			"file:///tmp",
		])
			expect(() => createGitLabClient({ instanceUrl, project: 1, token })).toThrow();
	});
	test("bounds pages, bytes, and stalled fetch even when fetch ignores abort", async () => {
		const options = { instanceUrl: "https://example.test", project: 1, token };
		await expect(
			createGitLabClient({
				...options,
				maxPages: 1,
				fetch: async () => Response.json([], { headers: { "x-next-page": "2" } }),
			}).notes(1),
		).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
		await expect(
			createGitLabClient({
				...options,
				maxBytes: 4,
				fetch: async () => new Response("12345"),
			}).issue(1),
		).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
		await expect(
			createGitLabClient({ ...options, timeoutMs: 10, fetch: () => new Promise(() => {}) }).issue(
				1,
			),
		).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
	});
	test("bounds a stalled response stream and rejects pagination loops", async () => {
		const options = { instanceUrl: "https://example.test", project: 1, token, timeoutMs: 10 };
		await expect(
			createGitLabClient({
				...options,
				fetch: async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(new TextEncoder().encode("{"));
							},
						}),
					),
			}).issue(1),
		).rejects.toHaveProperty("code", "RESOURCE_UNAVAILABLE");
		await expect(
			createGitLabClient({
				...options,
				fetch: async () => Response.json([], { headers: { "x-next-page": "1" } }),
			}).notes(1),
		).rejects.toHaveProperty("code");
	});
	test("disposable HTTP fixture reads issue and notes", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: (request) =>
				Response.json(
					new URL(request.url).pathname.endsWith("notes")
						? [{ id: 3, body: "handoff", created_at: "2026-11-04T00:00:00Z" }]
						: {
								iid: 42,
								title: "Task",
								description: "goal",
								state: "opened",
								labels: ["workflow::backlog"],
								updated_at: "2026-11-04T00:00:00Z",
							},
				),
		});
		try {
			const client = createGitLabClient({ instanceUrl: server.url.toString(), project: 1, token });
			expect((await client.issue(42)).title).toBe("Task");
			expect(await client.notes(42)).toEqual([
				{ id: 3, body: "handoff", createdAt: "2026-11-04T00:00:00Z" },
			]);
		} finally {
			await server.stop(true);
		}
	});
});
