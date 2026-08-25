import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openAppFresh, openFixtureProject, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PICK_DIR_POINTER } from "./fixtures/paths";

test("the dialog lists local branches (no stray origin) and creates a worktree", async ({
	page,
}) => {
	await openFixtureProject(page);

	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();

	await expect(dialog.getByRole("heading", { name: "Create workspace" })).toBeVisible();
	await expect(dialog).toContainText("A separate checkout on its own new branch");
	await expect(dialog.getByTestId("ws-prompt-note")).toHaveCount(0);
	await expect(dialog).toContainText("Files, chats, changes, and terminals stay scoped to it");
	await expect(dialog.getByTestId("ws-target-worktree")).toHaveAttribute("data-active", "true");

	await dialog.getByTestId("ws-target-default").click();
	await expect(dialog.getByRole("heading", { name: "Work in project folder" })).toBeVisible();
	await expect(dialog).toContainText("no isolation");
	await expect(dialog.getByTestId("ws-branch-picker")).toHaveCount(0);
	await expect(page.getByTestId("create-workspace")).toHaveText(/Start/);
	await dialog.getByTestId("ws-target-worktree").click();
	await expect(dialog.getByRole("heading", { name: "Create workspace" })).toBeVisible();
	await expect(dialog.getByTestId("ws-branch-picker")).toBeVisible();
	await expect(page.getByTestId("create-workspace")).toHaveText(/Create/);

	await expect(dialog.getByTestId("ws-project-picker")).toContainText("sample-project");

	const branchPicker = dialog.getByTestId("ws-branch-picker");
	await expect(branchPicker).toContainText("From");
	await expect(branchPicker).toContainText("main");

	await branchPicker.click();
	const mainOption = page.locator('[data-testid="branch-option"][data-branch="main"]');
	await expect(mainOption).toBeVisible();
	await expect(mainOption).toContainText("default");
	await expect(page.locator('[data-testid="branch-option"][data-branch="origin"]')).toHaveCount(0);

	await page.getByPlaceholder("Search branches…").fill("zzz-no-such-branch");
	await expect(page.getByTestId("branch-option")).toHaveCount(0);
	await expect(page.getByText("No branches found.")).toBeVisible();
	await page.getByPlaceholder("Search branches…").fill("main");
	await expect(mainOption).toBeVisible();
	await page.keyboard.press("Escape");

	const effort = dialog.getByTestId("thinking-selector");
	await expect(effort).toBeVisible();
	const modelResolved = !(await dialog.getByTestId("model-selector").textContent())?.includes(
		"Select model",
	);
	if (modelResolved) await expect(effort).toBeEnabled();
	else await expect(effort).toBeDisabled();

	await dialog.getByTestId("model-selector").click();
	const refresh = page.getByTestId("model-refresh");
	await expect(refresh).toBeVisible();
	await refresh.evaluate((el) => {
		const seen: string[] = [];
		(window as unknown as { __refreshStates: string[] }).__refreshStates = seen;
		new MutationObserver(() => seen.push(el.getAttribute("data-refreshing") ?? "")).observe(el, {
			attributes: true,
			attributeFilter: ["data-refreshing"],
		});
	});
	await refresh.click();
	await expect(refresh).toHaveAttribute("data-refreshing", "false");
	await expect(refresh).toBeEnabled();
	expect(
		await page.evaluate(() => (window as unknown as { __refreshStates: string[] }).__refreshStates),
	).toContain("true");
	await page.keyboard.press("Escape");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(worktreeRows(page)).toHaveCount(0);

	await page.getByTestId("add-workspace").first().click();
	await expect(dialog).toBeVisible();
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();
	await expect(worktreeRows(page)).toHaveCount(1);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");

	const scope = page.getByTestId("scope-context");
	await expect(scope).toHaveAttribute("data-context", "workspace");
	await expect(scope).toContainText("sample-project");
	await expect(scope).toContainText("workspace-1");
	await expect(scope).toContainText("from main");

	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveCount(0);
});

