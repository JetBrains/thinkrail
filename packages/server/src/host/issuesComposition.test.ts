import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProjects, saveWorkspaces } from "../persistence";
import { createIssueSessionStore } from "./issueSessions";
import { createIssuesHost } from "./issues";
import { createIssueWorkspacePersistence } from "./issueWorkspacePersistence";

let dir: string;
let repositoryPath: string;
let host: ReturnType<typeof createIssuesHost>;
const credentialValues = new Map<string, string>();
const credentials = {
	async get(id: string) {
		return credentialValues.get(id) ?? null;
	},
	async set(id: string, token: string) {
		credentialValues.set(id, token);
	},
	async delete(id: string) {
		credentialValues.delete(id);
	},
};
const reference = {
	provider: "gitlab" as const,
	instanceUrl: "https://gitlab.example",
	projectId: "42",
	number: 7,
};
let snapshot: { sha: string; tree: string; branch: string };

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "issues-composition-"));
	const primaryPath = join(dir, "repo");
	repositoryPath = join(primaryPath, ".worktrees", "issue-7");
	mkdirSync(join(primaryPath, ".worktrees"), { recursive: true });
	const run = (...args: string[]) => Bun.spawnSync(["git", "-C", primaryPath, ...args]);
	if (!run("init", "-q").success) throw new Error("git init failed");
	if (
		!run(
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"--allow-empty",
			"-m",
			"initial",
		).success
	)
		throw new Error("git commit failed");
	if (!run("worktree", "add", "-b", "issue-7-composition", repositoryPath, "HEAD").success)
		throw new Error("Issue worktree creation failed");
	const worktree = (...args: string[]) => Bun.spawnSync(["git", "-C", repositoryPath, ...args]);
	snapshot = {
		sha: worktree("rev-parse", "HEAD").stdout.toString().trim(),
		tree: worktree("rev-parse", "HEAD^{tree}").stdout.toString().trim(),
		branch: worktree("branch", "--show-current").stdout.toString().trim(),
	};
	saveProjects([
		{ id: "repo", name: "repo", slug: "repo", path: primaryPath, lastOpened: 1, trusted: true },
	]);
	saveWorkspaces([
		{
			id: "workspace",
			projectId: "repo",
			name: "Issue 7",
			branch: snapshot.branch,
			baseBranch: "main",
			worktreePath: repositoryPath,
		},
	]);
	const sessions = join(dir, "issue-sessions");
	mkdirSync(sessions, { recursive: true });
	await createIssueSessionStore(sessions).bind({
		sessionId: "session",
		workspaceId: "workspace",
		projectId: "repo",
		reference,
		stage: "implementation",
		locale: "en",
	});
	const issueWorkspacePath = join(dir, "issue-workspaces");
	mkdirSync(issueWorkspacePath, { recursive: true });
	const issueWorkspaceStore = createIssueWorkspacePersistence(issueWorkspacePath);
	await issueWorkspaceStore.withLaunch("repo", reference, (ports) =>
		ports.save(JSON.stringify(["repo", "gitlab", reference.instanceUrl, "42", 7]), {
			projectId: "repo",
			reference,
			implementation: {
				state: "completed",
				workspaceId: "workspace",
				worktreePath: repositoryPath,
				branch: snapshot.branch,
			},
		}),
	);
	host = createIssuesHost({
		dir,
		credentials,
		fetch: (async (url) => {
			const address = String(url);
			if (address.includes("/issues?")) return new Response("[]");
			if (address.endsWith("/issues/1"))
				return new Response(
					JSON.stringify({
						iid: 1,
						title: "Fixture",
						description: "",
						state: "opened",
						labels: [],
						updated_at: "2026-01-01T00:00:00Z",
					}),
				);
			return new Response(JSON.stringify({ id: 42, path_with_namespace: "group/repo" }));
		}) as typeof fetch,
	});
	await host.connect({
		projectId: "repo",
		input: { instanceUrl: reference.instanceUrl, projectId: "group/repo", token: "test-token" },
	});
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("host composition records and reads delivery state without a confirmation", async () => {
	const prepare = host.agentSessions.prepareConfirmation;
	if (!prepare) throw new Error("Issue confirmation tool is unavailable");
	expect(await prepare("session", { operationId: "read", action: "read-delivery-state" })).toEqual({
		revision: 0,
		repositories: [],
	});
	const deliveryState = {
		repositories: [
			{
				projectId: "repo",
				worktreeId: "workspace",
				sourceBranch: snapshot.branch,
				targetBranch: "main",
				policy: "draft",
				dependsOn: [],
				checkoutSha: snapshot.sha,
				checkoutTree: snapshot.tree,
				validations: [],
				updatedAt: new Date().toISOString(),
			},
		],
	};
	const result = await prepare("session", {
		operationId: "record",
		action: "record-delivery-state",
		expectedRevision: 0,
		deliveryState,
	});
	expect(result).toMatchObject({
		revision: 1,
		repositories: [expect.objectContaining({ projectId: "repo" })],
	});
	expect(
		await prepare("session", { operationId: "read-after-write", action: "read-delivery-state" }),
	).toMatchObject({
		revision: 1,
	});
});

test("MR ready and merge action names reach the composed host routes", async () => {
	const prepare = host.agentSessions.prepareConfirmation;
	if (!prepare) throw new Error("Issue confirmation tool is unavailable");
	for (const action of ["ready-mr", "merge-mr"] as const) {
		const result = await prepare("session", {
			operationId: action,
			action,
			projectId: "repo",
			mergeRequestId: 7,
			targetBranch: "main",
			expectedSha: snapshot.sha,
		});
		expect(result).toMatchObject({ status: expect.any(String) });
	}
});
