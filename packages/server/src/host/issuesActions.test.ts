import { afterEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { designVersion, implementationVersion } from "../issues";
import { saveProjects } from "../persistence";
import { setProjectTrust } from "../projects";
import { listWorkspaceRecords } from "../workspaces";
import { createIssuesHost } from "./issues";

const dirs: string[] = [];
const previous = process.env.THINKRAIL_DATA_DIR;
afterEach(() => {
	if (previous === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = previous;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function git(path: string, ...args: string[]) {
	return execFileSync("git", ["-C", path, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "issue-actions-"));
	dirs.push(dir);
	process.env.THINKRAIL_DATA_DIR = dir;
	git(dir, "init", "-b", "main");
	git(
		dir,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"--allow-empty",
		"-m",
		"initial",
	);
	saveProjects([{ id: "one", name: "one", slug: "one", path: dir, lastOpened: 1, trusted: true }]);
	const reference = {
		provider: "gitlab" as const,
		instanceUrl: "https://gitlab.example",
		projectId: "42",
		number: 1,
	};
	const target = { projectId: "one", reference };
	const input = {
		instanceUrl: reference.instanceUrl,
		projectId: "group/repo",
		token: "fixture-only-private-token",
	};
	let issue = {
		iid: 1,
		title: "Task",
		description: "old",
		state: "opened",
		labels: ["workflow::backlog", "type::bug"],
		updated_at: "2026-01-01T00:00:00Z",
	};
	const events: {
		id: number;
		action: string;
		label: { name: string };
		user: { id: number };
		created_at: string;
	}[] = [];
	const notes: { id: number; body: string; created_at: string }[] = [];
	let clock = 0;
	let created = 0;
	let requests = 0;
	let onRead: (() => void | Promise<void>) | undefined;
	const time = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString();
	function labels(next: string[]) {
		for (const name of issue.labels.filter((v) => !next.includes(v)))
			events.push({
				id: events.length + 1,
				action: "remove",
				label: { name },
				user: { id: 8 },
				created_at: time(),
			});
		for (const name of next.filter((v) => !issue.labels.includes(v)))
			events.push({
				id: events.length + 1,
				action: "add",
				label: { name },
				user: { id: 8 },
				created_at: time(),
			});
		issue.labels = next;
		issue.updated_at = time();
	}
	const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
		requests++;
		const path = new URL(String(url)).pathname;
		if (init?.method !== "PUT" && init?.method !== "POST" && path.includes("/issues/"))
			await onRead?.();
		let result: unknown;
		if (path.endsWith("/resource_label_events")) result = events;
		else if (path.endsWith("/user")) result = { id: 8 };
		else if (path.includes("/members/all/")) result = { id: 8, access_level: 30 };
		else if (path.endsWith("/notes")) {
			if (init?.method === "POST") {
				const body = JSON.parse(String(init.body));
				const note = { id: notes.length + 1, body: body.body, created_at: time() };
				notes.push(note);
				result = note;
			} else result = notes;
		} else if (path.endsWith("/issues/1")) {
			if (init?.method === "PUT") {
				const body = JSON.parse(String(init.body));
				if (body.labels !== undefined) labels(body.labels ? body.labels.split(",") : []);
				if (body.description !== undefined)
					issue = { ...issue, description: body.description, updated_at: time() };
			}
			result = issue;
		} else result = { id: 42, path_with_namespace: "group/repo" };
		return new Response(JSON.stringify(result));
	}) as typeof fetch;
	const savedTokens = new Map<string, string>();
	const prompts: { sessionId: string; prompt: string }[] = [];
	const createdTitles: string[] = [];
	const options = {
		dir,
		credentials: {
			async get(id: string) {
				return savedTokens.get(id) ?? null;
			},
			async set(id: string, token: string) {
				savedTokens.set(id, token);
			},
			async delete(id: string) {
				savedTokens.delete(id);
			},
		},
		fetch: fetcher,
		sessions: {
			create: async (
				_args: unknown,
				_guard: unknown,
				createOptions?: { title?: string | undefined },
			) => {
				created++;
				if (createOptions?.title !== undefined) createdTitles.push(createOptions.title);
				return { sessionId: `session-${created}`, model: null, thinkingLevel: "off" as const };
			},
			status: async () => "idle" as const,
		},
		start: async (sessionId: string, _workspaceId: string, _cwd: string, prompt: string) => {
			prompts.push({ sessionId, prompt });
		},
	};
	const host = createIssuesHost(options);
	return {
		dir,
		prompts,
		createdTitles,
		notes,
		host,
		target,
		input,
		options,
		get created() {
			return created;
		},
		get requests() {
			return requests;
		},
		get issue() {
			return issue;
		},
		get events() {
			return events;
		},
		set onRead(value: typeof onRead) {
			onRead = value;
		},
		approve(name: string) {
			labels([...issue.labels, name]);
		},
		relabel(next: string[]) {
			labels(next);
		},
	};
}

test("actions validate exact envelopes before connection, filesystem or session side effects", async () => {
	const f = fixture();
	for (const action of [
		f.host.approveDesign,
		f.host.approveImplementation,
		f.host.launchDesign,
		f.host.launchImplementation,
		f.host.publishDesign,
		f.host.publishImplementation,
		f.host.startImplementation,
		f.host.validateDesign,
		f.host.validateImplementation,
	]) {
		await expect(action({ ...f.target, sha: "a".repeat(40) })).rejects.toThrow(
			"Invalid Issue request",
		);
		await expect(
			action({ ...f.target, reference: { ...f.target.reference, path: f.dir } }),
		).rejects.toThrow("Invalid Issue request");
	}
	expect(f.requests).toBe(0);
	expect(f.created).toBe(0);
	expect(existsSync(join(f.dir, "issue-workspaces"))).toBe(false);
});

for (const [name, launch] of [
	[
		"design",
		(host: ReturnType<typeof createIssuesHost>, target: ReturnType<typeof fixture>["target"]) =>
			host.launchDesign(target),
	],
	[
		"implementation",
		(host: ReturnType<typeof createIssuesHost>, target: ReturnType<typeof fixture>["target"]) =>
			host.startImplementation(target),
	],
] as const) {
	test(`legacy ${name} launch names a newly created session with the Issue title and reuses without renaming`, async () => {
		const f = fixture();
		await f.host.connect({ projectId: "one", input: f.input });
		const first = await launch(f.host, f.target);
		expect(f.createdTitles).toEqual(["Task"]);
		expect(f.prompts).toHaveLength(0);
		expect(existsSync(join(f.dir, "issue-sessions"))).toBe(false);
		const restored = createIssuesHost(f.options);
		expect(await launch(restored, f.target)).toEqual(first);
		expect(f.createdTitles).toEqual(["Task"]);
		expect(f.created).toBe(1);
	});
}

test("design begin binds and prompts a Default session once without a worktree", async () => {
	const f = fixture();
	await f.host.connect({ projectId: "one", input: f.input });
	const first = await f.host.beginDesign({ ...f.target, locale: "en" });
	expect(await f.host.beginDesign({ ...f.target, locale: "en" })).toEqual(first);
	expect(f.created).toBe(1);
	expect(f.prompts).toHaveLength(1);
	expect(f.prompts[0]?.prompt).toContain("/skill:tomato-issue-workflow");
	expect(listWorkspaceRecords("one").find((w) => w.id === first.workspaceId)?.kind).toBe("default");
	expect(existsSync(join(f.dir, ".worktrees"))).toBe(false);
});

test("design publication receipts survive a host restart and contain no credential", async () => {
	const f = fixture();
	await f.host.connect({ projectId: "one", input: f.input });
	const publication = await f.host.publishDesign({
		...f.target,
		expectedDescription: "old",
		newDescription: "new design",
	});
	expect(publication?.version).toBe(designVersion("new design"));
	expect(f.issue.description).toBe("new design");
	f.approve("tomato::design-approved");
	const restarted = createIssuesHost(f.options);
	await restarted.connect({ projectId: "one", input: f.input });
	expect((await restarted.validateDesign(f.target))?.approved).toBe(true);
	const root = join(f.dir, "issue-workflow");
	const content = readdirSync(root)
		.flatMap((name) =>
			readdirSync(join(root, name)).map((file) => readFileSync(join(root, name, file), "utf8")),
		)
		.join("");
	expect(content).not.toContain(f.input.token);
	expect(content).toContain(designVersion("new design"));
});

for (const change of ["trust", "disconnect", "reconnect", "binding"] as const)
	test(`remote read completion rejects changed ${change} before writes`, async () => {
		const f = fixture();
		await f.host.connect({ projectId: "one", input: f.input });
		f.onRead = async () => {
			f.onRead = undefined;
			if (change === "trust") setProjectTrust("one", false);
			else {
				await f.host.disconnect({ projectId: "one" });
				if (change !== "disconnect")
					await f.host.connect({
						projectId: "one",
						input: {
							...f.input,
							instanceUrl: change === "binding" ? "https://other.example" : f.input.instanceUrl,
						},
					});
			}
		};
		await expect(
			f.host.publishDesign({ ...f.target, expectedDescription: "old", newDescription: "never" }),
		).rejects.toThrow();
		expect(f.issue.description).toBe("old");
		expect(f.created).toBe(0);
	});

test("implementation publication requires owned checkout; fresh actual HEAD invalidates old approval", async () => {
	const f = fixture();
	await f.host.connect({ projectId: "one", input: f.input });
	await f.host.publishDesign({ ...f.target, expectedDescription: "old", newDescription: "design" });
	f.approve("tomato::design-approved");
	expect((await f.host.validateDesign(f.target))?.approved).toBe(true);
	const version = designVersion("design");
	// Lookup-only ownership fails closed and retains its uncertainty fence. Use another issue
	// for the positive launch path rather than clearing a production fence in a test.
	const missing = {
		...f.target,
		reference: { ...f.target.reference, number: 2 },
		approvedDesignVersion: version,
	};
	await expect(f.host.publishImplementation(missing)).rejects.toThrow();
	expect(existsSync(join(f.dir, ".worktrees", "2"))).toBe(false);
	const launched = await f.host.launchImplementation({
		...f.target,
		approvedDesignVersion: version,
	});
	expect(f.prompts).toHaveLength(0);
	expect(existsSync(join(f.dir, "issue-sessions"))).toBe(false);
	const workspace = listWorkspaceRecords("one").find((w) => w.id === launched.workspaceId);
	expect(workspace).toBeDefined();
	if (!workspace) throw new Error("missing workspace");
	const publication = await f.host.publishImplementation({
		...f.target,
		approvedDesignVersion: version,
	});
	expect(publication?.version).toBe(
		implementationVersion(git(workspace.worktreePath, "rev-parse", "HEAD"), version),
	);
	f.approve("tomato::implementation-approved");
	expect((await f.host.validateImplementation(f.target))?.approved).toBe(true);
	git(
		workspace.worktreePath,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"--allow-empty",
		"-m",
		"changed",
	);
	expect((await f.host.validateImplementation(f.target))?.approved).toBe(false);
}, 60000);
for (const boundary of ["before release", "after unlink"] as const)
	test(`capability change ${boundary} respects the durable launch commit point`, async () => {
		const f = fixture();
		await f.host.connect({ projectId: "one", input: f.input });
		const workspaceDir = join(f.dir, "issue-workspaces");
		const realOpen = fs.openSync;
		const realUnlink = fs.unlinkSync;
		let finalSaveFlushes = 0;
		let changed = false;
		const change = () => {
			changed = true;
			setProjectTrust("one", false);
		};
		// The final association is saved before its own directory flush and the release flush.
		// Observe the real filesystem boundary, without replacing the adapter/coordinator.
		const open = spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
			if (boundary === "before release" && String(path) === workspaceDir) {
				const saved = readdirSync(workspaceDir).find((name) => name.endsWith(".json"));
				if (
					saved &&
					JSON.parse(readFileSync(join(workspaceDir, saved), "utf8")).design?.sessionId
				) {
					if (++finalSaveFlushes === 2) change();
				}
			}
			return realOpen(path, flags, mode);
		});
		const unlink = spyOn(fs, "unlinkSync").mockImplementation((path) => {
			realUnlink(path);
			if (boundary === "after unlink" && String(path).endsWith(".lock")) change();
		});
		let result: Awaited<ReturnType<typeof f.host.launchDesign>> | undefined;
		try {
			const launch = f.host.launchDesign(f.target);
			if (boundary === "before release") await expect(launch).rejects.toThrow("reconciliation");
			else result = await launch;
		} finally {
			open.mockRestore();
			unlink.mockRestore();
			setProjectTrust("one", true);
		}
		expect(changed).toBe(true);
		expect(f.created).toBe(1);
		const saved = readdirSync(workspaceDir).find((name) => name.endsWith(".json"));
		expect(saved).toBeDefined();
		if (!saved) throw new Error("missing association");
		const association = JSON.parse(readFileSync(join(workspaceDir, saved), "utf8")).design;
		expect(association.sessionId).toBe("session-1");
		expect(readdirSync(workspaceDir).filter((name) => name.endsWith(".lock"))).toHaveLength(
			boundary === "before release" ? 1 : 0,
		);
		if (boundary === "before release")
			await expect(f.host.launchDesign(f.target)).rejects.toThrow("reconciliation");
		else {
			if (!result) throw new Error("missing committed launch result");
			expect(result).toEqual(association);
			expect(await f.host.launchDesign(f.target)).toEqual(result);
		}
		expect(f.created).toBe(1);
	});

