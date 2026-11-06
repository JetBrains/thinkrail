import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueReference } from "@thinkrail/contracts";
import {
	createIssueWorkspaceCoordinator,
	type IssueWorkspaceOptions,
	type IssueWorkspaceRecord,
	type WorkspaceHandle,
} from "./workspace";

const ref: IssueReference = {
	provider: "gitlab",
	instanceUrl: "https://gitlab.example",
	projectId: "7",
	number: 42,
};
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing fixture value");
	return value;
}
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "issue-workspace-")));
	roots.push(root);
	const records = new Map<string, IssueWorkspaceRecord>();
	const workspaces: WorkspaceHandle[] = [];
	const trees: { path: string; branch: string | null; prunable?: boolean }[] = [];
	const sessions = new Map<string, "idle" | "busy">();
	const bound = new Map<string, string>();
	const events: string[] = [];
	const createdNames: string[] = [];
	let failSave = 0;
	let failCreate = false;
	let failSession = false;
	let saves = 0;
	const options: IssueWorkspaceOptions = {
		projectId: "local",
		projectPath: async () => root,
		load: async (key) => structuredClone(records.get(key) ?? null),
		save: async (key, record) => {
			events.push(`save:${record.implementation?.state ?? "design"}`);
			if (++saves === failSave) throw new Error("secret save error");
			records.set(key, structuredClone(record));
		},
		findWorkspace: async (query) =>
			workspaces.find((ws) =>
				"workspaceId" in query
					? ws.id === query.workspaceId
					: ws.worktreePath === query.worktreePath,
			) ?? null,
		listGitWorktrees: async () => trees,
		createWorkspaceAtPath: async (projectId, path, branch, name) => {
			events.push("create");
			createdNames.push(name);
			if (failCreate) throw new Error("uncertain create");
			await mkdir(path, { recursive: true });
			const ws: WorkspaceHandle = {
				id: `ws-${workspaces.length}`,
				projectId,
				worktreePath: path,
				branch,
			};
			workspaces.push(ws);
			trees.push({ path, branch });
			return ws;
		},
		defaultWorkspace: async (projectId) => ({
			id: "default",
			projectId,
			worktreePath: root,
			branch: "main",
			kind: "default",
		}),
		sessionExists: async (sessionId) => sessions.get(sessionId) ?? false,
		boundSession: async (stage, workspaceId) => bound.get(`${stage}:${workspaceId}`),
		createSession: async (workspaceId) => {
			events.push(`session:${workspaceId}`);
			if (failSession) throw new Error("secret session error");
			const id = `session-${sessions.size}`;
			sessions.set(id, "idle");
			return id;
		},
	};
	return {
		root,
		records,
		workspaces,
		trees,
		sessions,
		bound,
		events,
		createdNames,
		options,
		coordinator: () => createIssueWorkspaceCoordinator(options),
		failSave: (n: number) => {
			failSave = n;
		},
		failCreate: (on = true) => {
			failCreate = on;
		},
		failSession: (on = true) => {
			failSession = on;
		},
	};
}

test("design uses Default, persists workspace before session and reuses an idle session", async () => {
	const f = await fixture();
	const c = f.coordinator();
	const launch = await c.design(ref);
	expect(launch.workspaceId).toBe("default");
	expect(await f.coordinator().design(ref)).toEqual(launch);
	expect(f.events).toEqual(["save:design", "session:default", "save:design"]);
	expect(f.workspaces).toHaveLength(0);
});

test("implementation reserves exact IID path, persists completion, then creates a session", async () => {
	const f = await fixture();
	const launch = await f.coordinator().implementation(ref);
	expect(f.workspaces[0]?.worktreePath).toBe(join(f.root, ".worktrees", "issue-42"));
	expect(launch.workspaceId).toBe(required(f.workspaces[0]).id);
	expect(f.events).toEqual([
		"save:pending",
		"create",
		"save:completed",
		"save:completed",
		"session:ws-0",
		"save:completed",
	]);
	expect(f.createdNames).toEqual(["issue-42"]);
	expect(await f.coordinator().implementation(ref)).toEqual(launch);
	expect(f.events.filter((event) => event === "create")).toHaveLength(1);
});

test("pending-save failure prevents creation", async () => {
	const f = await fixture();
	f.failSave(1);
	await expect(f.coordinator().implementation(ref)).rejects.toThrow();
	expect(f.events).not.toContain("create");
});

