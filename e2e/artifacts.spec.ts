import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	loadPersistedWorkspaces,
	openFixtureProject,
	openWorkspaceChat,
	revealWorkbenchTool,
} from "./fixtures/app";

const CONTEXT = ".thinkrail/context";

function artifact(page: Page, path: string) {
	return page.locator(`[data-testid="artifact-row"][data-path="${CONTEXT}/${path}"]`);
}

function writeArtifact(root: string, path: string, content: string): void {
	const file = join(root, CONTEXT, path);
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, content);
}

async function showArtifacts(page: Page): Promise<void> {
	await revealWorkbenchTool(page, "artifacts");
	await page.getByTestId("artifacts-filter-all").click();
	await expect(page.getByTestId("artifacts-filter-all")).toHaveAttribute("data-active", "true");
}

async function rowAction(page: Page, path: string, action: string): Promise<void> {
	await artifact(page, path).getByTestId("artifact-open").click({ button: "right" });
	await page.getByTestId(action).click();
}

test("the Artifacts tab keeps what the agent left: a deleted file stays restorable, the user's delete and rename stick", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	writeArtifact(root, "report.md", "# Report\n");
	writeArtifact(root, "mockups/a.html", "<h1>a</h1>\n");
	await revealWorkbenchTool(page, "artifacts");

	await expect(page.getByTestId("artifacts-filter-chat")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("artifact-row")).toHaveCount(0);
	await expect(page.getByTestId("artifacts-other-chats")).toContainText("2 more from other chats");
	await page.getByTestId("artifacts-show-all").click();
	await expect(artifact(page, "report.md")).toBeVisible();
	await expect(page.getByTestId("artifacts-other-chats")).toHaveCount(0);
	await expect(artifact(page, "report.md").locator("[title^='Changed ']")).toHaveCount(1);
	await expect(artifact(page, "report.md")).not.toContainText("just now");
	await expect(artifact(page, "mockups/a.html")).toContainText("mockups");
	await expect(page.locator('[data-testid="artifact-row"][data-path$="/.gitignore"]')).toHaveCount(
		0,
	);

	rmSync(join(root, CONTEXT, "report.md"));
	await expect(artifact(page, "report.md")).toHaveAttribute("data-state", "deleted", {
		timeout: 10_000,
	});
	await expect(artifact(page, "report.md")).toContainText("Deleted, not by you");
	await artifact(page, "report.md").getByTestId("artifact-restore").click();
	await expect(artifact(page, "report.md")).toHaveAttribute("data-state", "live");
	expect(readFileSync(join(root, CONTEXT, "report.md"), "utf8")).toBe("# Report\n");

	await rowAction(page, "report.md", "artifact-rename");
	const input = page.getByTestId("artifact-name-input");
	await input.fill("summary.md");
	await input.press("Enter");
	await expect(artifact(page, "summary.md")).toBeVisible();
	await expect(artifact(page, "report.md")).toHaveCount(0);
	expect(readFileSync(join(root, CONTEXT, "summary.md"), "utf8")).toBe("# Report\n");

	await rowAction(page, "mockups/a.html", "artifact-delete");
	await expect(page.getByTestId("confirm-dialog")).toContainText("Delete a.html?");
	await page.getByTestId("artifact-delete-confirm").click();
	await expect(artifact(page, "mockups/a.html")).toHaveCount(0);
	expect(existsSync(join(root, CONTEXT, "mockups", "a.html"))).toBe(false);

	await artifact(page, "summary.md").getByTestId("artifact-open").click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="file"]').filter({ hasText: "summary.md" }),
	).toBeVisible();
});

test("a new artifact lights the rail until the tab is opened, and a cut file pastes into artifacts", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	await revealWorkbenchTool(page, "artifacts");
	await expect(page.getByTestId("artifacts-empty")).toBeVisible();
	await revealWorkbenchTool(page, "files");

	const dot = page.getByTestId("tool-rail-artifacts").getByTestId("artifacts-new-dot");
	await expect(dot).toHaveCount(0);
	writeArtifact(root, "notes.md", "notes\n");
	await expect(dot).toBeVisible({ timeout: 10_000 });

	await showArtifacts(page);
	await expect(artifact(page, "notes.md")).toHaveAttribute("data-fresh", "true");
	await expect(dot).toHaveCount(0);

	writeFileSync(join(root, "todo.txt"), "move me\n");
	await revealWorkbenchTool(page, "files");
	const todo = page.getByTestId("file-node").filter({ hasText: /^todo\.txt/ });
	await todo.click({ button: "right" });
	await page.getByTestId("file-tree-cut").click();
	await showArtifacts(page);
	await page.getByTestId("artifacts-paste").click();
	await expect(artifact(page, "todo.txt")).toBeVisible();
	expect(existsSync(join(root, "todo.txt"))).toBe(false);
	expect(readFileSync(join(root, CONTEXT, "todo.txt"), "utf8")).toBe("move me\n");
	await expect(page.getByTestId("artifacts-paste")).toHaveCount(0);
});

test("Mention in chat from the keyboard puts the path into the open chat's composer, closing its history", async ({
	page,
}) => {
	const workspace = await openWorkspaceChat(page);
	writeArtifact(workspace.worktreePath, "plan.md", "plan\n");
	await showArtifacts(page);
	await page.getByTestId("chat-input").focus();
	await page.keyboard.press("Control+r");
	await expect(page.getByTestId("history-overlay")).toBeVisible();
	await artifact(page, "plan.md").getByTestId("artifact-open").focus();
	await page.keyboard.press("Shift+F10");
	await page.getByTestId("artifact-mention").press("Enter");
	await expect(page.getByTestId("history-overlay")).toHaveCount(0);
	await expect(page.getByTestId("chat-input")).toBeFocused();
	await expect(page.getByTestId("chat-input")).toHaveValue(`@${CONTEXT}/plan.md `);
});

test("a workspace without agent runs shows no ignored outputs, and its remove dialog counts its artifacts", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeArtifact(workspace.worktreePath, "a.md", "a\n");
	writeArtifact(workspace.worktreePath, "b.md", "b\n");
	await showArtifacts(page);
	await expect(page.getByTestId("artifact-row")).toHaveCount(2);
	await expect(page.getByTestId("artifacts-outputs-section")).toHaveCount(0);

	await page.getByTestId("scope-workspace").click();
	await page.getByTestId("scope-workspace-menu").getByTestId("scope-workspace-remove").click();
	await expect(page.getByTestId("remove-workspace-artifacts")).toHaveText(
		"Its 2 artifacts are deleted with it.",
	);
	await page.getByRole("button", { name: "Cancel" }).click();
});

test("F6 into the Artifacts group lands on the list, not on its chat filter", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	const root = loadPersistedWorkspaces().find((workspace) => workspace.kind === "default");
	if (!root) throw new Error("no Default workspace was persisted");
	writeArtifact(root.worktreePath, "notes.md", "notes\n");
	await revealWorkbenchTool(page, "artifacts");
	await expect(artifact(page, "notes.md")).toBeVisible();
	const body = page.locator('[data-tool-body="artifacts"]');
	for (let press = 0; press < 12; press++) {
		if (await body.evaluate((element) => element.contains(document.activeElement))) break;
		await page.keyboard.press("F6");
	}
	await expect(artifact(page, "notes.md").getByTestId("artifact-open")).toBeFocused();
});
