import { describe, expect, test } from "bun:test";
import { createIssuesService, type IssueStoredBinding } from "./index";

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
const token = "private-pat-secret";
const input = { instanceUrl: "https://gitlab.example", projectId: "team/repo", token };
const issue = {
	iid: 42,
	title: "Work",
	description: "",
	state: "opened",
	labels: ["workflow::backlog", "type::bug"],
	updated_at: "2026-01-01T00:00:00Z",
};
function fixture() {
	let stored: IssueStoredBinding[] = [];
	let rows = [issue];
	let fail = false;
	let persistFail = false;
	const requests: string[] = [];
	const credentialStore = fakeVault();
	const persistence = {
		load: async () => structuredClone(stored),
		save: async (binding: IssueStoredBinding) => {
			if (persistFail) throw new Error(token);
			stored = [
				...stored.filter((row) => row.projectId !== binding.projectId),
				structuredClone(binding),
			];
		},
	};
	const fetcher = async (url: string, init: RequestInit) => {
		requests.push(url);
		expect(new Headers(init.headers).get("PRIVATE-TOKEN")).toBe(token);
		expect(init.redirect).toBe("error");
		if (fail) throw new Error(token);
		return Response.json(
			url.includes("/issues?") ? rows : { id: 7, path_with_namespace: "team/repo" },
		);
	};
	return {
		persistence,
		credentialStore,
		fetcher,
		requests,
		stored: () => stored,
		rows: (value: typeof rows) => {
			rows = value;
		},
		fail: () => {
			fail = true;
		},
		persistFail: () => {
			persistFail = true;
		},
	};
}
describe("issues service", () => {
	test("verifies then persists public binding, reads summaries, disconnects and restarts without credentials", async () => {
		const f = fixture();
		const service = await createIssuesService({
			credentialStore: f.credentialStore,
			persistence: f.persistence,
			fetch: f.fetcher,
		});
		expect(await service.connection("local")).toBeNull();
		expect(await service.connect("local", input)).toEqual({
			projectId: "local",
			instanceUrl: input.instanceUrl,
			remoteProjectId: "7",
			connected: true,
		});
		expect(f.requests).toHaveLength(1);
		expect(JSON.stringify(f.stored())).not.toContain(token);
		const result = await service.list("local");
		expect(result.issues[0]).toEqual({
			reference: { provider: "gitlab", instanceUrl: input.instanceUrl, projectId: "7", number: 42 },
			title: "Work",
			url: "https://gitlab.example/team/repo/-/issues/42",
			labels: issue.labels,
			stage: "backlog",
			updatedAt: issue.updated_at,
		});
		expect(Number.isFinite(Date.parse(result.fetchedAt))).toBe(true);
		const restarted = await createIssuesService({
			credentialStore: f.credentialStore,
			persistence: f.persistence,
			fetch: f.fetcher,
		});
		expect((await restarted.connection("local"))?.connected).toBe(false);
		await expect(restarted.list("local")).rejects.toThrow("not connected");
		await service.disconnect("local");
		expect((await service.connection("local"))?.connected).toBe(false);
		await expect(service.list("local")).rejects.toThrow("not connected");
		expect(JSON.stringify(result)).not.toContain(token);
	});
	test("rejects invalid HTTPS connection input without fetch or persistence", async () => {
		const f = fixture();
		const service = await createIssuesService({
			credentialStore: f.credentialStore,
			persistence: f.persistence,
			fetch: f.fetcher,
		});
		for (const instanceUrl of [
			"http://remote.example",
			"https://user:pass@gitlab.example",
			"https://gitlab.example/?key=secret",
			"https://gitlab.example/#secret",
		]) {
			await expect(service.connect("local", { ...input, instanceUrl })).rejects.toThrow();
		}
		await expect(service.connect("", input)).rejects.toThrow();
		expect(f.requests).toHaveLength(0);
		expect(f.stored()).toEqual([]);
	});
	test("failed verification and persistence do not install credentials or leak errors", async () => {
		for (const failure of ["fail", "persistFail"] as const) {
			const f = fixture();
			const service = await createIssuesService({
				credentialStore: f.credentialStore,
				persistence: f.persistence,
				fetch: f.fetcher,
			});
			f[failure]();
			try {
				await service.connect("local", input);
				throw new Error("unexpected success");
			} catch (error) {
				expect(String(error)).not.toContain(token);
				expect((error as Error).cause).toBeUndefined();
			}
			expect(await service.connection("local")).toBeNull();
			expect(f.stored()).toEqual([]);
		}
	});
	test("known stages map; unknown or conflicting labels still list as backlog", async () => {
		const f = fixture();
		const service = await createIssuesService({
			credentialStore: f.credentialStore,
			persistence: f.persistence,
			fetch: f.fetcher,
		});
		await service.connect("local", input);
		for (const stage of ["backlog", "in-progress", "in-review"] as const) {
			f.rows([{ ...issue, labels: [`workflow::${stage}`] }]);
			expect((await service.list("local")).issues[0]?.stage).toBe(stage);
		}
		f.rows([{ ...issue, labels: [] }]);
		expect((await service.list("local")).issues[0]?.stage).toBe("backlog");
		for (const labels of [
			["workflow::future"],
			["workflow::backlog", "workflow::in-review"],
			["workflow::backlog", "workflow::future"],
		]) {
			f.rows([{ ...issue, labels }]);
			const listed = (await service.list("local")).issues[0];
			expect(listed?.stage).toBe("backlog");
			expect(listed?.labels).toEqual(labels);
		}
		f.rows([{ ...issue, state: "closed" }]);
		expect((await service.list("local")).issues[0]?.stage).toBe("closed");
	});
	test("failed reconnect preserves verified binding; remote token echoes never reach reads", async () => {
		const f = fixture();
		const service = await createIssuesService({
			credentialStore: f.credentialStore,
			persistence: f.persistence,
			fetch: f.fetcher,
		});
		await service.connect("local", input);
		f.rows([{ ...issue, title: token }]);
		await expect(service.list("local")).rejects.toThrow("unavailable");
		f.fail();
		await expect(
			service.connect("local", { ...input, projectId: "other/project" }),
		).rejects.toThrow("unavailable");
		expect(service.connection("local")).toEqual({
			projectId: "local",
			instanceUrl: input.instanceUrl,
			remoteProjectId: "7",
			connected: true,
		});
		expect(f.stored()).toHaveLength(1);
	});
	test("load failures are sanitized and extra persisted fields are never returned", async () => {
		await expect(
			createIssuesService({
				credentialStore: fakeVault(),
				persistence: {
					load: async () => {
						throw new Error(token);
					},
					save: async () => {},
				},
			}),
		).rejects.toThrow("could not be loaded");
		const service = await createIssuesService({
			credentialStore: fakeVault(),
			persistence: {
				load: async () => [
					{ projectId: "local", instanceUrl: input.instanceUrl, remoteProjectId: "7", token },
				],
				save: async () => {},
			},
		});
		expect(JSON.stringify(service.connection("local"))).not.toContain(token);
	});
	test("disconnect during verification cannot resurrect a token", async () => {
		const f = fixture();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const service = await createIssuesService({
			credentialStore: f.credentialStore,
			persistence: f.persistence,
			fetch: async (url, init) => {
				await gate;
				return f.fetcher(url, init);
			},
		});
		const pending = service.connect("local", input);
		const disconnect = service.disconnect("local");
		release();
		await disconnect;
		await expect(pending).rejects.toThrow();
		expect((await service.connection("local"))?.connected ?? false).toBe(false);
	});
});