test("completed-save failure halts before session; matching pending ownership can reconcile", async () => {
	const f = await fixture();
	f.failSave(2);
	await expect(f.coordinator().implementation(ref)).rejects.toThrow("reconciliation");
	expect(f.events.some((event) => event.startsWith("session:"))).toBe(false);
	await f.coordinator().implementation(ref);
	expect(f.workspaces).toHaveLength(1);
	expect(f.events.filter((event) => event === "create")).toHaveLength(1);
});

test("an abandoned worktree reservation that left nothing on disk is re-reserved", async () => {
	const f = await fixture();
	f.failCreate();
	await expect(f.coordinator().implementation(ref)).rejects.toThrow();
	const abandoned = required([...f.records.values()][0]).implementation;
	expect(abandoned?.state).toBe("pending");
	f.failCreate(false);
	const launch = await f.coordinator().implementation(ref);
	const completed = required([...f.records.values()][0]).implementation;
	expect(completed).toMatchObject({
		state: "completed",
		workspaceId: launch.workspaceId,
		session: { id: launch.sessionId },
	});
	expect(completed?.branch).not.toBe(abandoned?.branch);
	expect(f.events.filter((event) => event === "create")).toHaveLength(2);
	expect(f.workspaces).toHaveLength(1);
});

test("an abandoned pending marker adopts the session the host already bound", async () => {
	const f = await fixture();
	f.failSave(2);
	await expect(f.coordinator().design(ref)).rejects.toThrow("reconciliation");
	const sessionId = required([...f.sessions.keys()][0]);
	expect(required([...f.records.values()][0]).sessionPending).toEqual({
		stage: "design",
		workspaceId: "default",
	});
	// The host binds the created session immediately; only the association save was lost.
	f.bound.set("design:default", sessionId);
	expect(await f.coordinator().design(ref)).toEqual({ workspaceId: "default", sessionId });
	expect(f.sessions.size).toBe(1);
	expect(f.events.filter((event) => event.startsWith("session:"))).toHaveLength(1);
	const record = required([...f.records.values()][0]);
	expect(record).not.toHaveProperty("sessionPending");
	expect(record.design).toEqual({ workspaceId: "default", sessionId });
});

test("an abandoned pending marker with no bound session is cleared and retried once", async () => {
	const f = await fixture();
	f.failSave(4);
	await expect(f.coordinator().implementation(ref)).rejects.toThrow("reconciliation");
	const record = required([...f.records.values()][0]);
	expect(record.sessionPending?.stage).toBe("implementation");
	const rebound = await f.coordinator().implementation(ref);
	expect(rebound.sessionId).not.toBe("");
	expect(f.sessions.size).toBe(2);
	expect(required([...f.records.values()][0])).not.toHaveProperty("sessionPending");
});

test("concurrent launches serialize one issue and share one session", async () => {
	const f = await fixture();
	const c = f.coordinator();
	const launches = await Promise.all(Array.from({ length: 8 }, () => c.implementation(ref)));
	expect(new Set(launches.map((launch) => launch.sessionId)).size).toBe(1);
	expect(f.workspaces).toHaveLength(1);
});

test("busy recorded session blocks without prompting/creating; missing session is replaced", async () => {
	const f = await fixture();
	const launch = await f.coordinator().implementation(ref);
	f.sessions.set(launch.sessionId, "busy");
	await expect(f.coordinator().implementation(ref)).rejects.toThrow();
	expect(f.events.filter((event) => event.startsWith("session:"))).toHaveLength(1);
	f.sessions.delete(launch.sessionId);
	await f.coordinator().implementation(ref);
	expect(f.events.filter((event) => event.startsWith("session:"))).toHaveLength(2);
});

for (const field of ["projectId", "branch", "worktreePath", "kind"] as const) {
	test(`completed ownership rejects changed workspace ${field}`, async () => {
		const f = await fixture();
		await f.coordinator().implementation(ref);
		Object.assign(required(f.workspaces[0]), { [field]: field === "kind" ? "external" : "wrong" });
		await expect(f.coordinator().implementation(ref)).rejects.toThrow();
	});
}

test("pending recovery needs both registered managed workspace and exact Git branch/path", async () => {
	const f = await fixture();
	f.failSave(2);
	await expect(f.coordinator().implementation(ref)).rejects.toThrow();
	required(f.trees[0]).branch = "unrelated";
	await expect(f.coordinator().implementation(ref)).rejects.toThrow();
	required(f.trees[0]).branch = required(f.workspaces[0]).branch;
	f.workspaces.splice(0);
	await expect(f.coordinator().implementation(ref)).rejects.toThrow();
});

