import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	approvalPublication,
	designVersion,
	implementationVersion,
	type WorkflowRecord,
} from "../issues";
import { saveProjects } from "../persistence";
import { setProjectTrust } from "../projects";
import { createIssuesHost } from "./issues";
import { createIssueWorkflowPersistence } from "./issueWorkflowPersistence";

let dir: string;
let previous: string | undefined;
// Host tests never touch the real OS vault.
const vault = new Map<string, string>();
const credentials = {
	async get(id: string) {
		return vault.get(id) ?? null;
	},
	async set(id: string, token: string) {
		vault.set(id, token);
	},
	async delete(id: string) {
		vault.delete(id);
	},
};
const input = {
	instanceUrl: "https://gitlab.example",
	projectId: "group/repo",
	token: "private-test-PAT",
};
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "issues-host-"));
	previous = process.env.THINKRAIL_DATA_DIR;
	process.env.THINKRAIL_DATA_DIR = dir;
	saveProjects(
		["one", "two"].map((id) => ({
			id,
			name: id,
			slug: id,
			path: join(dir, id),
			lastOpened: 1,
			trusted: true,
		})),
	);
});
afterEach(() => {
	if (previous === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = previous;
	rmSync(dir, { recursive: true, force: true });
});
const fetcher = (async (url: string | URL | Request) =>
	new Response(
		JSON.stringify(
			String(url).includes("/issues?") ? [] : { id: 42, path_with_namespace: "group/repo" },
		),
	)) as typeof fetch;

test("lazy adapter connects, lists, disconnects and reloads only public bindings", async () => {
	const host = createIssuesHost({ dir, fetch: fetcher, credentials });
	expect(await host.connection({ projectId: "one" })).toBeNull();
	expect(await host.connect({ projectId: "one", input })).toMatchObject({
		connected: true,
		remoteProjectId: "42",
	});
	expect((await host.list({ projectId: "one" })).issues).toEqual([]);
	const disk = readFileSync(join(dir, "issue-bindings.json"), "utf8");
	expect(disk).not.toContain(input.token);
	expect(disk).not.toContain("token");
	expect(await host.disconnect({ projectId: "one" })).toEqual({ ok: true });
	await expect(host.list({ projectId: "one" })).rejects.toThrow("not connected");
	expect(
		await createIssuesHost({ dir, credentials }).connection({ projectId: "one" }),
	).toMatchObject({ connected: false });
});

test("unknown params and missing projects fail closed; an untrusted project may still connect", async () => {
	let calls = 0;
	const host = createIssuesHost({
		dir,
		credentials,
		fetch: (async (...args) => {
			calls++;
			return fetcher(...args);
		}) as typeof fetch,
	});
	for (const params of [null, [], {}, { projectId: 1 }, { projectId: "one", token: input.token }]) {
		await expect(host.connection(params)).rejects.toThrow("Invalid Issue request");
	}
	await expect(
		host.connect({ projectId: "one", input: { ...input, extra: input.token } }),
	).rejects.toThrow("Invalid Issue request");
	await expect(host.connection({ projectId: "absent" })).rejects.toThrow("unavailable");
	expect(calls).toBe(0);
	// Connecting is a user's explicit address+token entry, not repo-defined code: trust is not required.
	setProjectTrust("one", false);
	expect(await host.connect({ projectId: "one", input })).toMatchObject({ connected: true });
	expect((await host.list({ projectId: "one" })).issues).toEqual([]);
	expect(calls).toBeGreaterThan(0);
	expect(await host.disconnect({ projectId: "one" })).toEqual({ ok: true });
});

test("concurrent upserts across adapters retain both bindings", async () => {
	const a = createIssuesHost({ dir, fetch: fetcher, credentials });
	const b = createIssuesHost({ dir, fetch: fetcher, credentials });
	await Promise.all([
		a.connect({ projectId: "one", input }),
		b.connect({ projectId: "two", input }),
	]);
	const restored = createIssuesHost({ dir, fetch: fetcher, credentials });
	expect(await restored.connection({ projectId: "one" })).not.toBeNull();
	expect(await restored.connection({ projectId: "two" })).not.toBeNull();
});

test("failed lazy initialization is retryable and never echoes file contents", async () => {
	writeFileSync(join(dir, "issue-bindings.json"), input.token);
	const host = createIssuesHost({ dir, credentials });
	await expect(host.connection({ projectId: "one" })).rejects.toThrow("could not be loaded");
	writeFileSync(join(dir, "issue-bindings.json"), "[]");
	expect(await host.connection({ projectId: "one" })).toBeNull();
});

test("remote failures do not echo credentials", async () => {
	const host = createIssuesHost({
		dir,
		credentials,
		fetch: (async () => {
			throw new Error(input.token);
		}) as unknown as typeof fetch,
	});
	try {
		await host.connect({ projectId: "one", input });
		throw new Error("expected failure");
	} catch (error) {
		expect(String(error)).not.toContain(input.token);
		expect((error as Error).cause).toBeUndefined();
	}
});

test("trust revocation keeps reads and release working; stage actions stay trust-gated", async () => {
	let calls = 0;
	const host = createIssuesHost({
		dir,
		credentials,
		fetch: (async (...args) => {
			calls++;
			return fetcher(...args);
		}) as typeof fetch,
	});
	await host.connect({ projectId: "one", input });
	const before = calls;
	setProjectTrust("one", false);
	expect((await host.list({ projectId: "one" })).issues).toEqual([]);
	expect(calls).toBeGreaterThan(before);
	expect(await host.connection({ projectId: "one" })).toMatchObject({ connected: true });
	await host.disconnect({ projectId: "one" });
	expect(await host.connection({ projectId: "one" })).toMatchObject({ connected: false });
});

test("invalid connection inputs are rejected by every entry without reflecting input", async () => {
	const host = createIssuesHost({ dir, credentials });
	for (const method of [
		host.connection,
		host.connect,
		host.disconnect,
		host.list,
		host.repositoryAddress,
	]) {
		await expect(method({ projectId: input.token, extra: input.token })).rejects.toThrow(
			"Invalid Issue request",
		);
	}
	for (const bad of [
		null,
		{},
		{ ...input, token: "" },
		{ ...input, instanceUrl: "http://gitlab.example" },
		{
			...input,
			instanceUrl: "http://gitlab.example",
			httpConsent: { instanceUrl: "https://gitlab.example" },
		},
		{ ...input, instanceUrl: `https://${input.token}@gitlab.example` },
	]) {
		// Non-local HTTP without exact consent is shape-valid but rejected by the service policy.
		const failure = await host.connect({ projectId: "one", input: bad }).catch((error) => error);
		expect(String(failure)).toMatch(/Invalid Issue (request|binding)\./);
		expect(String(failure)).not.toContain(input.token);
	}
});

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}
function repository(id: string, ...remotes: readonly (readonly [string, string])[]): string {
	const path = join(dir, id);
	mkdirSync(path, { recursive: true });
	git(path, "init", "-q");
	for (const [name, url] of remotes) git(path, "remote", "add", name, url);
	return path;
}
function registered(projects: Record<string, { path: string; trusted?: boolean }>): void {
	saveProjects(
		Object.entries(projects).map(([id, project]) => ({
			id,
			name: id,
			slug: id,
			path: project.path,
			lastOpened: 1,
			trusted: project.trusted ?? true,
		})),
	);
}

