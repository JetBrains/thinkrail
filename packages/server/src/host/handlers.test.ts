import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
	ReviewSendResult,
	SessionModelSelection,
	Template,
	TemplateInfo,
	WireModel,
	Workspace,
	WorkspaceWatchReadyResult,
} from "@thinkrail/contracts";
import { TodoStore } from "pi-todos/core";
import { configurePiRuntime, disposeAllSessions, setSessionManagerFactory } from "../agent";
import { recordAcceptedMessage, resetFeedbackForTests, setFeedbackPublisher } from "../feedback";
import { addComment, getReviewSnapshot } from "../reviews";
import { resetConfigCache } from "../settings";
import { todoReviewRecord } from "../todos";
import { stopAllWatches } from "../watch";
import { setWorkspaceModelPreference } from "../workspaces";
import { handleRequest, requestMethodDiagnostic, shouldRefreshOpenReview } from "./handlers";

const CTX = { clientKey: "test-client" };

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
const savedOffline = process.env.PI_OFFLINE;

function modelDef(id: string, reasoning: boolean) {
	return {
		id,
		name: id,
		reasoning,
		...(reasoning ? { thinkingLevelMap: { xhigh: "xhigh" } } : {}),
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
}

const faux = createFauxCore({
	provider: "handler-faux",
	api: "handler-faux",
	models: [modelDef("handler-reasoner", true), modelDef("handler-basic", false)],
	tokensPerSecond: 2_000,
});

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function gitText(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
	return new TextDecoder().decode(result.stdout).trim();
}

async function availableModels(): Promise<WireModel[]> {
	return (await handleRequest("model.list", {}, CTX)) as WireModel[];
}

async function createManagedWorkspace(): Promise<Workspace> {
	return (await handleRequest("workspace.create", { projectId: "p1" }, CTX)) as Workspace;
}

async function storedWorkspace(id: string): Promise<Workspace> {
	const rows = (await handleRequest(
		"workspace.list",
		{ projectId: "p1", includeDiffStats: false },
		CTX,
	)) as Workspace[];
	const workspace = rows.find((row) => row.id === id);
	if (!workspace) throw new Error(`missing workspace ${id}`);
	return workspace;
}

async function addDraftReview(workspaceId: string) {
	return addComment({ workspaceId, kind: "review", anchor: null, body: "Please revise this." });
}

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-handlers-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.PI_CODING_AGENT_DIR = join(dataDir, "agent");
	process.env.PI_OFFLINE = "1";
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("handler-faux", {
		api: faux.api,
		baseUrl: "http://handler-faux.test",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [
			{ ...modelDef("handler-reasoner", true), api: faux.api },
			{ ...modelDef("handler-basic", false), api: faux.api },
		],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory(() => SessionManager.inMemory());
	resetConfigCache();
	resetFeedbackForTests();
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	stopAllWatches();
	disposeAllSessions();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	resetConfigCache();
	resetFeedbackForTests();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	if (savedOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = savedOffline;
});

test("open-review cache reuse is opt-in so older clients remain fresh", () => {
	expect(shouldRefreshOpenReview(undefined)).toBe(true);
	expect(shouldRefreshOpenReview(false)).toBe(true);
	expect(shouldRefreshOpenReview(true)).toBe(false);
});

test("request diagnostics expose only registered method names", async () => {
	expect(requestMethodDiagnostic("workspace.list")).toBe("workspace.list");
	expect(requestMethodDiagnostic("secret prompt value")).toBe("unknown method");
	expect(requestMethodDiagnostic("toString")).toBe("unknown method");
	await expect(handleRequest("toString", undefined, CTX)).rejects.toThrow("Unknown method");
});

test("template reads resolve a project's current checkout and reject ambiguous locations", async () => {
	const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = join(dataDir, "agent");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const globalDir = join(agentDir, "prompts");
		const projectDir = join(repo, ".pi", "prompts");
		mkdirSync(globalDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(globalDir, "kickoff.md"), "global body");
		writeFileSync(join(projectDir, "kickoff.md"), "project body");

		const listed = (await handleRequest("template.list", { projectId: "p1" }, CTX)) as {
			templates: TemplateInfo[];
		};
		expect(listed.templates).toContainEqual(
			expect.objectContaining({ name: "kickoff", scope: "project" }),
		);

		const template = (await handleRequest(
			"template.get",
			{ projectId: "p1", name: "kickoff" },
			CTX,
		)) as Template;
		expect(template).toMatchObject({ scope: "project", content: "project body" });

		await expect(
			handleRequest("template.list", { workspaceId: "unused", projectId: "p1" }, CTX),
		).rejects.toThrow("either workspaceId or projectId");
	} finally {
		if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	}
});

test("disabled JetBrains quota returns hidden through its handler", async () => {
	await handleRequest("settings.update", { config: { jbcentralQuotaEnabled: false } }, CTX);
	expect(await handleRequest("provider.jbcentralQuota", { force: true }, CTX)).toEqual({
		state: "hidden",
	});
});

test("feedback.respond persists a popup action through the handler", async () => {
	setFeedbackPublisher(() => true);
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage(CTX.clientKey);

	expect(await handleRequest("feedback.respond", { action: "postpone" }, CTX)).toEqual({
		ok: true,
	});
	expect(JSON.parse(readFileSync(join(dataDir, "feedback.json"), "utf8"))).toEqual({
		acceptedMessages: 10,
		nextInvitationAt: 20,
		dismissed: false,
	});
});

test("feedback.respond rejects an action outside the wire union", async () => {
	await expect(handleRequest("feedback.respond", { action: "later" }, CTX)).rejects.toThrow(
		"Invalid interview response",
	);
});

test("workspace.rename locks the display name without changing Git or the worktree path", async () => {
	const created = (await handleRequest("workspace.create", { projectId: "p1" }, CTX)) as Workspace;

	const renamed = (await handleRequest(
		"workspace.rename",
		{ id: created.id, name: "Manual Workspace Name" },
		CTX,
	)) as Workspace;

	expect(renamed).toMatchObject({
		id: created.id,
		name: "Manual Workspace Name",
		branch: created.branch,
		renamed: true,
		worktreePath: created.worktreePath,
	});
	expect(gitText(created.worktreePath, "symbolic-ref", "--short", "HEAD")).toBe(created.branch);
	const listed = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	expect(listed.find((workspace) => workspace.id === created.id)).toMatchObject(renamed);
});

test("workspace.setSubagentsOverride persists on/off and null restores the global default", async () => {
	const created = (await handleRequest("workspace.create", { projectId: "p1" }, CTX)) as Workspace;

	const enabled = (await handleRequest(
		"workspace.setSubagentsOverride",
		{ id: created.id, override: "on" },
		CTX,
	)) as Workspace;
	expect(enabled.subagentsOverride).toBe("on");

	const disabled = (await handleRequest(
		"workspace.setSubagentsOverride",
		{ id: created.id, override: "off" },
		CTX,
	)) as Workspace;
	expect(disabled.subagentsOverride).toBe("off");

	const inherited = (await handleRequest(
		"workspace.setSubagentsOverride",
		{ id: created.id, override: null },
		CTX,
	)) as Workspace;
	expect(inherited.subagentsOverride).toBeUndefined();
});

test("session.create persists a successful explicit effective selection", async () => {
	const workspace = await createManagedWorkspace();
	const reasoner = (await availableModels()).find((model) => model.id === "handler-reasoner");
	if (!reasoner) throw new Error("reasoning model missing");

	const created = (await handleRequest(
		"session.create",
		{ workspaceId: workspace.id, model: reasoner, thinkingLevel: "xhigh" },
		CTX,
	)) as { sessionId: string; model: WireModel | null; thinkingLevel: string };

	expect(created).toMatchObject({ model: reasoner, thinkingLevel: "xhigh" });
	expect(await storedWorkspace(workspace.id)).toMatchObject({
		model: reasoner,
		thinkingLevel: "xhigh",
	});
});

test("session.create uses a complete workspace pair when the request omits a model", async () => {
	const workspace = await createManagedWorkspace();
	const reasoner = (await availableModels()).find((model) => model.id === "handler-reasoner");
	if (!reasoner) throw new Error("reasoning model missing");
	setWorkspaceModelPreference(workspace.id, { model: reasoner, thinkingLevel: "xhigh" });

	const created = (await handleRequest("session.create", { workspaceId: workspace.id }, CTX)) as {
		model: WireModel | null;
		thinkingLevel: string;
	};

	expect(created).toMatchObject({ model: reasoner, thinkingLevel: "xhigh" });
});

test("a partial persisted workspace pair is ignored in favor of the host default", async () => {
	const baselineWorkspace = await createManagedWorkspace();
	const partialWorkspace = await createManagedWorkspace();
	const basic = (await availableModels()).find((model) => model.id === "handler-basic");
	if (!basic) throw new Error("basic model missing");
	const baseline = (await handleRequest(
		"session.create",
		{ workspaceId: baselineWorkspace.id },
		CTX,
	)) as SessionModelSelection;
	const path = join(dataDir, "workspaces.json");
	const records = JSON.parse(readFileSync(path, "utf8")) as Workspace[];
	const partial = records.find((workspace) => workspace.id === partialWorkspace.id);
	if (!partial) throw new Error("partial workspace missing");
	partial.model = basic;
	delete partial.thinkingLevel;
	writeFileSync(path, JSON.stringify(records));

	const created = (await handleRequest(
		"session.create",
		{ workspaceId: partialWorkspace.id },
		CTX,
	)) as SessionModelSelection;

	expect(created).toMatchObject({
		model: baseline.model,
		thinkingLevel: baseline.thinkingLevel,
	});
	expect(await storedWorkspace(partialWorkspace.id)).toMatchObject({ model: basic });
	expect((await storedWorkspace(partialWorkspace.id)).thinkingLevel).toBeUndefined();
});

test("a stale workspace model falls back without rewriting the stored pair", async () => {
	const workspace = await createManagedWorkspace();
	const reasoner = (await availableModels()).find((model) => model.id === "handler-reasoner");
	if (!reasoner) throw new Error("reasoning model missing");
	const stale = { ...reasoner, provider: "gone", id: "gone" };
	setWorkspaceModelPreference(workspace.id, { model: stale, thinkingLevel: "xhigh" });

	const created = (await handleRequest("session.create", { workspaceId: workspace.id }, CTX)) as {
		model: WireModel | null;
		thinkingLevel: string;
	};

	expect(created.model).not.toMatchObject({ provider: "gone", id: "gone" });
	expect(await storedWorkspace(workspace.id)).toMatchObject({
		model: stale,
		thinkingLevel: "xhigh",
	});
});

test("an explicit unavailable model fails loudly and leaves workspace persistence unchanged", async () => {
	const workspace = await createManagedWorkspace();
	const reasoner = (await availableModels()).find((model) => model.id === "handler-reasoner");
	if (!reasoner) throw new Error("reasoning model missing");
	setWorkspaceModelPreference(workspace.id, { model: reasoner, thinkingLevel: "low" });

	await expect(
		handleRequest(
			"session.create",
			{
				workspaceId: workspace.id,
				model: { ...reasoner, provider: "gone", id: "gone" },
				thinkingLevel: "xhigh",
			},
			CTX,
		),
	).rejects.toThrow("Unknown or unavailable model");
	expect(await storedWorkspace(workspace.id)).toMatchObject({
		model: reasoner,
		thinkingLevel: "low",
	});
});

test("live selectors persist and return Pi's effective pair", async () => {
	const workspace = await createManagedWorkspace();
	const models = await availableModels();
	const reasoner = models.find((model) => model.id === "handler-reasoner");
	const basic = models.find((model) => model.id === "handler-basic");
	if (!reasoner || !basic) throw new Error("handler models missing");
	const created = (await handleRequest(
		"session.create",
		{ workspaceId: workspace.id, model: reasoner, thinkingLevel: "low" },
		CTX,
	)) as { sessionId: string };

	const thinking = (await handleRequest(
		"session.setThinkingLevel",
		{ sessionId: created.sessionId, level: "xhigh" },
		CTX,
	)) as SessionModelSelection;
	expect(thinking).toEqual({ model: reasoner, thinkingLevel: "xhigh" });
	expect(await storedWorkspace(workspace.id)).toMatchObject(thinking);

	const switched = (await handleRequest(
		"session.setModel",
		{ sessionId: created.sessionId, model: basic },
		CTX,
	)) as SessionModelSelection;
	expect(switched).toEqual({ model: basic, thinkingLevel: "off" });
	expect(await storedWorkspace(workspace.id)).toMatchObject(switched);
});

test("a failed live model mutation leaves the previous workspace pair unchanged", async () => {
	const workspace = await createManagedWorkspace();
	const reasoner = (await availableModels()).find((model) => model.id === "handler-reasoner");
	if (!reasoner) throw new Error("reasoning model missing");
	const created = (await handleRequest(
		"session.create",
		{ workspaceId: workspace.id, model: reasoner, thinkingLevel: "low" },
		CTX,
	)) as { sessionId: string };

	await expect(
		handleRequest(
			"session.setModel",
			{ sessionId: created.sessionId, model: { ...reasoner, provider: "gone", id: "gone" } },
			CTX,
		),
	).rejects.toThrow("Unknown or unavailable model");
	expect(await storedWorkspace(workspace.id)).toMatchObject({
		model: reasoner,
		thinkingLevel: "low",
	});
});

test("review comment chats inherit the complete workspace pair", async () => {
	const workspace = await createManagedWorkspace();
	const reasoner = (await availableModels()).find((model) => model.id === "handler-reasoner");
	if (!reasoner) throw new Error("reasoning model missing");
	setWorkspaceModelPreference(workspace.id, { model: reasoner, thinkingLevel: "xhigh" });
	const comment = await addDraftReview(workspace.id);

	const sent = (await handleRequest(
		"review.sendComment",
		{ workspaceId: workspace.id, id: comment.id },
		CTX,
	)) as ReviewSendResult;

	expect(sent).toMatchObject({ model: reasoner, thinkingLevel: "xhigh", reused: false });
	expect(await storedWorkspace(workspace.id)).toMatchObject({
		model: reasoner,
		thinkingLevel: "xhigh",
	});
});

test("an explicit review comment model persists its effective pair", async () => {
	const workspace = await createManagedWorkspace();
	const models = await availableModels();
	const reasoner = models.find((model) => model.id === "handler-reasoner");
	const basic = models.find((model) => model.id === "handler-basic");
	if (!reasoner || !basic) throw new Error("handler models missing");
	setWorkspaceModelPreference(workspace.id, { model: reasoner, thinkingLevel: "low" });
	const comment = await addDraftReview(workspace.id);

	const sent = (await handleRequest(
		"review.sendComment",
		{ workspaceId: workspace.id, id: comment.id, model: basic, thinkingLevel: "xhigh" },
		CTX,
	)) as ReviewSendResult;

	expect(sent).toMatchObject({ model: basic, thinkingLevel: "off", reused: false });
	expect(await storedWorkspace(workspace.id)).toMatchObject({
		model: basic,
		thinkingLevel: "off",
	});
});

test("workspace.watchReady waits for startup once, then reports an already-ready watcher", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const workspace = rows[0];
	if (!workspace) throw new Error("expected a workspace");

	const first = (await handleRequest(
		"workspace.watchReady",
		{ workspaceId: workspace.id },
		CTX,
	)) as WorkspaceWatchReadyResult;
	expect(first).toEqual({ startupNudge: true });
	const second = (await handleRequest(
		"workspace.watchReady",
		{ workspaceId: workspace.id },
		CTX,
	)) as WorkspaceWatchReadyResult;
	expect(second).toEqual({ startupNudge: false });
});