test("arbitrary existing checkout without an ownership record is never adopted", async () => {
	const f = await fixture();
	const path = join(f.root, ".worktrees", "issue-42");
	f.trees.push({ path, branch: "issue-42" });
	await expect(f.coordinator().implementation(ref)).rejects.toThrow();
	expect(f.records.size).toBe(0);
	expect(f.events).not.toContain("create");
});

test("remote cross-binding never reuses the same IID workspace", async () => {
	const f = await fixture();
	await f.coordinator().implementation(ref);
	for (const other of [
		{ ...ref, projectId: "8" },
		{ ...ref, instanceUrl: "https://other.example" },
	]) {
		await expect(f.coordinator().implementation(other)).rejects.toThrow();
	}
	expect(f.records.size).toBe(1);
});

test("local project participates in record key and record identity is checked", async () => {
	const f = await fixture();
	await f.coordinator().design(ref);
	await createIssueWorkspaceCoordinator({ ...f.options, projectId: "other" }).design(ref);
	expect(f.records.size).toBe(2);
	const record = required([...f.records.values()][0]);
	record.reference.projectId = "unrelated";
	await expect(f.coordinator().design(ref)).rejects.toThrow();
});

test("the recorded session is reused for every stage and re-entry without a version", async () => {
	const f = await fixture();
	const first = await f.coordinator().implementation(ref);
	for (let repeat = 0; repeat < 3; repeat++)
		expect(await f.coordinator().implementation(ref)).toEqual(first);
	expect(f.workspaces).toHaveLength(1);
	expect(f.events.filter((event) => event.startsWith("session:"))).toHaveLength(1);
	// No version is recorded or compared: the association holds only the session identity.
	expect(required([...f.records.values()][0]).implementation).toMatchObject({
		session: { id: first.sessionId },
	});
});

for (const occupied of ["directory", "file"] as const) {
	test(`occupied ${occupied} at exact IID path is never overwritten or suffixed`, async () => {
		const f = await fixture();
		const parent = join(f.root, ".worktrees");
		await mkdir(parent);
		const path = join(parent, "issue-42");
		if (occupied === "directory") await mkdir(path);
		else await writeFile(path, "user data");
		await expect(f.coordinator().implementation(ref)).rejects.toThrow();
		expect(f.records.size).toBe(0);
		expect(f.events).not.toContain("create");
	});
}

test("completed workspace missing from Git registry is not recreated", async () => {
	const f = await fixture();
	await f.coordinator().implementation(ref);
	f.trees.splice(0);
	await expect(f.coordinator().implementation(ref)).rejects.toThrow();
	expect(f.events.filter((event) => event === "create")).toHaveLength(1);
});

test("design busy session is not prompted or replaced", async () => {
	const f = await fixture();
	const launch = await f.coordinator().design(ref);
	f.sessions.set(launch.sessionId, "busy");
	await expect(f.coordinator().design(ref)).rejects.toThrow();
	expect(f.events.filter((event) => event.startsWith("session:"))).toHaveLength(1);
});

test("successful sessions clear pending markers without discarding either stage's records", async () => {
	const f = await fixture();
	const design = await f.coordinator().design(ref);
	const implementation = await f.coordinator().implementation(ref);
	const record = required([...f.records.values()][0]);
	expect(record).not.toHaveProperty("sessionPending");
	expect(record.design).toEqual(design);
	expect(record.implementation).toMatchObject({
		state: "completed",
		workspaceId: implementation.workspaceId,
		session: { id: implementation.sessionId },
	});
	f.sessions.delete(design.sessionId);
	await f.coordinator().design(ref);
	expect(required([...f.records.values()][0]).implementation).toEqual(record.implementation);
	expect(required([...f.records.values()][0])).not.toHaveProperty("sessionPending");
});

for (const stage of ["design", "implementation"] as const) {
	test(`${stage} cannot create a session before its durable pending save succeeds`, async () => {
		const f = await fixture();
		const save = f.options.save;
		f.options.save = async (key, record) => {
			if ("sessionPending" in record) throw new Error("pending save failed");
			await save(key, record);
		};
		await expect(
			stage === "design" ? f.coordinator().design(ref) : f.coordinator().implementation(ref),
		).rejects.toThrow("reconciliation");
		expect(f.sessions.size).toBe(0);
		expect(f.events.some((event) => event.startsWith("session:"))).toBe(false);
	});
}