function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) throw new Error("Missing fixture value");
	return value;
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("vault lifecycle", () => {
	test("restart does no vault/network work; restore coalesces and projects only public fields", async () => {
		const f = fixture();
		const first = await createIssuesService({ ...f, fetch: f.fetcher });
		await first.connect("local", input);
		const gate = deferred();
		let gets = 0;
		const restarted = await createIssuesService({
			...f,
			fetch: f.fetcher,
			credentialStore: {
				...f.credentialStore,
				get: async (id) => {
					gets++;
					await gate.promise;
					return f.credentialStore.get(id);
				},
			},
		});
		expect(gets).toBe(0);
		expect(f.requests).toHaveLength(1);
		const a = restarted.restore("local");
		const b = restarted.restore("local");
		expect(a).toBe(b);
		gate.resolve();
		expect((await a)?.connected).toBe(true);
		expect(gets).toBe(1);
		expect(f.requests).toHaveLength(2);
		expect(Object.keys(required(restarted.connection("local"))).sort()).toEqual([
			"connected",
			"instanceUrl",
			"projectId",
			"remoteProjectId",
		]);
	});
	test("remote HTTP requires exact consent before PAT dispatch, including restored records", async () => {
		const f = fixture();
		const service = await createIssuesService({ ...f, fetch: f.fetcher });
		const http = { ...input, instanceUrl: "http://gitlab.example/sub" };
		await expect(service.connect("local", http)).rejects.toThrow();
		expect(f.requests).toHaveLength(0);
		await service.connect("local", { ...http, httpConsent: { instanceUrl: http.instanceUrl } });
		const saved = { ...required(f.stored()[0]) };
		delete saved.httpConsentInstanceUrl;
		const restarted = await createIssuesService({
			credentialStore: f.credentialStore,
			fetch: f.fetcher,
			persistence: {
				load: async () => [saved],
				save: f.persistence.save,
			},
		});
		await expect(restarted.restore("local")).rejects.toThrow();
		expect(f.requests).toHaveLength(1);
	});
	test("uncertain vault set retains old active credential and deletion marker until confirmed cleanup", async () => {
		const f = fixture();
		let failSet = false;
		let failDelete = false;
		const vault = {
			...f.credentialStore,
			set: async (id: string, value: string) => {
				await f.credentialStore.set(id, value);
				if (failSet) throw new Error(token);
			},
			delete: async (id: string) => {
				if (failDelete) throw new Error(token);
				await f.credentialStore.delete(id);
			},
		};
		const service = await createIssuesService({ ...f, credentialStore: vault, fetch: f.fetcher });
		await service.connect("local", input);
		const active = required(required(f.stored()[0]).credentialId);
		failSet = failDelete = true;
		await expect(service.connect("local", input)).rejects.toThrow("could not be saved");
		expect(service.connection("local")?.connected).toBe(true);
		expect(required(f.stored()[0]).credentialId).toBe(active);
		expect(required(f.stored()[0]).cleanupCredentialIds).toHaveLength(1);
		expect(await vault.get(active)).toBe(token);
		await expect(service.disconnect("local")).rejects.toThrow("cleanup failed");
		expect(service.connection("local")?.connected).toBe(false);
		await expect(service.restore("local")).rejects.toThrow("blocked");
		failDelete = false;
		await service.disconnect("local");
		expect(required(f.stored()[0]).credentialId).toBeUndefined();
		expect(required(f.stored()[0]).cleanupCredentialIds).toEqual([]);
		expect(await vault.get(active)).toBeNull();
	});
	test("failed replacement commit preserves old client and active vault key", async () => {
		const f = fixture();
		let saves = 0;
		let failure = 0;
		const service = await createIssuesService({
			...f,
			fetch: f.fetcher,
			persistence: {
				load: f.persistence.load,
				save: async (row) => {
					saves++;
					if (saves === failure) throw new Error(token);
					await f.persistence.save(row);
				},
			},
		});
		await service.connect("local", input);
		const active = required(f.stored()[0]).credentialId;
		failure = saves + 2;
		await expect(
			service.connect("local", { ...input, instanceUrl: "https://other.example" }),
		).rejects.toThrow();
		expect(service.connection("local")?.instanceUrl).toBe(input.instanceUrl);
		expect(service.connection("local")?.connected).toBe(true);
		expect(required(f.stored()[0]).credentialId).toBe(active);
		expect(await f.credentialStore.get(required(active))).toBe(token);
	});
	test("committed replacement stays live when retirement fails, then disconnect retries", async () => {
		const f = fixture();
		let failDelete = false;
		const service = await createIssuesService({
			...f,
			fetch: f.fetcher,
			credentialStore: {
				...f.credentialStore,
				delete: async (id) => {
					if (failDelete) throw new Error(token);
					await f.credentialStore.delete(id);
				},
			},
		});
		await service.connect("local", input);
		const old = required(required(f.stored()[0]).credentialId);
		failDelete = true;
		await expect(
			service.connect("local", { ...input, instanceUrl: "https://other.example" }),
		).rejects.toThrow("cleanup failed");
		expect(service.connection("local")?.instanceUrl).toBe("https://other.example");
		expect(service.connection("local")?.connected).toBe(true);
		expect(required(f.stored()[0]).cleanupCredentialIds).toEqual([old]);
		failDelete = false;
		await service.disconnect("local");
		expect(await f.credentialStore.get(old)).toBeNull();
	});
	for (const phase of ["set", "save", "restore"] as const) {
		test(`disconnect during ${phase} blocks late installation and removes credentials`, async () => {
			const f = fixture();
			const gate = deferred();
			const entered = deferred();
			let pause = false;
			const service = await createIssuesService({
				...f,
				fetch: f.fetcher,
				credentialStore: {
					...f.credentialStore,
					set: async (id, value) => {
						await f.credentialStore.set(id, value);
						if (pause && phase === "set") {
							entered.resolve();
							await gate.promise;
						}
					},
					get: async (id) => {
						if (pause && phase === "restore") {
							entered.resolve();
							await gate.promise;
						}
						return f.credentialStore.get(id);
					},
				},
				persistence: {
					load: f.persistence.load,
					save: async (row) => {
						if (
							pause &&
							phase === "save" &&
							row.credentialId &&
							row.cleanupCredentialIds?.length === 1
						) {
							entered.resolve();
							await gate.promise;
						}
						await f.persistence.save(row);
					},
				},
			});
			await service.connect("local", input);
			let target = service;
			if (phase === "restore")
				target = await createIssuesService({
					...f,
					fetch: f.fetcher,
					credentialStore: {
						...f.credentialStore,
						get: async (id) => {
							entered.resolve();
							await gate.promise;
							return f.credentialStore.get(id);
						},
					},
				});
			pause = true;
			const pending =
				phase === "restore" ? target.restore("local") : target.connect("local", input);
			const rejected = pending.then(
				() => {
					throw new Error("unexpected success");
				},
				(error) => {
					expect(error).toHaveProperty("code");
				},
			);
			await entered.promise;
			const stopped = target.disconnect("local");
			expect(target.connection("local")?.connected).toBe(false);
			await expect(target.connect("local", input)).rejects.toThrow();
			gate.resolve();
			await rejected;
			await stopped;
			expect(target.connection("local")?.connected).toBe(false);
			expect(required(f.stored()[0]).credentialId).toBeUndefined();
			expect(required(f.stored()[0]).cleanupCredentialIds).toEqual([]);
		});
	}
});