test("only a single credential-free HTTP(S) origin becomes a repository address", async () => {
	const host = createIssuesHost({ dir, credentials });
	const cases: readonly [string, readonly (readonly [string, string])[], string | null][] = [
		[
			"https",
			[["origin", "https://gitlab.com/group/repo.git/"]],
			"https://gitlab.com/group/repo.git",
		],
		[
			"http",
			[["origin", "http://gitlab.internal:8080/group/repo"]],
			"http://gitlab.internal:8080/group/repo",
		],
		["scp", [["origin", "git@gitlab.com:group/repo.git"]], null],
		["ssh", [["origin", "ssh://git@code.example/group/repo.git"]], null],
		["credentials", [["origin", "https://user:secret@gitlab.com/group/repo.git"]], null],
		["query", [["origin", "https://gitlab.com/group/repo.git?private_token=secret"]], null],
		["fragment", [["origin", "https://gitlab.com/group/repo.git#secret"]], null],
		["no-remote", [], null],
		["other-remote-only", [["upstream", "https://gitlab.com/group/repo.git"]], null],
		[
			"ambiguous",
			[
				["origin", "https://gitlab.com/group/repo.git"],
				["upstream", "https://gitlab.com/mirror/repo.git"],
			],
			null,
		],
	];
	for (const [id, remotes, expected] of cases) {
		registered({ [id]: { path: repository(id, ...remotes) } });
		const result = await host.repositoryAddress({ projectId: id });
		expect(result).toEqual({ repositoryUrl: expected });
		expect(JSON.stringify(result)).not.toContain("secret");
	}
}, 30_000);