function lookupOnly(f: Awaited<ReturnType<typeof fixture>>) {
	const forbidden = async (): Promise<never> => {
		f.events.push("forbidden lookup side effect");
		throw new Error("lookup must not invoke this port");
	};
	Object.assign(f.options, {
		save: forbidden,
		createWorkspaceAtPath: forbidden,
		defaultWorkspace: forbidden,
		sessionExists: forbidden,
		createSession: forbidden,
	});
	f.events.length = 0;
	return f.coordinator();
}

for (const state of ["missing", "pending", "sessionPending"] as const) {
	test(`owned implementation rejects ${state} without writes, recovery or session calls`, async () => {
		const f = await fixture();
		if (state !== "missing") {
			await f.coordinator().implementation(ref);
			const record = required([...f.records.values()][0]);
			if (state === "pending") {
				const ownership = required(record.implementation);
				record.implementation = {
					state: "pending",
					worktreePath: ownership.worktreePath,
					branch: ownership.branch,
				};
			} else record.sessionPending = { stage: "design", workspaceId: "default" };
		}
		await expect(lookupOnly(f).ownedImplementation(ref)).rejects.toThrow("reconciliation");
		expect(f.events).toEqual([]);
	});
}

test("owned implementation returns the verified managed workspace without touching sessions", async () => {
	const f = await fixture();
	const launch = await f.coordinator().implementation(ref);
	f.sessions.set(launch.sessionId, "busy");
	expect(await lookupOnly(f).ownedImplementation(ref)).toEqual(required(f.workspaces[0]));
	expect(f.events).toEqual([]);
});

for (const corruption of [
	"foreign",
	"missing",
	"prunable",
	"branch",
	"duplicate",
	"registryPath",
	"detached",
	"workspaceId",
	"workspacePath",
	"workspaceBranch",
	"project",
	"kind",
	"recordPath",
	"recordId",
	"recordBranch",
	"identity",
	"missingDirectory",
	"file",
	"parentLink",
	"childLink",
] as const) {
	test(`owned implementation rejects ${corruption} ownership without side effects`, async () => {
		const f = await fixture();
		await f.coordinator().implementation(ref);
		const record = required([...f.records.values()][0]);
		const ownership = required(record.implementation);
		const ws = required(f.workspaces[0]);
		const tree = required(f.trees[0]);
		let reference = ref;
		switch (corruption) {
			case "foreign":
				reference = { ...ref, projectId: "8" };
				break;
			case "missing":
				f.trees.length = 0;
				break;
			case "prunable":
				tree.prunable = true;
				break;
			case "branch":
				tree.branch = "foreign";
				break;
			case "duplicate":
				f.trees.push({ ...tree });
				break;
			case "registryPath":
				tree.path = f.root;
				break;
			case "detached":
				tree.branch = null;
				break;
			case "workspaceId":
				ws.id = "foreign";
				break;
			case "workspacePath":
				ws.worktreePath = f.root;
				break;
			case "workspaceBranch":
				ws.branch = "foreign";
				break;
			case "project":
				ws.projectId = "foreign";
				break;
			case "kind":
				ws.kind = "external";
				break;
			case "recordPath":
				ownership.worktreePath = f.root;
				break;
			case "recordId":
				if (ownership.state === "completed") ownership.workspaceId = "";
				break;
			case "recordBranch":
				ownership.branch = "";
				break;
			case "identity":
				record.reference.projectId = "foreign";
				break;
			case "missingDirectory":
				await rm(ws.worktreePath, { recursive: true });
				break;
			case "file":
				await rm(ws.worktreePath, { recursive: true });
				await writeFile(ws.worktreePath, "occupied");
				break;
			case "parentLink":
			case "childLink": {
				const path = corruption === "parentLink" ? join(f.root, ".worktrees") : ws.worktreePath;
				const target = join(f.root, "other");
				await mkdir(target);
				await rm(path, { recursive: true });
				await symlink(target, path, "junction");
				break;
			}
		}
		await expect(lookupOnly(f).ownedImplementation(reference)).rejects.toThrow("reconciliation");
		expect(f.events).toEqual([]);
	});
}

test("owned implementation rejects occupied unowned paths and invalid references", async () => {
	const f = await fixture();
	await mkdir(join(f.root, ".worktrees", "issue-42"), { recursive: true });
	const c = lookupOnly(f);
	await expect(c.ownedImplementation(ref)).rejects.toThrow("reconciliation");
	await expect(c.ownedImplementation({ ...ref, number: 0 })).rejects.toThrow("reconciliation");
	expect(f.events).toEqual([]);
	expect(f.records.size).toBe(0);
});