test("app approval writes the actor's remote label record and is idempotent", async () => {
	const f = fixture();
	await f.host.connect({ projectId: "one", input: f.input });
	await f.host.publishDesign({
		...f.target,
		expectedDescription: "old",
		newDescription: "new design",
	});
	const approved = await f.host.approveDesign(f.target);
	expect(approved).toEqual({ approved: true, eventId: 1, userId: 8 });
	expect(f.issue.labels).toContain("tomato::design-approved");
	expect(f.issue.labels).toContain("type::bug");
	expect(f.events.filter((event) => event.label.name === "tomato::design-approved")).toEqual([
		expect.objectContaining({ action: "add", user: { id: 8 } }),
	]);
	const events = f.events.length;
	const labels = [...f.issue.labels];
	expect(await f.host.approveDesign(f.target)).toEqual(approved);
	expect(f.events).toHaveLength(events);
	expect(f.issue.labels).toEqual(labels);
	// Approval in ThinkRail is a label record, not a submission: no note or merge side effect.
	expect(f.issue.description).toBe("new design");
});

test("an in-progress issue starts implementation with no label write and no design receipt", async () => {
	const f = fixture();
	await f.host.connect({ projectId: "one", input: f.input });
	f.relabel(["workflow::in-progress", "type::bug"]);
	const updatedAt = f.issue.updated_at;
	const events = f.events.length;
	const launch = await f.host.startImplementation(f.target);
	expect(f.issue.updated_at).toBe(updatedAt);
	expect(f.events).toHaveLength(events);
	expect(f.created).toBe(1);
	expect(listWorkspaceRecords("one").find((w) => w.id === launch.workspaceId)).toBeDefined();
}, 60000);
test("implementation starts without approval or label writes and reuses the issue-prefixed workspace", async () => {
	const f = fixture();
	await f.host.connect({ projectId: "one", input: f.input });
	const before = structuredClone(f.issue);
	const first = await f.host.startImplementation(f.target);
	const workspace = listWorkspaceRecords("one").find((w) => w.id === first.workspaceId);
	expect(workspace?.worktreePath).toBe(join(f.dir, ".worktrees", "issue-1"));
	expect(workspace?.name).toBe("issue-1");
	expect(f.issue).toEqual(before);
	expect(f.events).toEqual([]);
	expect(await f.host.startImplementation(f.target)).toEqual(first);
	expect(f.created).toBe(1);
	const design = await f.host.beginDesign({ ...f.target, locale: "en" });
	expect(design.workspaceId).not.toBe(first.workspaceId);
	expect(await f.host.startImplementation(f.target)).toEqual(first);
	expect(f.created).toBe(2);
	expect(f.issue).toEqual(before);
	expect(
		existsSync(join(f.dir, "issue-workflow")) &&
			readdirSync(join(f.dir, "issue-workflow")).length > 0,
	).toBe(false);
}, 60000);
test("bound tools read fresh complete context and durably deduplicate caller operations", async () => {
	const f = fixture();
	await f.host.connect({ projectId: "one", input: f.input });
	const launched = await f.host.beginDesign({ ...f.target, locale: "en" });
	f.issue.description = "fresh description";
	f.notes.push({ id: 1, body: "fresh note", created_at: "2026-01-01T00:00:00Z" });
	const context = await f.host.agentSessions.context(launched.sessionId);
	expect(context).toContain("fresh description");
	expect(context).toContain("fresh note");
	expect(context).not.toContain(f.input.token);
	const receipt = await f.host.agentSessions.recordSummary(
		launched.sessionId,
		"turn:1.summary",
		"Verified result",
	);
	expect(receipt.noteId).toBe(2);
	const restored = createIssuesHost(f.options);
	expect(
		await restored.agentSessions.recordSummary(
			launched.sessionId,
			"turn:1.summary",
			"Verified result",
		),
	).toEqual(receipt);
	expect(f.notes).toHaveLength(2);
	await expect(
		restored.agentSessions.recordSummary(launched.sessionId, "turn:1.summary", "Changed"),
	).rejects.toThrow("reconciliation");
	await expect(restored.agentSessions.context("unbound")).rejects.toThrow();
	await expect(
		restored.agentSessions.recordSummary(launched.sessionId, "new", "界".repeat(11000)),
	).rejects.toThrow();
	setProjectTrust("one", false);
	await expect(restored.agentSessions.context(launched.sessionId)).rejects.toThrow();
});

