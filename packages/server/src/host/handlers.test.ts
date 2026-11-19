import { afterEach, beforeEach, expect, onTestFinished, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
	AppConfig,
	Project,
	SubagentCatalogEntry,
	Template,
	TemplateInfo,
	WireModel,
	Workspace,
	WorkspaceArtifactsSnapshot,
	WorkspaceCreation,
	WorkspaceCreationRemoved,
	WorkspaceFsChangedPayload,
	WorkspacePathMatch,
	WorkspaceWatchReadyResult,
} from "@thinkrail/contracts";
import {
	BRANCH_STATUS_PROTOCOL_VERSION,
	INITIAL_TERMINAL_TAB_KEY,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
	WS_METHODS,
} from "@thinkrail/contracts";
import { TodoStore } from "pi-todos/core";
import {
	type CreateSessionResult,
	configurePiRuntime,
	disposeAllSessions,
	setSessionManagerFactory,
} from "../agent";
import { initializeAnalytics, resetAnalyticsForTests, shutdownAnalytics } from "../analytics";
import { reconcileArtifacts } from "../artifacts";
import { serverExtensions } from "../extensions";
import {
	configureSurveySource,
	recordAcceptedMessage,
	resetFeedbackForTests,
	resetSurveyForTests,
	setFeedbackPublisher,
} from "../feedback";
import { defaultSessionDirFor, writeFixtureSession } from "../history/testFixtures";
import { addComment, getReviewSnapshot } from "../reviews";
import { getConfig, resetConfigCache, setSettingsPublisher, updateConfig } from "../settings";
import { listTerminals } from "../terminal";
import { todoReviewRecord } from "../todos";
import { setTrashImplementationForTests } from "../trash";
import { setWatchPublisher, stopAllWatches } from "../watch";
import {
	awaitWorkspaceCreation,
	getWorkspace,
	setWorkspaceCreationHandoff,
	setWorkspaceCreationPublisher,
	setWorkspaceReview,
} from "../workspaces";
import {
	handleRequest,
	openReviewForClient,
	releaseDisabledExtensionQueries,
	requestMethodDiagnostic,
	shouldRefreshOpenReview,
	workspaceCreationHandoff,
} from "./handlers";

const CTX = { clientKey: "test-client" };

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const savedTestAgentDir = process.env.PI_CODING_AGENT_DIR;

let handlerFaux: ReturnType<typeof createFauxCore> | null = null;

async function setupDefaultModelRuntime(): Promise<() => void> {
	const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = join(dataDir, "agent");
	mkdirSync(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	const model = {
		id: "handler-model",
		name: "Handler model",
		api: "faux",
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4_096,
	};
	const faux = createFauxCore({ provider: "handler", api: "faux", models: [model] });
	handlerFaux = faux;
	runtime.registerProvider("handler", {
		api: "faux",
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [model],
	});
	configurePiRuntime(runtime);
	return () => {
		configurePiRuntime(null);
		if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	};
}

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function gitText(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
	return new TextDecoder().decode(result.stdout).trim();
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-handlers-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.PI_CODING_AGENT_DIR = join(dataDir, "pi");
	resetConfigCache();
	resetFeedbackForTests();
	resetSurveyForTests();
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
	setWatchPublisher(null);
	setTrashImplementationForTests(undefined);
	resetConfigCache();
	resetFeedbackForTests();
	resetSurveyForTests();
	resetAnalyticsForTests();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	if (savedTestAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedTestAgentDir;
});

test("every contract method has a registered handler", () => {
	const unregistered = Object.values(WS_METHODS).filter((m) => requestMethodDiagnostic(m) !== m);
	expect(unregistered).toEqual([]);
});

test("file mutation handlers invalidate watcher-ignored paths after success", async () => {
	const directory = join(repo, "node_modules", "demo");
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "source.txt"), "content");
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				name: "Default",
				worktreePath: repo,
				createdAt: 1,
			},
		]),
	);
	const frames: WorkspaceFsChangedPayload[] = [];
	setWatchPublisher((payload) => frames.push(payload));
	setTrashImplementationForTests(async (input) => {
		if (typeof input !== "string") throw new Error("expected one path");
		rmSync(input, { recursive: true });
	});

	expect(
		await handleRequest(
			"fs.copy",
			{
				sourceWorkspaceId: "w1",
				sourcePath: "node_modules/demo/source.txt",
				destinationWorkspaceId: "w1",
				destinationDirectory: "node_modules/demo",
			},
			CTX,
		),
	).toEqual({ path: "node_modules/demo/source copy.txt" });
	expect(
		await handleRequest(
			"fs.delete",
			{ workspaceId: "w1", path: "node_modules/demo/source copy.txt" },
			CTX,
		),
	).toEqual({ ok: true });
	expect(
		await handleRequest("fs.delete", { workspaceId: "w1", path: "node_modules/demo" }, CTX),
	).toEqual({ ok: true });
	expect(frames.filter((frame) => frame.paths.length > 0)).toEqual([
		{
			workspaceId: "w1",
			paths: ["node_modules/demo/source copy.txt"],
			truncated: false,
			skillChange: "unknown",
		},
		{
			workspaceId: "w1",
			paths: ["node_modules/demo/source copy.txt"],
			truncated: false,
			skillChange: "unknown",
		},
		{ workspaceId: "w1", paths: ["node_modules/demo"], truncated: false, skillChange: "unknown" },
	]);
	expect(existsSync(directory)).toBe(false);
});

test("user file mutations keep the artifact index honest", async () => {
	const context = join(repo, ".thinkrail", "context");
	mkdirSync(join(context, "mockups"), { recursive: true });
	writeFileSync(join(context, "a.md"), "a");
	writeFileSync(join(context, "b.md"), "b");
	writeFileSync(join(context, "c.md"), "c");
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([{ id: "wa", projectId: "p1", name: "a", worktreePath: repo, createdAt: 1 }]),
	);
	setTrashImplementationForTests(async (input) => {
		if (typeof input !== "string") throw new Error("expected one path");
		reconcileArtifacts("wa");
		rmSync(input, { recursive: true });
	});
	const list = async () =>
		(
			(await handleRequest(
				"artifacts.list",
				{ workspaceId: "wa" },
				CTX,
			)) as WorkspaceArtifactsSnapshot
		).artifacts
			.map((artifact) => `${artifact.state} ${artifact.path}`)
			.sort();
	expect(await list()).toEqual([
		"live .thinkrail/context/a.md",
		"live .thinkrail/context/b.md",
		"live .thinkrail/context/c.md",
	]);

	await handleRequest("fs.delete", { workspaceId: "wa", path: ".thinkrail/context/a.md" }, CTX);
	expect(
		await handleRequest(
			"fs.rename",
			{ workspaceId: "wa", path: ".thinkrail/context/b.md", name: "renamed.md" },
			CTX,
		),
	).toEqual({ path: ".thinkrail/context/renamed.md" });
	expect(
		await handleRequest(
			"fs.move",
			{
				sourceWorkspaceId: "wa",
				sourcePath: ".thinkrail/context/c.md",
				destinationWorkspaceId: "wa",
				destinationDirectory: ".",
			},
			CTX,
		),
	).toEqual({ path: "c.md" });
	expect(await list()).toEqual(["live .thinkrail/context/renamed.md"]);

	rmSync(join(context, "renamed.md"));
	expect(await list()).toEqual(["deleted .thinkrail/context/renamed.md"]);
	await handleRequest(
		"artifacts.restore",
		{ workspaceId: "wa", path: ".thinkrail/context/renamed.md" },
		CTX,
	);
	expect(readFileSync(join(context, "renamed.md"), "utf8")).toBe("b");
	rmSync(join(context, "renamed.md"));
	await list();
	await handleRequest(
		"artifacts.discard",
		{ workspaceId: "wa", path: ".thinkrail/context/renamed.md" },
		CTX,
	);
	expect(await list()).toEqual([]);
});

