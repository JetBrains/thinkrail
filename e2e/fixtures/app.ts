import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import { removeTree } from "@thinkrail/shared/removeTree";
import {
	E2E_CENTRAL_ARTIFACT,
	E2E_CENTRAL_LOG,
	E2E_CENTRAL_STATE,
	E2E_DATA_DIR,
	E2E_FIXTURE_REPO,
	E2E_PI_AGENT_DIR,
	E2E_PI_MODELS_SEED,
	E2E_PICK_DIR_POINTER,
	E2E_PLAIN_DIR,
} from "./paths";
import { fixtureRepoHealthy, seedFixtureRepo } from "./repo";

export const PHONE_VIEWPORT = { width: 390, height: 780 } as const;

export async function pressPlatformShortcut(page: Page, key: string): Promise<void> {
	const apple = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? ""));
	await page.keyboard.press(`${apple ? "Meta" : "Control"}+${key}`);
}

export async function hideAuxiliaryWorkbench(page: Page): Promise<void> {
	for (const [testId, shortcut] of [
		["left-stack", "B"],
		["right-stack", "J"],
		["bottom-panel", "Shift+J"],
	] as const) {
		const panel = page.getByTestId(testId);
		if ((await panel.count()) === 0) continue;
		await pressPlatformShortcut(page, shortcut);
		await expect(panel).toHaveCount(0);
	}
}

function resetState(): void {
	rmSync(join(E2E_DATA_DIR, "projects.json"), { force: true });
	removeTree(join(E2E_DATA_DIR, "worktrees"));
	removeTree(join(E2E_PI_AGENT_DIR, "sessions"));
	rmSync(E2E_CENTRAL_ARTIFACT, { force: true });
	writeFileSync(E2E_CENTRAL_STATE, "");
	rmSync(E2E_CENTRAL_LOG, { force: true });

	const modelsPath = join(E2E_PI_AGENT_DIR, "models.json");
	if (existsSync(E2E_PI_MODELS_SEED)) copyFileSync(E2E_PI_MODELS_SEED, modelsPath);
	else rmSync(modelsPath, { force: true });
	rmSync(`${modelsPath}.bak`, { force: true });

	if (!fixtureRepoHealthy()) seedFixtureRepo();

	try {
		const head = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "symbolic-ref", "--short", "HEAD"], {
			encoding: "utf8",
		}).trim();
		if (head !== "main") {
			execFileSync("git", ["-C", E2E_FIXTURE_REPO, "checkout", "-f", "main"], { stdio: "ignore" });
		}
	} catch {}

	execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "prune"]);
	for (let sweep = 0; sweep < 2; sweep += 1) {
		const branches = execFileSync(
			"git",
			["-C", E2E_FIXTURE_REPO, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
			{ encoding: "utf8" },
		)
			.split("\n")
			.map((b) => b.trim())
			.filter((b) => b && b !== "main");
		if (branches.length === 0) break;
		for (const branch of branches) {
			try {
				execFileSync("git", ["-C", E2E_FIXTURE_REPO, "branch", "-D", branch], { stdio: "ignore" });
			} catch {}
		}
	}

	rmSync(join(E2E_DATA_DIR, "workspaces.json"), { force: true });

	writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
}

export function stagePlainFolder(): string {
	resetState();
	rmSync(E2E_PLAIN_DIR, { recursive: true, force: true });
	mkdirSync(E2E_PLAIN_DIR, { recursive: true });
	writeFileSync(join(E2E_PLAIN_DIR, "notes.txt"), "hello from a plain folder\n");
	writeFileSync(E2E_PICK_DIR_POINTER, E2E_PLAIN_DIR);
	return E2E_PLAIN_DIR;
}

function loadPersistedWorkspaces(): Workspace[] {
	try {
		return JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")) as Workspace[];
	} catch {
		return [];
	}
}

export async function createWorkspaceViaDialog(page: Page): Promise<Workspace> {
	const before = new Set(loadPersistedWorkspaces().map((w) => w.id));
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(async () => {
		if (!(await dialog.isVisible())) await page.getByTestId("add-workspace").first().click();
		await expect(dialog).toBeVisible({ timeout: 5_000 });
	}).toPass({ timeout: 30_000 });
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]').first()).toBeVisible();
	const created = loadPersistedWorkspaces().find((w) => !before.has(w.id) && w.kind !== "default");
	if (!created) throw new Error("Workspace was not persisted after creation");
	return created;
}