describe("vault boundaries", () => {
	test("missing credential remains disconnected with no PAT request or retry loop", async () => {
		const f = fixture();
		const first = await createIssuesService({ ...f, fetch: f.fetcher });
		await first.connect("local", input);
		let gets = 0;
		const restored = await createIssuesService({
			...f,
			fetch: f.fetcher,
			credentialStore: {
				...f.credentialStore,
				get: async () => {
					gets++;
					return null;
				},
			},
		});
		expect((await restored.restore("local"))?.connected).toBe(false);
		expect(gets).toBe(1);
		expect(f.requests).toHaveLength(1);
	});
	test("tokens are exact bounded printable ASCII", async () => {
		const f = fixture();
		const service = await createIssuesService({ ...f, fetch: f.fetcher });
		for (const value of ["", " token", "token ", "a\nb", "a\u007fb", "aéb", "x".repeat(4097)]) {
			await expect(service.connect("local", { ...input, token: value })).rejects.toThrow();
		}
		expect(f.requests).toHaveLength(0);
		await service.connect("local", input);
		expect(await f.credentialStore.get(required(required(f.stored()[0]).credentialId))).toBe(token);
	});
	test("disconnect during committed save retires new active and old staged credentials", async () => {
		const f = fixture();
		const gate = deferred();
		const entered = deferred();
		let pause = false;
		const service = await createIssuesService({
			...f,
			fetch: f.fetcher,
			persistence: {
				load: f.persistence.load,
				save: async (row) => {
					if (pause && row.credentialId && row.credentialId !== f.stored()[0]?.credentialId) {
						entered.resolve();
						await gate.promise;
					}
					await f.persistence.save(row);
				},
			},
		});
		await service.connect("local", input);
		const old = required(required(f.stored()[0]).credentialId);
		pause = true;
		const pending = service.connect("local", input).catch((error) => {
			expect(error).toHaveProperty("code");
		});
		await entered.promise;
		const stopped = service.disconnect("local");
		gate.resolve();
		await pending;
		await stopped;
		expect(service.connection("local")?.connected).toBe(false);
		expect(await f.credentialStore.get(old)).toBeNull();
		expect(required(f.stored()[0]).cleanupCredentialIds).toEqual([]);
		expect(required(f.stored()[0]).credentialId).toBeUndefined();
	});
});