test("a paste into the artifacts folder seeds it first when it does not exist yet", async () => {
	writeFileSync(join(repo, "notes.md"), "notes\n");
	writeFileSync(join(repo, "todo.md"), "todo\n");
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([{ id: "wa", projectId: "p1", name: "a", worktreePath: repo, createdAt: 1 }]),
	);
	expect(existsSync(join(repo, ".thinkrail"))).toBe(false);
	expect(
		await handleRequest(
			"fs.copy",
			{
				sourceWorkspaceId: "wa",
				sourcePath: "notes.md",
				destinationWorkspaceId: "wa",
				destinationDirectory: ".thinkrail/context",
			},
			CTX,
		),
	).toEqual({ path: ".thinkrail/context/notes.md" });
	expect(readFileSync(join(repo, ".thinkrail", "context", ".gitignore"), "utf8")).toBe("*\n");
	rmSync(join(repo, ".thinkrail"), { recursive: true });
	expect(
		await handleRequest(
			"fs.move",
			{
				sourceWorkspaceId: "wa",
				sourcePath: "todo.md",
				destinationWorkspaceId: "wa",
				destinationDirectory: ".thinkrail/context",
			},
			CTX,
		),
	).toEqual({ path: ".thinkrail/context/todo.md" });
	expect(readFileSync(join(repo, ".thinkrail", "context", ".gitignore"), "utf8")).toBe("*\n");
	expect(gitText(repo, "status", "--porcelain", "--untracked-files=all")).not.toContain(
		".thinkrail",
	);
});

test("clone handlers resolve the destination and return an opened local project", async () => {
	const input = {
		operationId: "clone-handler",
		url: pathToFileURL(repo).href,
		parentPath: dataDir,
		name: "cloned",
	};
	const destination = (await handleRequest("project.cloneDestination", input, CTX)) as {
		path: string;
	};
	const project = (await handleRequest("project.clone", input, CTX)) as Project;
	expect(project.path).toBe(destination.path);
	expect(gitText(project.path, "rev-parse", "HEAD")).toBe(gitText(repo, "rev-parse", "HEAD"));
	expect(
		await handleRequest("project.cancelClone", { operationId: input.operationId }, CTX),
	).toEqual({ ok: true });
});

test("open-review cache reuse is opt-in so older clients remain fresh", () => {
	expect(shouldRefreshOpenReview(undefined)).toBe(true);
	expect(shouldRefreshOpenReview(false)).toBe(true);
	expect(shouldRefreshOpenReview(true)).toBe(false);
});

test("a client older than the settled protocol never hears about a merged or closed review", () => {
	const merged = { kind: "pull-request", number: 9, state: "merged" } as const;
	const open = { kind: "pull-request", number: 10, state: "open" } as const;
	const stateless = { kind: "pull-request", number: 11 } as const;
	expect(openReviewForClient(merged, WORKSPACE_SETTLE_PROTOCOL_VERSION - 1)).toBeNull();
	expect(openReviewForClient(open, WORKSPACE_SETTLE_PROTOCOL_VERSION - 1)).toBe(open);
	expect(openReviewForClient(stateless, WORKSPACE_SETTLE_PROTOCOL_VERSION - 1)).toBe(stateless);
	expect(openReviewForClient(merged, WORKSPACE_SETTLE_PROTOCOL_VERSION)).toBe(merged);
	expect(openReviewForClient(merged, undefined)).toBe(merged);
	expect(openReviewForClient(null, WORKSPACE_SETTLE_PROTOCOL_VERSION - 1)).toBeNull();
});

test("starting a PR mutation reactivates a parked workspace before any network await", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "PR work" },
		CTX,
	)) as Workspace;
	await handleRequest("workspace.settle", { id: workspace.id }, CTX);

	await expect(
		handleRequest("pr.open", { workspaceId: workspace.id, sessionId: "missing" }, CTX),
	).rejects.toThrow("no 'origin' remote");
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const after = rows.find((row) => row.id === workspace.id);
	expect(after?.settledOverride).toBeUndefined();
	expect(after?.lastActiveAt ?? 0).toBeGreaterThanOrEqual(workspace.lastActiveAt ?? 0);
});

test("branch status reports a review-free branch, and workspace.push publishes it", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Ship segment" },
		CTX,
	)) as Workspace;
	writeFileSync(join(workspace.worktreePath, "ship.txt"), "ship\n");
	git(workspace.worktreePath, "add", "-A");
	git(workspace.worktreePath, "commit", "-m", "ship");
	writeFileSync(join(workspace.worktreePath, "dirty.txt"), "dirty\n");

	const local = await handleRequest("workspace.branchStatus", { workspaceId: workspace.id }, CTX);
	expect(local).toEqual({
		hasOrigin: false,
		provider: null,
		published: false,
		pushesElsewhere: false,
		aheadOfBase: 1,
		onBase: false,
		review: null,
	});

	const remote = join(dataDir, "origin.git");
	mkdirSync(remote);
	git(remote, "init", "--bare");
	git(repo, "remote", "add", "origin", remote);
	expect(
		await handleRequest(
			"workspace.push",
			{ workspaceId: workspace.id, branch: workspace.branch },
			CTX,
		),
	).toEqual({
		dirtyFiles: 1,
	});
	const published = await handleRequest(
		"workspace.branchStatus",
		{ workspaceId: workspace.id },
		CTX,
	);
	expect(published).toMatchObject({
		hasOrigin: true,
		provider: null,
		published: true,
		ahead: 0,
		behind: 0,
		aheadOfBase: 1,
		review: null,
	});
});

test("branch status measures the branch a managed workspace's terminal switched to", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Switched" },
		CTX,
	)) as Workspace;
	const remote = join(dataDir, "switched.git");
	mkdirSync(remote);
	git(remote, "init", "--bare");
	git(repo, "remote", "add", "origin", remote);
	await handleRequest(
		"workspace.push",
		{ workspaceId: workspace.id, branch: workspace.branch },
		CTX,
	);
	git(workspace.worktreePath, "switch", "-c", "feature/terminal");

	const rows = (await handleRequest(
		"workspace.list",
		{ projectId: "p1", includeDiffStats: false },
		CTX,
	)) as Workspace[];
	expect(rows.find((row) => row.id === workspace.id)).toMatchObject({
		branch: "feature/terminal",
	});
	expect(
		await handleRequest("workspace.branchStatus", { workspaceId: workspace.id }, CTX),
	).toMatchObject({ published: false, review: null });
});