test("uncertain initial dispatch leaves a durable fence and never dispatches again", async () => {
	const f = fixture();
	let attempts = 0;
	const host = createIssuesHost({
		...f.options,
		start: async () => {
			attempts++;
			throw new Error("not accepted");
		},
	});
	await host.connect({ projectId: "one", input: f.input });
	await expect(host.beginDesign({ ...f.target, locale: "en" })).rejects.toThrow();
	await expect(
		createIssuesHost(f.options).beginDesign({ ...f.target, locale: "en" }),
	).rejects.toThrow("reconciliation");
	expect(attempts).toBe(1);
	expect(f.created).toBe(1);
	expect(f.prompts).toHaveLength(0);
});

for (const stage of ["design", "implementation"] as const) {
	test(`new ${stage} begins once, restores only open, and uses the request locale`, async () => {
		const f = fixture();
		await f.host.connect({ projectId: "one", input: f.input });
		const begin = stage === "design" ? f.host.beginDesign : f.host.beginImplementation;
		const first = await begin({ ...f.target, locale: "zh-CN" });
		expect(f.createdTitles).toEqual(["Task"]);
		f.issue.title = "Changed";
		expect(f.prompts).toHaveLength(1);
		expect(f.prompts[0]?.prompt).toContain("zh-CN");
		const restored = createIssuesHost(f.options);
		expect(
			await (stage === "design" ? restored.beginDesign : restored.beginImplementation)({
				...f.target,
				locale: "en",
			}),
		).toEqual(first);
		expect(f.prompts).toHaveLength(1);
		expect(f.created).toBe(1);
		expect(f.createdTitles).toEqual(["Task"]);
	}, 60000);
	test(`new ${stage} reopens legacy empty sessions without association or sends`, async () => {
		const f = fixture();
		await f.host.connect({ projectId: "one", input: f.input });
		const first = await (stage === "design" ? f.host.launchDesign : f.host.startImplementation)(
			f.target,
		);
		expect(f.prompts).toHaveLength(0);
		expect(existsSync(join(f.dir, "issue-sessions"))).toBe(false);
		const restored = createIssuesHost(f.options);
		expect(
			await (stage === "design" ? restored.beginDesign : restored.beginImplementation)({
				...f.target,
				locale: "en",
			}),
		).toEqual(first);
		expect(f.prompts).toHaveLength(0);
		await expect(restored.agentSessions.context(first.sessionId)).rejects.toThrow();
	}, 60000);
	test(`new ${stage} context failure precedes any workspace or session creation`, async () => {
		const f = fixture();
		await f.host.connect({ projectId: "one", input: f.input });
		let reads = 0;
		f.onRead = () => {
			// Title, prompt issue, then complete notes: fail on notes, not the first read.
			if (++reads === 3) throw new Error("context unavailable");
		};
		await expect(
			(stage === "design" ? f.host.beginDesign : f.host.beginImplementation)({
				...f.target,
				locale: "en",
			}),
		).rejects.toThrow();
		expect(f.created).toBe(0);
		expect(listWorkspaceRecords("one")).toEqual([]);
		expect(existsSync(join(f.dir, ".worktrees"))).toBe(false);
	}, 60000);
}