test("folder-mode Start with an empty prompt lands in a fresh chat in the Default workspace", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("ws-target-default").click();
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();

	await expect(page.getByTestId("scope-name")).toHaveText("Default");
	await expect(worktreeRows(page)).toHaveCount(0);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveCount(0);
});

test("a project's committed skills are gated behind trust, then autocomplete", async ({ page }) => {
	await openFixtureProject(page);

	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	const prompt = dialog.getByTestId("ws-prompt");
	const portable = dialog.getByTestId("slash-command").filter({ hasText: "/skill:e2e-portable" });

	await expect(dialog.getByTestId("ws-trust-notice")).toBeVisible();
	await prompt.fill("/e2e");
	await expect(portable).toHaveCount(0);

	await dialog.getByTestId("ws-trust-project").click();
	await expect(dialog.getByTestId("ws-trust-notice")).toBeHidden();
	await prompt.fill("/e2e");
	await expect(portable).toBeVisible();
	await expect(portable).toContainText("skill/project");

	await prompt.press("Escape");
	await expect(dialog.getByTestId("slash-menu")).toBeHidden();
	await expect(dialog).toBeVisible();
	await prompt.fill("/e2");
	await expect(portable).toBeVisible();

	await prompt.press("Enter");
	await expect(prompt).toHaveValue("/skill:e2e-portable ");
	await expect(dialog).toBeVisible();
	await expect(worktreeRows(page)).toHaveCount(0);
});

test("Enter in the prompt creates; Shift+Enter inserts a newline", async ({ page }) => {
	await openFixtureProject(page);

	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	const prompt = dialog.getByTestId("ws-prompt");

	await prompt.fill("first line");
	await expect(dialog.getByTestId("workspace-naming-hint")).toContainText(
		"name the workspace and branch from your request",
	);
	await prompt.press("Shift+Enter");
	await prompt.pressSequentially("second line");
	await expect(prompt).toHaveValue("first line\nsecond line");
	await expect(dialog).toBeVisible();
	await expect(worktreeRows(page)).toHaveCount(0);

	await prompt.fill("");
	await expect(dialog.getByTestId("workspace-naming-hint")).toHaveCount(0);
	await prompt.press("Enter");
	await expect(dialog).toBeHidden();
	await expect(worktreeRows(page)).toHaveCount(1);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveCount(0);
});

test("a base whose fetch fails reports git's error, not a request timeout", async ({ page }) => {
	const remote = join(E2E_DATA_DIR, "dangling-head-remote.git");
	const repo = join(E2E_DATA_DIR, "dangling-head-fixture");
	const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args]);
	for (const path of [remote, repo]) rmSync(path, { recursive: true, force: true });
	mkdirSync(remote, { recursive: true });
	git(remote, "init", "--bare", "-b", "main");
	git(E2E_FIXTURE_REPO, "push", remote, "main");
	git(E2E_DATA_DIR, "clone", remote, repo);
	git(repo, "remote", "set-head", "origin", "main");
	git(repo, "update-ref", "-d", "refs/remotes/origin/main");
	rmSync(remote, { recursive: true, force: true });

	try {
		await openAppFresh(page);
		writeFileSync(E2E_PICK_DIR_POINTER, repo);
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		await page.getByTestId("add-workspace").first().click();
		const dialog = page.getByTestId("new-workspace-dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId("ws-branch-picker")).toContainText("origin/main");

		await page.getByTestId("create-workspace").click();

		const toast = page.getByTestId("toast");
		await expect(toast).toContainText("Couldn't create workspace");
		await expect(toast).toContainText("Could not fetch origin/main");
		await expect(worktreeRows(page)).toHaveCount(0);
	} finally {
		writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
		rmSync(repo, { recursive: true, force: true });
	}
});