test("a workspace on its base branch gets no review lookup and drops a stored foreign review", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "On base" },
		CTX,
	)) as Workspace;
	git(repo, "remote", "add", "origin", "https://github.com/fake-owner/fake-repo.git");
	const bin = join(dataDir, "bin");
	const ghCalls = join(dataDir, "gh-calls");
	mkdirSync(bin);
	writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(ghCalls)}\necho "[]"\n`);
	chmodSync(join(bin, "gh"), 0o755);
	const savedPath = process.env.PATH;
	process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
	onTestFinished(() => {
		process.env.PATH = savedPath;
	});
	git(repo, "switch", "-c", "elsewhere");
	git(workspace.worktreePath, "switch", "main");
	await handleRequest("workspace.list", { projectId: "p1", includeDiffStats: false }, CTX);
	setWorkspaceReview(
		workspace.id,
		{ kind: "pull-request", number: 501, state: "merged", url: "https://example.test/501" },
		"main",
	);

	expect(
		await handleRequest(
			"workspace.branchStatus",
			{ workspaceId: workspace.id, skipFetch: true },
			CTX,
		),
	).toMatchObject({ onBase: true, review: null });
	expect(getWorkspace(workspace.id)).toMatchObject({ branch: "main" });
	expect(getWorkspace(workspace.id).review).toBeUndefined();

	setWorkspaceReview(workspace.id, { kind: "pull-request", number: 501, state: "open" }, "main");
	expect(
		await handleRequest(
			"workspace.openReview",
			{ workspaceId: workspace.id, allowCached: true },
			CTX,
		),
	).toBeNull();
	expect(getWorkspace(workspace.id).review).toBeUndefined();
	expect(existsSync(ghCalls)).toBe(false);
});

test("a CI poll re-reads the review without fetching origin; a focus read still fetches", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Poll" },
		CTX,
	)) as Workspace;
	const remote = join(dataDir, "poll.git");
	mkdirSync(remote);
	git(remote, "init", "--bare");
	git(repo, "remote", "add", "origin", remote);
	await handleRequest(
		"workspace.push",
		{ workspaceId: workspace.id, branch: workspace.branch },
		CTX,
	);
	const other = join(dataDir, "poll-other");
	git(dataDir, "clone", "--branch", workspace.branch, remote, other);
	git(other, "config", "user.email", "t@thinkrail.test");
	git(other, "config", "user.name", "test");
	writeFileSync(join(other, "teammate.txt"), "teammate\n");
	git(other, "add", "-A");
	git(other, "commit", "-m", "teammate");
	git(other, "push", "origin", workspace.branch);

	expect(
		await handleRequest(
			"workspace.branchStatus",
			{ workspaceId: workspace.id, skipFetch: true },
			CTX,
		),
	).toMatchObject({ published: true, behind: 0 });
	expect(
		await handleRequest("workspace.branchStatus", { workspaceId: workspace.id }, CTX),
	).toMatchObject({ published: true, behind: 1 });
});

test("a split origin measures the branch against where it is pushed, not where it is fetched", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Split origin" },
		CTX,
	)) as Workspace;
	writeFileSync(join(workspace.worktreePath, "ship.txt"), "ship\n");
	git(workspace.worktreePath, "add", "-A");
	git(workspace.worktreePath, "commit", "-m", "ship");
	const fetchRepo = join(dataDir, "fetch.git");
	const pushRepo = join(dataDir, "push.git");
	for (const bare of [fetchRepo, pushRepo]) {
		mkdirSync(bare);
		git(bare, "init", "--bare");
	}
	git(repo, "remote", "add", "origin", fetchRepo);
	git(repo, "remote", "set-url", "--push", "origin", pushRepo);
	git(repo, "push", fetchRepo, "main");
	await handleRequest(
		"workspace.push",
		{ workspaceId: workspace.id, branch: workspace.branch },
		CTX,
	);

	const other = join(dataDir, "other");
	git(dataDir, "clone", fetchRepo, other);
	git(other, "config", "user.email", "t@thinkrail.test");
	git(other, "config", "user.name", "test");
	git(other, "switch", "-c", workspace.branch);
	writeFileSync(join(other, "unrelated.txt"), "unrelated\n");
	git(other, "add", "-A");
	git(other, "commit", "-m", "unrelated on the fetch side");
	git(other, "push", "origin", workspace.branch);
	git(workspace.worktreePath, "fetch", "origin");
	git(other, "push", "origin", "--delete", workspace.branch);

	expect(
		await handleRequest("workspace.branchStatus", { workspaceId: workspace.id }, CTX),
	).toMatchObject({ published: true, pushesElsewhere: true, ahead: 0, behind: 0 });

	const pushed = join(dataDir, "pushed");
	git(dataDir, "clone", "--branch", workspace.branch, pushRepo, pushed);
	git(pushed, "config", "user.email", "t@thinkrail.test");
	git(pushed, "config", "user.name", "test");
	writeFileSync(join(pushed, "later.txt"), "later\n");
	git(pushed, "add", "-A");
	git(pushed, "commit", "-m", "later on the push side");
	git(pushed, "push", "origin", workspace.branch);

	git(workspace.worktreePath, "fetch", "--prune", "origin");

	expect(
		await handleRequest(
			"workspace.branchStatus",
			{ workspaceId: workspace.id, allowCached: true },
			CTX,
		),
	).toMatchObject({ published: true, ahead: 0, behind: 1 });
});

test("a split origin whose push repository can't be read reports publication as unknown", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Unreachable push" },
		CTX,
	)) as Workspace;
	const fetchRepo = join(dataDir, "fetch-only.git");
	mkdirSync(fetchRepo);
	git(fetchRepo, "init", "--bare");
	git(repo, "remote", "add", "origin", fetchRepo);
	git(workspace.worktreePath, "push", fetchRepo, `HEAD:refs/heads/${workspace.branch}`);
	git(workspace.worktreePath, "fetch", "origin");
	git(repo, "remote", "set-url", "--push", "origin", join(dataDir, "missing.git"));

	const status = await handleRequest("workspace.branchStatus", { workspaceId: workspace.id }, CTX);
	expect(status).toMatchObject({ hasOrigin: true, pushesElsewhere: true, published: null });
	expect(status).not.toHaveProperty("ahead");
});

test("a pre-v87 client's source-less PR preview keeps the session's plan body", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Legacy preview" },
		CTX,
	)) as Workspace;
	writeFileSync(join(workspace.worktreePath, "ship.txt"), "ship\n");
	git(workspace.worktreePath, "add", "-A");
	git(workspace.worktreePath, "commit", "-m", "ship it");
	const params = { workspaceId: workspace.id, sessionId: "legacy-session" };

	const legacy = (await handleRequest("pr.preview", params, {
		...CTX,
		protocolVersion: BRANCH_STATUS_PROTOCOL_VERSION - 1,
	})) as { body: string };
	expect(legacy.body).toContain("## Committed outside the plan");
	const current = (await handleRequest("pr.preview", params, CTX)) as {
		body: string;
		source: string;
	};
	expect(current).toMatchObject({ source: "commits", body: "- ship it" });
});

test("request diagnostics expose only registered method names", async () => {
	expect(requestMethodDiagnostic("workspace.list")).toBe("workspace.list");
	expect(requestMethodDiagnostic("host.update")).toBe("host.update");
	expect(requestMethodDiagnostic("secret prompt value")).toBe("unknown method");
	expect(requestMethodDiagnostic("toString")).toBe("unknown method");
	await expect(handleRequest("toString", undefined, CTX)).rejects.toThrow("Unknown method");
});

test("host.update invokes only the context-injected parameterless operation", async () => {
	let runs = 0;
	expect(
		await handleRequest(
			"host.update",
			{ command: "private-command", version: "99.0.0" },
			{ clientKey: "test-client", runHostUpdate: () => runs++ },
		),
	).toEqual({ ok: true });
	expect(runs).toBe(1);
	await expect(handleRequest("host.update", {}, CTX)).rejects.toThrow(
		"Host update is unavailable.",
	);
});

test("retired session activity returns the empty compatibility snapshot", async () => {
	expect(await handleRequest("session.activityList", {}, CTX)).toEqual([]);
});

test("the retired ask answer method and respondToTool both refuse an unknown session the same way", async () => {
	await expect(
		handleRequest(
			"session.answerQuestion",
			{ sessionId: "nope", toolCallId: "tc", result: {} },
			CTX,
		),
	).rejects.toThrow("Unknown session: nope");
	await expect(
		handleRequest(
			"session.respondToTool",
			{ sessionId: "nope", toolCallId: "tc", response: {} },
			CTX,
		),
	).rejects.toThrow("Unknown session: nope");
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

test("a background create hands the finished workspace a terminal and the held chat", async () => {
	const cleanup = await setupDefaultModelRuntime();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd, { id: "kickoff-chat" }));
	const removed: WorkspaceCreationRemoved[] = [];
	setWorkspaceCreationPublisher((event) => {
		if (event.kind === "removed") removed.push(event.removed);
	});
	setWorkspaceCreationHandoff(workspaceCreationHandoff);
	try {
		const models = (await handleRequest("model.list", {}, CTX)) as WireModel[];
		const selected = models.find((model) => model.provider === "handler");
		if (!selected) throw new Error("handler test model was not available");
		handlerFaux?.setResponses([
			async () => {
				await Bun.sleep(4_000);
				return fauxAssistantMessage("done");
			},
		]);
		const started = Date.now();
		const creation = (await handleRequest(
			"workspace.startCreate",
			{ projectId: "p1", kickoff: { text: "Start here", model: selected } },
			CTX,
		)) as WorkspaceCreation;
		expect(creation).toMatchObject({ state: "running", kickoff: { text: "Start here" } });
		const workspace = await awaitWorkspaceCreation(creation.id);
		expect(Date.now() - started).toBeLessThan(3_000);

		expect(workspace.initialTerminalPending).toBeUndefined();
		expect(removed).toHaveLength(1);
		expect(removed[0]).toMatchObject({ id: creation.id, workspace: { id: creation.id } });
		expect(removed[0]?.sessionId).toEqual(expect.any(String));
		expect(await handleRequest("workspace.listCreations", {}, CTX)).toEqual([]);
	} finally {
		setWorkspaceCreationHandoff(null);
		setWorkspaceCreationPublisher(null);
		disposeAllSessions();
		configurePiRuntime(null);
		setSessionManagerFactory((cwd) => SessionManager.create(cwd));
		cleanup();
	}
});

test("model.default and new session creation share the AppConfig default resolution", async () => {
	const cleanup = await setupDefaultModelRuntime();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd, { id: "default-resolution" }));
	try {
		const models = (await handleRequest("model.list", {}, CTX)) as WireModel[];
		const selected = models.find((model) => model.provider === "handler");
		if (!selected) throw new Error("handler test model was not available");
		await handleRequest(
			"settings.update",
			{ config: { defaultModel: selected, defaultEffort: "high" } },
			CTX,
		);
		const resolved = (await handleRequest("model.default", {}, CTX)) as {
			model: WireModel | null;
			thinkingLevel: string;
		};
		expect(resolved).toEqual({ model: selected, thinkingLevel: "off" });

		const workspace = (await handleRequest(
			"workspace.create",
			{ projectId: "p1" },
			CTX,
		)) as Workspace;
		const created = (await handleRequest(
			"session.create",
			{ workspaceId: workspace.id },
			CTX,
		)) as CreateSessionResult;
		expect(created).toMatchObject({ model: selected, thinkingLevel: "off" });
	} finally {
		disposeAllSessions();
		configurePiRuntime(null);
		setSessionManagerFactory((cwd) => SessionManager.create(cwd));
		cleanup();
	}
});

test("settings.update merges extension settings per key and rejects a malformed value", async () => {
	await handleRequest(
		"settings.update",
		{ config: { extensionSettings: { "ask-user-question": { richPreviews: false } } } },
		CTX,
	);
	const config = (await handleRequest(
		"settings.update",
		{ config: { extensionSettings: { "ask-user-question": { other: true } } } },
		CTX,
	)) as AppConfig;
	expect(config.extensionSettings["ask-user-question"]).toEqual({
		richPreviews: false,
		other: true,
	});
	await expect(
		handleRequest(
			"settings.update",
			{ config: { extensionSettings: { "ask-user-question": { richPreviews: "no" } } } } as never,
			CTX,
		),
	).rejects.toThrow("extensionSettings must map extension names to boolean settings");
});

test("extension.list reflects disabledExtensions written through settings.update", async () => {
	expect(await handleRequest("extension.list", {}, CTX)).toEqual([
		{
			name: "visualize",
			title: "Visualize",
			description: expect.any(String),
			enabled: true,
			tools: ["visualize"],
			hasParentExtensions: true,
			hasChildExtensions: false,
		},
		{
			name: "ask-user-question",
			title: "Ask user question",
			description: expect.any(String),
			enabled: true,
			tools: ["ask_user_question"],
			hasParentExtensions: true,
			hasChildExtensions: false,
			settings: [{ key: "richPreviews", default: true }],
		},
		{
			name: "web-access",
			title: "Web access",
			description: expect.any(String),
			enabled: true,
			tools: ["web_search", "source_check", "fetch_content", "get_search_content", "web_enable"],
			hasParentExtensions: true,
			hasChildExtensions: true,
		},
		{
			name: "next-steps",
			title: "Next-step suggestions",
			description: expect.any(String),
			enabled: true,
			tools: ["suggest_next_steps"],
			hasParentExtensions: true,
			hasChildExtensions: false,
		},
		{
			name: "session-insights",
			title: "Session insights",
			description: expect.any(String),
			enabled: true,
			tools: [],
			hasParentExtensions: false,
			hasChildExtensions: false,
			apiVersion: serverExtensions.find((entry) => entry.extension.name === "session-insights")
				?.extension.apiVersion,
		},
		{
			name: "board",
			title: "Board",
			description: expect.any(String),
			enabled: true,
			tools: [
				"board_card_get",
				"board_cards_list",
				"board_card_create",
				"board_link",
				"board_card_note",
				"board_initiative_get",
				"board_initiative_create_draft",
				"board_project_create",
				"board_cards_create_batch",
				"board_initiative_activity",
				"board_initiative_move",
				"board_initiative_close",
				"board_update_draft",
			],
			hasParentExtensions: true,
			hasChildExtensions: false,
			apiVersion: serverExtensions.find((entry) => entry.extension.name === "board")?.extension
				.apiVersion,
		},
	]);
	await handleRequest(
		"settings.update",
		{ config: { disabledExtensions: ["visualize", "web-access", "retired"] } },
		CTX,
	);
	expect(await handleRequest("extension.list", {}, CTX)).toMatchObject([
		{ name: "visualize", enabled: false },
		{ name: "ask-user-question", enabled: true },
		{ name: "web-access", enabled: false },
		{ name: "next-steps", enabled: true },
		{ name: "session-insights", enabled: true },
		{ name: "board", enabled: true },
	]);
	await handleRequest("settings.update", { config: { disabledExtensions: [] } }, CTX);
	expect(await handleRequest("extension.list", {}, CTX)).toMatchObject([
		{ name: "visualize", enabled: true },
		{ name: "ask-user-question", enabled: true },
		{ name: "web-access", enabled: true },
		{ name: "next-steps", enabled: true },
		{ name: "session-insights", enabled: true },
		{ name: "board", enabled: true },
	]);
});

test("extension.query refuses unknown queries and a switched-off extension with their codes", async () => {
	await expect(
		handleRequest("extension.query", { extension: "retired", method: "rows" }, CTX),
	).rejects.toMatchObject({ code: "UNKNOWN_EXTENSION_QUERY" });
	await expect(
		handleRequest("extension.query", { extension: "visualize", method: "rows" }, CTX),
	).rejects.toMatchObject({ code: "UNKNOWN_EXTENSION_QUERY" });
	await expect(
		handleRequest("extension.query", { method: "rows" } as never, CTX),
	).rejects.toMatchObject({ code: "UNKNOWN_EXTENSION_QUERY" });
	await handleRequest("settings.update", { config: { disabledExtensions: ["visualize"] } }, CTX);
	await expect(
		handleRequest("extension.query", { extension: "visualize", method: "rows" }, CTX),
	).rejects.toMatchObject({ code: "EXTENSION_DISABLED" });
	await handleRequest("settings.update", { config: { disabledExtensions: [] } }, CTX);
	await expect(
		handleRequest("extension.query", { extension: "visualize", method: "rows" }, CTX),
	).rejects.toMatchObject({ code: "UNKNOWN_EXTENSION_QUERY" });
});

test("extension.query answers session insights' sessions.list over the host's sessions, and refuses it while off", async () => {
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{ id: "w1", projectId: "p1", name: "Default", worktreePath: repo, createdAt: 1 },
		]),
	);
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(dataDir, "pi");
	const at = Date.parse("2026-11-01T10:00:00.000Z");
	const fixture = writeFixtureSession(defaultSessionDirFor(agentDir, repo), {
		cwd: repo,
		name: "Insights fixture",
		messages: [
			{ role: "user", text: "List the sessions", timestamp: at },
			{ role: "assistant", text: "Done.", timestamp: at + 60_000 },
		],
	});
	const request = {
		extension: "session-insights",
		method: "sessions.list",
		params: { scope: { kind: "project", projectId: "p1" } },
	};
	type ListAnswer = {
		apiVersion: number;
		state: { phase: string };
		projects: unknown[];
		rows: {
			sessionId: string;
			workspaceId: string | null;
			workspaceState: string;
			title: string | null;
			live: boolean;
		}[];
	};
	let answer: ListAnswer | undefined;
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		answer = (await handleRequest("extension.query", request, CTX)) as ListAnswer;
		if (answer.state.phase === "ready" && answer.rows.length > 0) break;
		await Bun.sleep(100);
	}
	expect(answer?.apiVersion).toBe(
		serverExtensions.find((entry) => entry.extension.name === "session-insights")?.extension
			.apiVersion ?? -1,
	);
	expect(answer?.projects).toEqual([{ id: "p1", name: "repo", kind: "repository" }]);
	expect(answer?.rows).toMatchObject([
		{
			sessionId: fixture.id,
			workspaceId: "w1",
			workspaceState: "open",
			title: "Insights fixture",
			live: false,
		},
	]);
	await expect(
		handleRequest("extension.query", { ...request, params: { scope: { kind: "nope" } } }, CTX),
	).rejects.toThrow("Invalid sessions.list params");
	await handleRequest(
		"settings.update",
		{ config: { disabledExtensions: ["session-insights"] } },
		CTX,
	);
	await expect(handleRequest("extension.query", request, CTX)).rejects.toMatchObject({
		code: "EXTENSION_DISABLED",
	});
	releaseDisabledExtensionQueries();
	await handleRequest("settings.update", { config: { disabledExtensions: [] } }, CTX);
	let rebuilt: ListAnswer | undefined;
	while (Date.now() < deadline + 10_000) {
		rebuilt = (await handleRequest("extension.query", request, CTX)) as ListAnswer;
		if (rebuilt.state.phase === "ready" && rebuilt.rows.length > 0) break;
		await Bun.sleep(100);
	}
	expect(rebuilt?.rows.map((row) => row.sessionId)).toEqual([fixture.id]);
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
		submittedSurveyId: null,
		submittedIteration: null,
		lastInvitedAt: null,
		githubStarAsked: false,
	});
});

const SURVEY_SUBMISSION_ID = "00000000-0000-4000-8000-000000000001";

const remoteSurvey: { iteration: number | null; status: number } = { iteration: 0, status: 200 };

function launchSurvey(iteration = 0): void {
	remoteSurvey.iteration = iteration;
	remoteSurvey.status = 200;
	configureSurveySource({
		apiKey: "phc_test",
		fetchImpl: (() => {
			if (remoteSurvey.status !== 200) {
				return Promise.resolve(new Response("down", { status: remoteSurvey.status }));
			}
			const surveys =
				remoteSurvey.iteration === null
					? []
					: [
							{
								id: "survey-1",
								name: "in-app-feedback",
								start_date: "2026-10-28T00:00:00.000Z",
								current_iteration: remoteSurvey.iteration,
								questions: [{ id: "q1", type: "open", question: "How is it?" }],
							},
						];
			return Promise.resolve(new Response(JSON.stringify({ surveys }), { status: 200 }));
		}) as unknown as typeof fetch,
	});
}

function bootSurveyAnalytics(sent: string[], overrides: { mute?: boolean } = {}): void {
	initializeAnalytics({
		posthogApiKey: "phc_test",
		appVersion: "0.0.0-dev",
		channel: "dev",
		build: "source",
		additionalEnabled: false,
		env: {},
		...overrides,
		fetchImpl: ((_url: string, init?: RequestInit) => {
			if (typeof init?.body === "string") sent.push(init.body);
			return Promise.resolve(new Response("{}", { status: 200 }));
		}) as unknown as typeof fetch,
	});
}

function submitSurvey(overrides: Record<string, unknown> = {}) {
	return handleRequest(
		"feedback.survey.submit",
		{
			submissionId: SURVEY_SUBMISSION_ID,
			surveyId: "survey-1",
			iteration: 0,
			answers: { q1: "Good" },
			...overrides,
		},
		CTX,
	);
}

function storedFeedback(): Record<string, unknown> {
	return JSON.parse(readFileSync(join(dataDir, "feedback.json"), "utf8")) as Record<
		string,
		unknown
	>;
}

test("feedback.survey stays hidden until a launched survey exists and a sent answer hides it", async () => {
	expect(await handleRequest("feedback.survey", {}, CTX)).toEqual({ survey: null });
	await expect(submitSurvey()).rejects.toMatchObject({ code: "SURVEY_UNAVAILABLE" });

	const sent: string[] = [];
	bootSurveyAnalytics(sent, { mute: true });
	launchSurvey();
	expect(await handleRequest("feedback.survey", {}, CTX)).toMatchObject({
		survey: { id: "survey-1", iteration: 0 },
	});
	expect(await submitSurvey()).toEqual({ ok: true });
	expect(await handleRequest("feedback.survey", {}, CTX)).toEqual({ survey: null });
	expect(storedFeedback()).toMatchObject({ submittedSurveyId: "survey-1", submittedIteration: 0 });
	await shutdownAnalytics();
	expect(sent.some((body) => body.includes('"survey sent"') && body.includes('"Good"'))).toBe(true);
});

test("feedback.survey.submit refuses a different survey version without completing either", async () => {
	const sent: string[] = [];
	bootSurveyAnalytics(sent);
	launchSurvey(1);
	await expect(submitSurvey({ iteration: 0 })).rejects.toMatchObject({ code: "SURVEY_CHANGED" });
	await expect(submitSurvey({ iteration: 1, surveyId: "survey-0" })).rejects.toMatchObject({
		code: "SURVEY_CHANGED",
	});
	await expect(submitSurvey({ iteration: 1, answers: {} })).rejects.toMatchObject({
		code: "SURVEY_INVALID",
	});
	await expect(submitSurvey({ submissionId: "nope" })).rejects.toMatchObject({
		code: "SURVEY_INVALID",
	});
	expect(await handleRequest("feedback.survey", {}, CTX)).toMatchObject({
		survey: { id: "survey-1", iteration: 1 },
	});
	await shutdownAnalytics();
	expect(sent.some((body) => body.includes('"survey sent"'))).toBe(false);
});

test("feedback.survey.submit re-reads PostHog instead of trusting the displayed copy", async () => {
	const sent: string[] = [];
	bootSurveyAnalytics(sent);
	launchSurvey(0);
	expect(await handleRequest("feedback.survey", {}, CTX)).toMatchObject({
		survey: { iteration: 0 },
	});

	remoteSurvey.iteration = 1;
	await expect(submitSurvey()).rejects.toMatchObject({ code: "SURVEY_CHANGED" });
	remoteSurvey.iteration = null;
	await expect(submitSurvey({ iteration: 1 })).rejects.toMatchObject({
		code: "SURVEY_UNAVAILABLE",
	});
	remoteSurvey.iteration = 0;
	remoteSurvey.status = 503;
	await expect(submitSurvey()).rejects.toMatchObject({ code: "SURVEY_NOT_SENT" });
	await shutdownAnalytics();
	expect(sent.some((body) => body.includes('"survey sent"'))).toBe(false);
	expect(existsSync(join(dataDir, "feedback.json"))).toBe(false);
});

test("a completion that cannot be saved still counts as sent and never sends the answers twice", async () => {
	const sent: string[] = [];
	bootSurveyAnalytics(sent);
	launchSurvey();
	expect(await handleRequest("feedback.survey", {}, CTX)).toMatchObject({
		survey: { id: "survey-1" },
	});
	const blocked = join(dataDir, "blocked");
	writeFileSync(blocked, "not a directory");
	process.env.THINKRAIL_DATA_DIR = blocked;
	try {
		expect(await submitSurvey()).toEqual({ ok: true });
		await expect(submitSurvey()).rejects.toMatchObject({ code: "SURVEY_UNAVAILABLE" });
		expect(await handleRequest("feedback.survey", {}, CTX)).toEqual({ survey: null });
	} finally {
		process.env.THINKRAIL_DATA_DIR = dataDir;
	}
	await shutdownAnalytics();
	expect(sent.filter((body) => body.includes('"survey sent"'))).toHaveLength(1);
});

test("feedback.survey speaks the app language and a vanished translation restarts the survey", async () => {
	const sent: string[] = [];
	bootSurveyAnalytics(sent);
	let translations: Record<string, unknown> = { es: { question: "¿Qué tal?" } };
	configureSurveySource({
		apiKey: "phc_test",
		fetchImpl: (() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						surveys: [
							{
								id: "survey-1",
								name: "in-app-feedback",
								start_date: "2026-10-28T00:00:00.000Z",
								questions: [{ id: "q1", type: "open", question: "How is it?", translations }],
							},
						],
					}),
				),
			)) as unknown as typeof fetch,
	});
	expect(await handleRequest("feedback.survey", { language: "es-MX" }, CTX)).toMatchObject({
		survey: { language: "es", questions: [{ question: "¿Qué tal?" }] },
	});
	expect(await handleRequest("feedback.survey", {}, CTX)).not.toMatchObject({
		survey: { language: "es" },
	});

	translations = {};
	await expect(submitSurvey({ language: "es" })).rejects.toMatchObject({ code: "SURVEY_CHANGED" });
	translations = { es: { question: "¿Qué tal?" } };
	expect(await submitSurvey({ language: "es" })).toEqual({ ok: true });
	await shutdownAnalytics();
	expect(sent.some((body) => body.includes('"$survey_language":"es"'))).toBe(true);
});

test("feedback.survey.submit does not complete a survey whose answers were not sent", async () => {
	launchSurvey();
	await expect(submitSurvey()).rejects.toMatchObject({ code: "SURVEY_NOT_SENT" });
	expect(await handleRequest("feedback.survey", {}, CTX)).toMatchObject({
		survey: { id: "survey-1" },
	});
});

test("feedback.respond rejects an action outside the wire union", async () => {
	for (const action of ["later", "book"]) {
		await expect(handleRequest("feedback.respond", { action }, CTX)).rejects.toThrow(
			"Invalid invitation response",
		);
	}
});

test("project.setTrust grants pi-level resource trust only when the request asks for resources", async () => {
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{
				id: "p1",
				name: "repo",
				path: repo,
				slug: "repo",
				lastOpened: 1,
				piResourceTrust: "untrusted",
			},
		]),
	);
	const setTrust = async (params: { trusted: boolean; resources?: boolean }) =>
		(await handleRequest("project.setTrust", { id: "p1", ...params }, CTX)) as Project;

	expect(await setTrust({ trusted: true })).toMatchObject({
		trusted: true,
		piResourceTrust: "untrusted",
	});
	expect(await setTrust({ trusted: true, resources: true })).toMatchObject({
		trusted: true,
		piResourceTrust: "granted",
	});
	expect(await setTrust({ trusted: false })).toMatchObject({
		trusted: false,
		piResourceTrust: "untrusted",
	});
});

test("project.setTrust acknowledges the present aliases only when it grants alias trust", async () => {
	const writeAlias = (name: string) => {
		const directory = join(repo, ".claude", "skills", name);
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			join(directory, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${name} alias\n---\n\n# ${name}\n`,
		);
	};
	const setTrust = async (params: { trusted: boolean; resources?: boolean }) =>
		(await handleRequest("project.setTrust", { id: "p1", ...params }, CTX)) as Project;
	writeAlias("first-alias");
	expect((await setTrust({ trusted: true })).acknowledgedSkills).toEqual(["first-alias"]);

	writeAlias("late-alias");
	expect(await setTrust({ trusted: true, resources: true })).toMatchObject({
		piResourceTrust: "granted",
		acknowledgedSkills: ["first-alias"],
	});

	await setTrust({ trusted: false });
	expect((await setTrust({ trusted: true })).acknowledgedSkills?.sort()).toEqual([
		"first-alias",
		"late-alias",
	]);
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