test("todo.requestFix on a chat that isn't on disk rolls the record back and never marks findings sent", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const workspace = rows[0];
	if (!workspace) throw new Error("expected a workspace");
	const sessionId = "sess-fix";
	const todo = new TodoStore(workspace.worktreePath, sessionId).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});
	const finding = await addComment({
		workspaceId: workspace.id,
		kind: "inline",
		author: "agent",
		anchor: {
			path: "README.md",
			side: "worktree",
			contentHash: "",
			selectors: [{ kind: "lineRange", startLine: 1, endLine: 1 }],
		},
		body: "finding",
		origin: { todoId: todo.id, sessionId, reviewedSha: "sha1" },
	});

	await expect(
		handleRequest(
			"todo.requestFix",
			{ workspaceId: workspace.id, sessionId, id: todo.id, feedback: "please fix" },
			CTX,
		),
	).rejects.toThrow("no longer on disk");

	expect(todoReviewRecord({ workspaceId: workspace.id, sessionId, id: todo.id })).toBeUndefined();
	const after = (await getReviewSnapshot(workspace.id)).comments.find((c) => c.id === finding.id);
	expect(after?.status).toBe("draft");
	expect(after?.sessionId).toBeUndefined();
});

test("workspace mutation handlers reject the Default before any side effect", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const def = rows[0];
	if (def?.kind !== "default")
		throw new Error("expected the ensured Default workspace pinned first");

	await expect(handleRequest("workspace.remove", { id: def.id }, CTX)).rejects.toThrow(
		"The Default workspace cannot be removed",
	);
	await expect(
		handleRequest("workspace.rename", { id: def.id, name: "Not Default" }, CTX),
	).rejects.toThrow("The Default workspace cannot be renamed");

	const after = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	expect(after.filter((w) => w.kind === "default")).toHaveLength(1);
	expect(after[0]?.id).toBe(def.id);
});
