import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import type { Project, Workspace } from "@thinkrail/contracts";
import {
	activeWorktreeRow,
	expandActivityStep,
	openAppFresh,
	openWorkspaceChat,
	settingsDialog,
} from "./fixtures/app";
import { git, gitText } from "./fixtures/git";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

function persistedWorkspaces(): Workspace[] {
	return JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")) as Workspace[];
}

test("a side-workspace request starts a real workspace whose chat runs, and status reports it", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	const spawner = await openWorkspaceChat(page);
	const before = new Set(persistedWorkspaces().map((workspace) => workspace.id));

	await page
		.getByTestId("chat-input")
		.fill(
			"Do this in a side workspace, not here: create a file SIDE.md whose only content is the line `side marker`. " +
				"After starting it, check that workspace's status once and tell me its chat state.",
		);
	await page.getByTestId("chat-send").click();

	const card = page.locator('[data-testid="tool-card"][data-tool="start_workspace"]').first();
	await expect(card).toHaveAttribute("data-status", "done", { timeout: 120_000 });
	await expect(card.getByTestId("tool-start-workspace")).toContainText("SIDE.md");

	await expect
		.poll(() => persistedWorkspaces().filter((workspace) => !before.has(workspace.id)).length, {
			timeout: 20_000,
		})
		.toBe(1);
	const child = persistedWorkspaces().find((workspace) => !before.has(workspace.id));
	if (!child) throw new Error("start_workspace persisted no new workspace");
	expect(child.projectId).toBe(spawner.projectId);
	expect(child.worktreePath).not.toBe(spawner.worktreePath);

	await expect(page.getByTestId("turn-divider-status").last()).toHaveAttribute(
		"data-outcome",
		"done",
		{ timeout: 150_000 },
	);
	const status = await expandActivityStep(page, "workspace_status");
	await expect(status).toContainText(child.id);

	await expect
		.poll(() => existsSync(join(child.worktreePath, "SIDE.md")), { timeout: 150_000 })
		.toBe(true);
	expect(readFileSync(join(child.worktreePath, "SIDE.md"), "utf8")).toContain("side marker");
	expect(existsSync(join(spawner.worktreePath, "SIDE.md"))).toBe(false);

	await card.getByTestId("start-workspace-open").click();
	await expect(activeWorktreeRow(page).getByTestId("workspace-name")).toHaveText(
		persistedWorkspaces().find((workspace) => workspace.id === child.id)?.name ?? child.name,
		{ timeout: 20_000 },
	);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
});

function persistedProjects(): Project[] {
	const path = join(E2E_DATA_DIR, "projects.json");
	return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Project[]) : [];
}

function seedUpstream(): string {
	const repo = join(E2E_DATA_DIR, "open-project-upstream", "widget");
	rmSync(repo, { recursive: true, force: true });
	mkdirSync(repo, { recursive: true });
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "e2e@thinkrail.test");
	git(repo, "config", "user.name", "ThinkRail E2E");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# widget\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "seed");
	return repo;
}

test("a chat without a project clones a repository after approval and starts a workspace in it", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	await openAppFresh(page);
	const upstream = seedUpstream();
	const folder = join(E2E_DATA_DIR, "open-project-clones");
	rmSync(folder, { recursive: true, force: true });
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("settings.update", { config: { projectsFolder: folder } });
	} finally {
		wire.close();
	}
	await page.getByTestId("welcome-action").filter({ hasText: "Chat without a project" }).click();
	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");

	const url = pathToFileURL(upstream).href;
	await page
		.getByTestId("chat-input")
		.fill(
			`I picked this repository: ${url}. Add it as a ThinkRail project, then start a workspace in it ` +
				"whose task is: create a file NOTE.md whose only content is the line `opened marker`. " +
				"Do nothing else.",
		);
	await page.getByTestId("chat-send").click();

	const card = page.locator('[data-testid="tool-card"][data-tool="open_project"]').first();
	const prompt = page.getByTestId("ext-ui-prompt");
	await expect(prompt).toContainText(`into ${join(folder, "widget")}`, { timeout: 120_000 });
	await expect(prompt).toContainText("default projects folder");
	expect(existsSync(join(folder, "widget"))).toBe(false);
	await prompt.getByTestId("ext-ui-option").filter({ hasText: "Clone" }).click();

	await expect(card).toHaveAttribute("data-status", "done", { timeout: 120_000 });
	await expect(card.getByTestId("open-project-name")).toHaveText("widget");
	await expect(card.getByTestId("open-project-change-folder")).toBeVisible();
	const clone = join(folder, "widget");
	expect(gitText(clone, "remote", "get-url", "origin").trim()).toBe(url);
	const project = persistedProjects().find(
		(candidate) => realpathSync(candidate.path) === realpathSync(clone),
	);
	if (!project) throw new Error("open_project persisted no project for the clone");
	expect(project.piResourceTrust).toBe("untrusted");

	const started = page.locator('[data-testid="tool-card"][data-tool="start_workspace"]').first();
	await expect(started).toHaveAttribute("data-status", "done", { timeout: 120_000 });
	await expect
		.poll(() => persistedWorkspaces().some((workspace) => workspace.projectId === project.id), {
			timeout: 20_000,
		})
		.toBe(true);
	const child = persistedWorkspaces().find((workspace) => workspace.projectId === project.id);
	if (!child) throw new Error("start_workspace made no workspace in the cloned project");
	await expect
		.poll(() => existsSync(join(child.worktreePath, "NOTE.md")), { timeout: 150_000 })
		.toBe(true);
	expect(readFileSync(join(child.worktreePath, "NOTE.md"), "utf8")).toContain("opened marker");

	await card.getByTestId("open-project-change-folder").click();
	await expect(settingsDialog(page).getByTestId("projects-folder-input")).toHaveValue(folder);
});