export async function openAppFresh(page: Page): Promise<void> {
	resetState();
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

export async function openFixtureProject(page: Page): Promise<void> {
	await openAppFresh(page);
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item").first()).toBeVisible();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(defaultWorkspaceRow(page)).toBeVisible();
}

export async function enterDefaultWorkspace(page: Page): Promise<void> {
	await page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }).click();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("center-tabs")).toBeVisible();
}

export async function openChatFromHistory(page: Page, title: string): Promise<void> {
	await page.getByTestId("chat-history").first().click();
	await page.getByTestId("closed-chat-item").filter({ hasText: title }).click();
}

export async function revealFirstProjectWorkspaces(page: Page): Promise<void> {
	const expand = page.getByTestId("project-expand").first();
	await expect(expand).toBeVisible();
	if ((await expand.getAttribute("data-expanded")) !== "true") await expand.click();
}

export function defaultWorkspaceRow(page: Page): Locator {
	return page.locator('[data-testid="workspace-item"][data-kind="default"]');
}

export function worktreeRows(page: Page): Locator {
	return page.locator('[data-testid="workspace-item"]:not([data-kind="default"])');
}

export function activeWorktreeRow(page: Page): Locator {
	return worktreeRows(page).and(page.locator('[data-active="true"]'));
}

export async function openWorkspaceMenu(row: Locator): Promise<void> {
	await row.hover();
	await row.getByTestId("workspace-menu").click();
}

export async function goProjectHome(page: Page): Promise<void> {
	await page.getByTestId("project-item").first().getByText("sample-project").click();
	await expect(page.getByTestId("welcome")).toBeVisible();
}

export async function openWorkspaceChat(page: Page): Promise<void> {
	await openFixtureProject(page);
	await expect(async () => {
		if ((await worktreeRows(page).count()) === 0) {
			await createWorkspaceViaDialog(page);
		}
		await worktreeRows(page).first().getByRole("button").first().click();
		await expect(activeWorktreeRow(page)).toHaveCount(1, {
			timeout: 5_000,
		});
	}).toPass({ timeout: 30_000 });
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();
}

export async function waitForDone(page: Page, timeout = 90_000): Promise<void> {
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="system"]')
			.filter({ hasText: "Done" })
			.last(),
	).toBeVisible({ timeout });
}

export function routineActivityRows(page: Page): Locator {
	return page.locator(
		'[data-testid="thinking-group"], [data-testid="activity-group"], [data-testid="activity-step"]',
	);
}

export async function expandAllRoutineGroups(page: Page): Promise<void> {
	const collapsed = page.locator(
		'[data-testid="thinking-group"][data-expanded="false"], [data-testid="activity-group"][data-expanded="false"]',
	);
	while ((await collapsed.count()) > 0) {
		await collapsed.first().getByRole("button").first().click();
	}
}

export async function expandActivityStep(page: Page, tool: string): Promise<Locator> {
	await expandAllRoutineGroups(page);
	const step = page.locator(`[data-testid="activity-step"][data-tool="${tool}"]`).first();
	await expect(step).toBeVisible();
	if ((await step.getAttribute("data-expanded")) !== "true") {
		await step.getByTestId("activity-step-toggle").click();
		await expect(step).toHaveAttribute("data-expanded", "true");
	}
	return step;
}

export function visibleTerminal(page: Page): Locator {
	return page.locator('[data-testid="terminal-instance"][data-visible="true"]');
}

export function visibleTerminalScreen(page: Page): Locator {
	return visibleTerminal(page).locator(".xterm-rows");
}

export async function waitTerminalReady(page: Page): Promise<void> {
	await expect(visibleTerminal(page)).toHaveAttribute("data-ready", "true");
}

export async function openTerminal(page: Page): Promise<void> {
	const tabs = page.getByTestId("terminal-tab");
	const previousCount = await tabs.count();
	await page.getByTestId("terminal-add").click();
	await expect(tabs).toHaveCount(previousCount + 1);
	await waitTerminalReady(page);
}

export async function runInTerminal(page: Page, command: string): Promise<void> {
	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	await page.keyboard.type(command);
	await page.keyboard.press("Enter");
}