test("the repository address needs membership and trust and takes no caller path", async () => {
	const host = createIssuesHost({ dir, credentials });
	const path = repository("repo", ["origin", "https://gitlab.com/group/repo.git"]);
	registered({ repo: { path, trusted: false } });
	await expect(host.repositoryAddress({ projectId: "repo" })).rejects.toThrow("trust");
	await expect(host.repositoryAddress({ projectId: "absent" })).rejects.toThrow("unavailable");
	setProjectTrust("repo", true);
	expect(await host.repositoryAddress({ projectId: "repo" })).toEqual({
		repositoryUrl: "https://gitlab.com/group/repo.git",
	});
	// No caller-supplied path, and no token can ride along: only `projectId` is allowed.
	for (const params of [
		null,
		[],
		{},
		{ projectId: 1 },
		{ projectId: "repo", path: "C:/elsewhere" },
		{ path },
		{ projectId: "repo", token: input.token },
		{ projectId: "repo", projectPath: path },
	]) {
		const failure = await host.repositoryAddress(params).catch((error: unknown) => error);
		expect(String(failure)).toContain("Invalid Issue request.");
		expect(String(failure)).not.toContain(input.token);
		expect(String(failure)).not.toContain(path);
	}
});

test("a repository whose local read fails answers null instead of git output", async () => {
	const host = createIssuesHost({ dir, credentials });
	const path = join(dir, "not-a-repository");
	mkdirSync(path, { recursive: true });
	registered({ plain: { path } });
	expect(await host.repositoryAddress({ projectId: "plain" })).toEqual({ repositoryUrl: null });
});

const approvalReference = {
	provider: "gitlab" as const,
	instanceUrl: "https://gitlab.example",
	projectId: "42",
	number: 7,
};
const approvalTarget = { projectId: "one", reference: approvalReference };
const approvedDesign = designVersion("design");

/** Receipts live exactly where the actions keep them: `<dir>/issue-workflow`. */
async function writeRecord(record: WorkflowRecord): Promise<void> {
	const receipts = join(dir, "issue-workflow");
	mkdirSync(receipts, { recursive: true });
	const store = createIssueWorkflowPersistence(receipts);
	expect(await store.compareAndSet(approvalReference, record.revision - 1, record)).toBe(true);
}

function designRecord(approved: boolean, pending = false): WorkflowRecord {
	return {
		revision: 1,
		design: {
			publication: approvalPublication({
				stage: "design",
				version: approvedDesign,
				noteId: 1,
				resetEventId: 0,
			}),
			resetConfirmedAbsent: true,
			approved,
		},
		...(pending
			? { pending: { operation: "approve-design" as const, version: approvedDesign } }
			: {}),
	};
}