test("new begin requests require exact references and an explicit effective locale", async () => {
	const f = fixture();
	for (const begin of [f.host.beginDesign, f.host.beginImplementation]) {
		for (const input of [
			f.target,
			{ ...f.target, locale: "system" },
			{ ...f.target, locale: "en", token: "secret" },
			{ ...f.target, locale: "en", reference: { ...f.target.reference, extra: true } },
		])
			await expect(begin(input)).rejects.toThrow("Invalid Issue request");
	}
	expect(f.requests).toBe(0);
	expect(f.created).toBe(0);
});

for (const stage of ["design", "implementation"] as const)
	test(`busy ${stage} reopen sends nothing and creates no replacement`, async () => {
		const f = fixture();
		await f.host.connect({ projectId: "one", input: f.input });
		await (stage === "design" ? f.host.beginDesign : f.host.beginImplementation)({
			...f.target,
			locale: "en",
		});
		const restored = createIssuesHost({
			...f.options,
			sessions: { ...f.options.sessions, status: async () => "busy" as const },
		});
		await expect(
			(stage === "design" ? restored.beginDesign : restored.beginImplementation)({
				...f.target,
				locale: "en",
			}),
		).rejects.toThrow();
		expect(f.prompts).toHaveLength(1);
		expect(f.created).toBe(1);
	}, 60000);