test("session.rename persists a bounded title into a closed Pi transcript", async () => {
	const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = join(dataDir, "rename-agent");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
		const workspace = rows[0];
		if (!workspace) throw new Error("expected a workspace");
		const fixture = writeFixtureSession(defaultSessionDirFor(agentDir, workspace.worktreePath), {
			cwd: workspace.worktreePath,
			name: "Before rename",
			messages: [{ role: "user", text: "hello", timestamp: Date.now() }],
		});

		expect(
			await handleRequest(
				"session.rename",
				{ workspaceId: workspace.id, sessionId: fixture.id, title: "  After\r\nrename  " },
				CTX,
			),
		).toEqual({ ok: true });
		expect(SessionManager.open(fixture.path).getSessionName()).toBe("After rename");
		await expect(
			handleRequest(
				"session.rename",
				{ workspaceId: workspace.id, sessionId: fixture.id, title: " \n " },
				CTX,
			),
		).rejects.toThrow("Invalid session title");
		await expect(
			handleRequest(
				"session.rename",
				{ workspaceId: workspace.id, sessionId: fixture.id, title: "x".repeat(81) },
				CTX,
			),
		).rejects.toThrow("Invalid session title");
	} finally {
		if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	}
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

test("workspace.setSubagentMaxConcurrent persists a limit and null restores the global one", async () => {
	const created = (await handleRequest("workspace.create", { projectId: "p1" }, CTX)) as Workspace;
	const limited = (await handleRequest(
		"workspace.setSubagentMaxConcurrent",
		{ id: created.id, value: 2 },
		CTX,
	)) as Workspace;
	expect(limited.subagentMaxConcurrentOverride).toBe(2);
	const inherited = (await handleRequest(
		"workspace.setSubagentMaxConcurrent",
		{ id: created.id, value: null },
		CTX,
	)) as Workspace;
	expect(inherited.subagentMaxConcurrentOverride).toBeUndefined();
	await expect(
		handleRequest("workspace.setSubagentMaxConcurrent", { id: created.id, value: 0 }, CTX),
	).rejects.toThrow("Subagent limit must be a whole number from 1 to 16");
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

test("a review send that names its chat lands every file's drafts there as one package", async () => {
	const cleanup = await setupDefaultModelRuntime();
	let sessions = 0;
	setSessionManagerFactory((cwd) => {
		sessions += 1;
		return SessionManager.inMemory(cwd, { id: `review-send-${sessions}` });
	});
	try {
		const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
		const workspace = rows[0];
		if (!workspace) throw new Error("expected a workspace");
		writeFileSync(join(repo, "NOTES.md"), "notes\n");
		const chat = (await handleRequest(
			"session.create",
			{ workspaceId: workspace.id },
			CTX,
		)) as CreateSessionResult;
		const draft = (path: string) =>
			addComment({
				workspaceId: workspace.id,
				kind: "inline",
				anchor: {
					path,
					side: "worktree",
					contentHash: "",
					selectors: [{ kind: "lineRange", startLine: 1, endLine: 1 }],
				},
				body: `about ${path}`,
			});
		const ids = [(await draft("README.md")).id, (await draft("NOTES.md")).id];

		const sent = (await handleRequest(
			"review.sendBatch",
			{ workspaceId: workspace.id, sessionId: chat.sessionId },
			CTX,
		)) as { sessions: { sessionId: string }[] };

		expect(sent.sessions.map((session) => session.sessionId)).toEqual([chat.sessionId]);
		const comments = (await getReviewSnapshot(workspace.id)).comments.filter((comment) =>
			ids.includes(comment.id),
		);
		expect(comments.map((comment) => [comment.status, comment.sessionId])).toEqual([
			["sent", chat.sessionId],
			["sent", chat.sessionId],
		]);
	} finally {
		disposeAllSessions();
		configurePiRuntime(null);
		setSessionManagerFactory((cwd) => SessionManager.create(cwd));
		cleanup();
	}
});

test("a path resolved into a Default it had to ensure gets the Default's first terminal", async () => {
	const match = (await handleRequest(
		"workspace.resolvePath",
		{ path: join(repo, "README.md") },
		CTX,
	)) as WorkspacePathMatch;
	expect(match).toMatchObject({ projectId: "p1", relativePath: "README.md" });
	expect(getWorkspace(match.workspaceId)).toMatchObject({ kind: "default" });
	expect(getWorkspace(match.workspaceId).initialTerminalPending).toBeUndefined();
	expect(listTerminals(match.workspaceId)).toEqual([
		{ tabKey: INITIAL_TERMINAL_TAB_KEY, title: "Terminal 1" },
	]);
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

test("resource handlers scope every read/control to a registered workspace and actual parent", async () => {
	const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	const priorOffline = process.env.PI_OFFLINE;
	process.env.PI_CODING_AGENT_DIR = join(dataDir, "agent");
	process.env.PI_OFFLINE = "1";
	configurePiRuntime(
		await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			allowModelNetwork: false,
		}),
	);
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd, { id: "release.1" }));
	try {
		const workspace = (await handleRequest(
			"workspace.create",
			{ projectId: "p1" },
			CTX,
		)) as Workspace;
		const other = (await handleRequest("workspace.create", { projectId: "p1" }, CTX)) as Workspace;
		const parent = (await handleRequest(
			"session.create",
			{ workspaceId: workspace.id },
			CTX,
		)) as CreateSessionResult;
		const scope = { workspaceId: workspace.id, sessionId: parent.sessionId };
		const none = { done: 0, failed: 0, stopped: 0, interrupted: 0 };
		expect(await handleRequest("session.resources", scope, CTX)).toEqual({
			...scope,
			commands: [],
			subagents: [],
			mcpServers: [],
			history: { commands: none, subagents: none },
		});
		expect(
			await handleRequest(
				"session.resourceHistory",
				{ ...scope, kind: "command", before: { at: 1, id: "older" }, limit: 5 },
				CTX,
			),
		).toEqual({ kind: "command", items: [], hasMore: false });
		expect(
			await handleRequest("backgroundCommand.output", { ...scope, commandId: "missing" }, CTX),
		).toEqual({ available: false });
		await expect(
			handleRequest("backgroundCommand.stop", { ...scope, commandId: "missing" }, CTX),
		).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
		const children = { workspaceId: workspace.id, parentSessionId: parent.sessionId };
		expect(await handleRequest("subagent.stopAll", children, CTX)).toEqual({
			ok: true,
			targeted: 0,
		});
		await expect(
			handleRequest("subagent.stop", { ...children, childSessionId: "missing" }, CTX),
		).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
		for (const workspaceId of [other.id, "missing-workspace"]) {
			const calls = [
				["session.resources", { ...scope, workspaceId }],
				["session.resourceHistory", { ...scope, workspaceId, kind: "subagent" }],
				["backgroundCommand.output", { ...scope, workspaceId, commandId: "missing" }],
				["backgroundCommand.stop", { ...scope, workspaceId, commandId: "missing" }],
				["subagent.stop", { ...children, workspaceId, childSessionId: "missing" }],
				["subagent.stopAll", { ...children, workspaceId }],
			] as const;
			for (const [method, params] of calls)
				await expect(handleRequest(method, params, CTX)).rejects.toMatchObject({
					code: "RESOURCE_UNAVAILABLE",
				});
		}
		await expect(
			handleRequest("session.resources", { ...scope, sessionId: "unknown-parent" }, CTX),
		).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
		for (const params of [
			undefined,
			null,
			{},
			{ ...scope, sessionId: "../secret" },
			{ ...scope, sessionId: 123 },
			{ ...scope, path: "/tmp/secret" },
			{ ...scope, pid: 123 },
		]) {
			await expect(handleRequest("session.resources", params, CTX)).rejects.toThrow(
				"Invalid resource ids",
			);
		}
		for (const params of [
			{ ...scope, kind: "terminal" },
			{ ...scope, kind: "command", limit: 0 },
			{ ...scope, kind: "command", limit: 1.5 },
			{ ...scope, kind: "command", before: { at: 1, id: "../secret" } },
			{ ...scope, kind: "command", before: { at: "1", id: "older" } },
			{ ...scope, kind: "command", before: { at: 1, id: "older", path: "/tmp" } },
			{ ...scope, kind: "subagent", path: "/tmp/secret" },
		]) {
			await expect(handleRequest("session.resourceHistory", params, CTX)).rejects.toThrow(
				/Invalid resource (?:history|ids)/,
			);
		}
		for (const commandId of ["/tmp/output", "..", "C:\\output", "bad\u0000id"]) {
			await expect(
				handleRequest("backgroundCommand.output", { ...scope, commandId }, CTX),
			).rejects.toThrow("Invalid resource ids");
			await expect(
				handleRequest("backgroundCommand.stop", { ...scope, commandId }, CTX),
			).rejects.toThrow("Invalid resource ids");
		}
	} finally {
		disposeAllSessions();
		configurePiRuntime(null);
		setSessionManagerFactory((cwd) => SessionManager.create(cwd));
		if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
		if (priorOffline === undefined) delete process.env.PI_OFFLINE;
		else process.env.PI_OFFLINE = priorOffline;
	}
});

test("subagent.list admits only pi-resource-trusted workspace metadata and never arbitrary cwd", async () => {
	const define = (dir: string, name: string, extra = "") => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, `${name}.md`),
			`---\nname: ${name}\ndescription: ${name} description\n${extra}---\nSECRET PROMPT`,
		);
	};
	define(
		join(dataDir, "pi", "agents"),
		"personal-role",
		"model: provider/pinned\nthinking: high\n",
	);
	define(join(repo, ".pi", "agents"), "project-role");
	define(join(repo, ".agents", "agents"), "other-project-role");
	define(join(repo, ".pi", "agents"), "scout");
	define(join(repo, ".pi", "agents"), "personal-role");
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{ id: "w1", projectId: "p1", name: "Default", worktreePath: repo, createdAt: 1 },
		]),
	);
	const list = (params: unknown = {}) =>
		handleRequest("subagent.list", params, CTX) as Promise<SubagentCatalogEntry[]>;
	const personal: SubagentCatalogEntry = {
		name: "personal-role",
		description: "personal-role description",
		source: "personal",
		model: "provider/pinned",
		thinking: "high",
	};
	expect(await list()).toContainEqual(personal);
	expect((await list({ cwd: repo })).some((entry) => entry.source === "project")).toBe(false);
	expect((await list({ workspaceId: "w1" })).some((entry) => entry.source === "project")).toBe(
		false,
	);
	await handleRequest("project.setTrust", { id: "p1", trusted: true }, CTX);
	expect((await list({ workspaceId: "w1" })).some((entry) => entry.source === "project")).toBe(
		false,
	);
	await handleRequest("project.setTrust", { id: "p1", trusted: true, resources: true }, CTX);
	const trusted = await list({ workspaceId: "w1", cwd: "/not-used" });
	expect((await list()).some((entry) => entry.source === "project")).toBe(false);
	expect(trusted).toContainEqual(personal);
	expect(trusted.find((entry) => entry.name === "scout")?.source).toBe("builtin");
	expect(
		trusted
			.filter((entry) => entry.source === "project")
			.map((entry) => entry.name)
			.sort(),
	).toEqual(["other-project-role", "project-role"]);
	for (const entry of trusted) {
		expect(
			Object.keys(entry).every((key) =>
				["name", "description", "source", "model", "thinking"].includes(key),
			),
		).toBe(true);
	}
	expect(JSON.stringify(trusted)).not.toContain("SECRET PROMPT");
	await handleRequest(
		"settings.update",
		{ config: { disabledSubagents: ["project-role", "missing", "project-role"] } },
		CTX,
	);
	expect(await list({ workspaceId: "w1" })).toEqual(trusted);
	await handleRequest("project.setTrust", { id: "p1", trusted: false }, CTX);
	expect((await list({ workspaceId: "w1" })).some((entry) => entry.source === "project")).toBe(
		false,
	);
	await expect(list({ workspaceId: "unknown" })).rejects.toThrow("Unknown workspace");
});