test("an approved design receipt answers its own digest for the matching reference", async () => {
	const host = createIssuesHost({ dir, credentials });
	// No store at all: a read answers null and never creates one.
	expect(await host.designApproval(approvalTarget)).toEqual({ approvedDesignVersion: null });
	expect(existsSync(join(dir, "issue-workflow"))).toBe(false);
	await writeRecord(designRecord(true));
	expect(await host.designApproval(approvalTarget)).toEqual({
		approvedDesignVersion: approvedDesign,
	});
	// A different issue number in the same store has no receipt of its own.
	expect(
		await host.designApproval({
			projectId: "one",
			reference: { ...approvalReference, number: 8 },
		}),
	).toEqual({ approvedDesignVersion: null });
	// It is a digest read: membership is enough, and no credential is needed or echoed.
	setProjectTrust("one", false);
	expect(await host.designApproval(approvalTarget)).toEqual({
		approvedDesignVersion: approvedDesign,
	});
});

test("an unapproved or pending design receipt answers null", async () => {
	const host = createIssuesHost({ dir, credentials });
	await writeRecord(designRecord(false));
	expect(await host.designApproval(approvalTarget)).toEqual({ approvedDesignVersion: null });
	await writeRecord({ ...designRecord(true, true), revision: 2 });
	expect(await host.designApproval(approvalTarget)).toEqual({ approvedDesignVersion: null });
});

test("an implementation receipt never stands in for a design approval", async () => {
	const host = createIssuesHost({ dir, credentials });
	const commit = "a".repeat(40);
	await writeRecord({
		revision: 1,
		design: {
			publication: approvalPublication({
				stage: "design",
				version: approvedDesign,
				noteId: 1,
				resetEventId: 0,
			}),
			resetConfirmedAbsent: true,
			approved: false,
		},
		implementation: {
			publication: approvalPublication({
				stage: "implementation",
				version: implementationVersion(commit, approvedDesign),
				noteId: 2,
				resetEventId: 0,
			}),
			designVersion: approvedDesign,
			commit,
			resetConfirmedAbsent: true,
			approved: true,
		},
	});
	expect(await host.designApproval(approvalTarget)).toEqual({ approvedDesignVersion: null });
});

test("the design read rejects unknown keys, malformed references and absent projects statically", async () => {
	const host = createIssuesHost({ dir, credentials });
	await writeRecord(designRecord(true));
	for (const params of [
		null,
		[],
		{},
		{ projectId: 1, reference: approvalReference },
		{ ...approvalTarget, approvedDesignVersion: approvedDesign },
		{ ...approvalTarget, token: input.token },
		{ ...approvalTarget, path: "/tmp/repo" },
		{
			projectId: "one",
			reference: { ...approvalReference, number: 0 },
		},
		{
			projectId: "one",
			reference: { ...approvalReference, instanceUrl: `https://${input.token}@gitlab.example` },
		},
	]) {
		const failure = await host.designApproval(params).catch((error: unknown) => error);
		expect(String(failure)).toContain("Invalid Issue request.");
		expect(String(failure)).not.toContain(input.token);
		expect(String(failure)).not.toContain("/tmp/repo");
	}
	await expect(
		host.designApproval({ projectId: "absent", reference: approvalReference }),
	).rejects.toThrow("unavailable");
});

test("the design read answers null over a malformed receipt store instead of leaking it", async () => {
	const host = createIssuesHost({ dir, credentials });
	await writeRecord(designRecord(true));
	const store = join(dir, "issue-workflow");
	writeFileSync(join(store, readdirSync(store)[0] ?? "missing", "1.json"), input.token);
	const failure = await host.designApproval(approvalTarget).catch((error: unknown) => error);
	expect(String(failure)).toContain("requires reconciliation");
	expect(String(failure)).not.toContain(input.token);
});