test("disconnect save failure blocks runtime and can be retried without active-key loss", async () => {
	const f = fixture();
	let fail = false;
	const service = await createIssuesService({
		...f,
		fetch: f.fetcher,
		persistence: {
			load: f.persistence.load,
			save: async (row) => {
				if (fail) throw new Error(token);
				await f.persistence.save(row);
			},
		},
	});
	await service.connect("local", input);
	const active = required(required(f.stored()[0]).credentialId);
	fail = true;
	await expect(service.disconnect("local")).rejects.toThrow("could not be saved");
	expect(service.connection("local")?.connected).toBe(false);
	expect(await f.credentialStore.get(active)).toBe(token);
	await expect(service.connect("local", input)).rejects.toThrow("blocked");
	await expect(service.restore("local")).rejects.toThrow("blocked");
	fail = false;
	await service.disconnect("local");
	expect(await f.credentialStore.get(active)).toBeNull();
});

test("restore vault errors are sanitized and make no network request", async () => {
	const f = fixture();
	const first = await createIssuesService({ ...f, fetch: f.fetcher });
	await first.connect("local", input);
	const service = await createIssuesService({
		...f,
		fetch: f.fetcher,
		credentialStore: {
			...f.credentialStore,
			get: async () => {
				throw new Error(token);
			},
		},
	});
	let caught: unknown;
	try {
		await service.restore("local");
	} catch (error) {
		caught = error;
	}
	expect(String(caught)).toContain("could not be loaded");
	expect(String(caught)).not.toContain(token);
	expect(caught).not.toHaveProperty("cause");
	expect(f.requests).toHaveLength(1);
	expect(service.connection("local")?.connected).toBe(false);
});