test("subagent.setEnabled retains unknown names and rejects malformed payloads without mutation or publication", async () => {
	updateConfig({ disabledSubagents: ["temporarily-missing"] });
	await handleRequest("subagent.setEnabled", { name: "unlisted-role", enabled: false }, CTX);
	expect(getConfig().disabledSubagents).toEqual(["temporarily-missing", "unlisted-role"]);
	const before = getConfig();
	const stored = readFileSync(join(dataDir, "config.json"), "utf8");
	const published: AppConfig[] = [];
	setSettingsPublisher((config) => published.push(config));
	try {
		for (const params of [
			undefined,
			null,
			[],
			"scout",
			false,
			1,
			{},
			{ enabled: false },
			{ name: "scout" },
			{ name: "", enabled: false },
			{ name: " \t", enabled: true },
			{ name: null, enabled: false },
			{ name: 1, enabled: false },
			{ name: ["scout"], enabled: false },
			{ name: {}, enabled: false },
			{ name: "scout", enabled: "false" },
			{ name: "scout", enabled: 0 },
			{ name: "scout", enabled: null },
			{ name: "scout", enabled: [] },
			{ name: "scout", enabled: {} },
			{ cwd: repo, disabledSubagents: ["scout"] },
		]) {
			await expect(handleRequest("subagent.setEnabled", params, CTX)).rejects.toThrow();
		}
		expect(getConfig()).toBe(before);
		expect(readFileSync(join(dataDir, "config.json"), "utf8")).toBe(stored);
		expect(published).toEqual([]);
	} finally {
		setSettingsPublisher(null);
	}
});
