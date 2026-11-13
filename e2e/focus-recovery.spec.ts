import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	openWorkspaceMenu,
	revealWorkbenchTool,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";
import { resolveBunExecutable } from "./fixtures/executables";
import { commitFile } from "./fixtures/git";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";

const USER_MCP_CONFIG = join(E2E_PI_AGENT_DIR, "mcp.json");
const STDIO_SERVER = fileURLToPath(
	new URL("../packages/server/src/agent/mcp/fixtures/stdioServer.ts", import.meta.url),
);

const fileRow = (page: Page, name: string) =>
	page.getByTestId("file-node").filter({ hasText: new RegExp(`^${name}[MAUR]?$`) });

async function sessionIdOfFirstChat(page: Page): Promise<string> {
	const sessionId = await page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.first()
		.getAttribute("data-session-id");
	if (!sessionId) throw new Error("chat tab exposes no session id");
	return sessionId;
}

function settleFrames(page: Page): Promise<void> {
	return page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
}

async function expectFocusInside(container: Locator): Promise<void> {
	await expect
		.poll(() => container.evaluate((element) => element.contains(document.activeElement)))
		.toBe(true);
}

test("deleting a file from the Files tree focuses the next file in its folder", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	mkdirSync(join(workspace.worktreePath, "focus"));
	for (const name of ["a.txt", "b.txt", "c.txt"]) {
		writeFileSync(join(workspace.worktreePath, "focus", name), `${name}\n`);
	}
	await revealWorkbenchTool(page, "files");
	await fileRow(page, "focus").click();
	await expect(fileRow(page, "b.txt")).toBeVisible();

	await fileRow(page, "b.txt").focus();
	await page.keyboard.press("Shift+F10");
	await page.getByTestId("file-tree-delete").click();
	await page.getByTestId("file-tree-delete-confirm").click();
	await expect(fileRow(page, "b.txt")).toHaveCount(0);
	await expect(fileRow(page, "c.txt")).toBeFocused();

	await page.keyboard.press("Shift+F10");
	await page.getByTestId("file-tree-delete").click();
	await page.getByTestId("file-tree-delete-confirm").click();
	await expect(fileRow(page, "c.txt")).toHaveCount(0);
	await expect(fileRow(page, "a.txt")).toBeFocused();
});

test("removing an MCP server in Settings focuses the next server's row inside the dialog", async ({
	page,
}) => {
	const entry = { command: resolveBunExecutable(), args: [STDIO_SERVER], enabled: false };
	writeFileSync(
		USER_MCP_CONFIG,
		JSON.stringify({ mcpServers: { "focus-alpha": entry, "focus-beta": entry } }),
	);
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		await page.getByTestId("open-settings").click();
		const dialog = page.getByTestId("settings-dialog");
		await page.getByTestId("settings-nav-mcp").click();
		const rows = page.getByTestId("mcp-server-row");
		await expect(rows).toHaveCount(2);
		const [first, second] = [rows.nth(0), rows.nth(1)];
		const secondName = await second.getAttribute("data-name");

		await first.getByTestId("mcp-server-menu").focus();
		await page.keyboard.press("Enter");
		await page.getByTestId("mcp-menu-remove").click();
		await page.getByTestId("mcp-remove-confirm").click();
		await expect(rows).toHaveCount(1);
		const remaining = page.locator(`[data-testid="mcp-server-row"][data-name="${secondName}"]`);
		await expect(remaining.getByTestId("mcp-server-menu")).toBeFocused();
		await expect(dialog).toBeVisible();

		await page.keyboard.press("Enter");
		await page.getByTestId("mcp-menu-remove").click();
		await page.getByTestId("mcp-remove-confirm").click();
		await expect(page.getByTestId("mcp-empty-add")).toBeFocused();
	} finally {
		rmSync(USER_MCP_CONFIG, { force: true });
	}
});

test("renaming a workspace with Enter returns focus to the workspace row", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const row = worktreeRows(page).first();
	await openWorkspaceMenu(row);
	await page.getByTestId("workspace-rename").click();
	const input = row.getByRole("textbox", { name: "Workspace name" });
	await expect(input).toBeFocused();
	await input.fill("Focus Kept");
	await input.press("Enter");
	await expect(row.getByTestId("workspace-name")).toHaveText("Focus Kept");
	await expect(row.locator("button[data-focus-row-primary]")).toBeFocused();
});

test("Plan's Show step focuses the step and Escape in add-task returns to its button", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const sessionId = await sessionIdOfFirstChat(page);
	const flagged = commitFile(workspace.worktreePath, "parse.ts", "export const a = 1;\n", "parser");
	const fixed = commitFile(workspace.worktreePath, "parse.ts", "export const a = 2;\n", "fix");
	const todosDir = join(workspace.worktreePath, ".thinkrail", "context", "todos");
	mkdirSync(todosDir, { recursive: true });
	const at = "2026-01-01T00:00:00Z";
	writeFileSync(
		join(todosDir, `${sessionId}.json`),
		JSON.stringify({
			version: 6,
			todos: [],
			groups: [
				{
					id: "g_1",
					title: "Ship the parser",
					todos: [
						{
							id: "t_flagged",
							title: "Implement parser",
							status: "done",
							origin: "agent",
							summary: "Recursive descent parser.",
							artifacts: [
								{ kind: "commit", sha: flagged, label: "Implement parser" },
								{ kind: "commit", sha: fixed, label: "Fix parser" },
							],
							createdAt: at,
							updatedAt: at,
						},
					],
				},
			],
		}),
	);
	writeFileSync(
		join(todosDir, `${sessionId}.reviews.json`),
		JSON.stringify({
			version: 1,
			items: {
				t_flagged: {
					state: "changes_requested",
					reviewedShas: [flagged],
					feedback: "Handle the empty input.",
					at,
				},
			},
		}),
	);
	await revealWorkbenchTool(page, "plan");
	await page.getByTestId("plan-rail-pane").getByTestId("todo-open-plan").click();
	const pane = page.getByTestId("plan-pane");
	await expect(pane.getByTestId("plan-next-action")).toHaveAttribute("data-kind", "fix");

	await pane.getByTestId("plan-next-action-go").click();
	const step = pane.getByTestId("plan-item").filter({ hasText: "Implement parser" });
	await expect(step.getByTestId("plan-item-toggle")).toBeFocused();

	await pane.getByTestId("plan-add-task").click();
	const input = pane.getByTestId("plan-add-input");
	await expect(input).toBeFocused();
	await input.press("Escape");
	await expect(input).toHaveCount(0);
	await expect(pane.getByTestId("plan-add-task")).toBeFocused();
});

test("the Markdown outline toggle keeps focus and an entry focuses its heading", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const filler = Array.from({ length: 40 }, () => "Filler paragraph.").join("\n\n");
	writeFileSync(
		join(workspace.worktreePath, "FOCUS.md"),
		`# Alpha\n\n${filler}\n\n# Gamma\n\n${filler}\n`,
	);
	await hideAuxiliaryWorkbench(page);
	await revealWorkbenchTool(page, "files");
	await fileRow(page, "FOCUS.md").dblclick();
	const outline = page.getByTestId("markdown-outline");
	await expect(outline).toBeVisible();
	const toggle = page.getByTestId("markdown-outline-toggle");

	await toggle.focus();
	await page.keyboard.press("Enter");
	await expect(outline).toHaveCount(0);
	await expect(toggle).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(outline).toBeVisible();
	await expect(toggle).toBeFocused();

	await outline.getByTestId("markdown-outline-entry").filter({ hasText: "Gamma" }).click();
	await expect(
		page.getByTestId("markdown-preview").getByRole("heading", { name: "Gamma" }),
	).toBeFocused();
});

test("Next at the last file of One file review hands focus to the previous control", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "README.md"), "# sample-project\n\nedited by e2e\n");
	writeFileSync(join(workspace.worktreePath, "notes.txt"), "a note edited by e2e\n");
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "notes.txt" }).click();
	await page.getByTestId("changes-review-layout-single").click();
	const counter = page.getByTestId("changes-review-counter");
	await expect(counter).toHaveText("1 / 2");

	const next = page.getByTestId("changes-review-next");
	await next.focus();
	await page.keyboard.press("Enter");
	await expect(counter).toHaveText("2 / 2");
	await expect(next).toBeDisabled();
	await expect(page.getByTestId("changes-review-prev")).toBeFocused();
});

test("a removed control with no list markup lands on its region's landing target", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
	await page.getByTestId("start-chat").first().click();
	const composer = page.getByTestId("chat-input");
	await expect(composer).toBeVisible();
	const center = page.locator('[data-region-kind="center"]').first();

	const inject = (id: string) =>
		center.evaluate((region, testId) => {
			const button = document.createElement("button");
			button.type = "button";
			button.dataset.testid = testId;
			button.textContent = testId;
			region.append(button);
		}, id);

	await inject("focus-recovery-probe");
	const probe = page.getByTestId("focus-recovery-probe");
	await probe.focus();
	await probe.evaluate((element) => element.remove());
	await expect(composer).toBeFocused();
	await expectFocusInside(center);

	await inject("focus-recovery-clicked-away");
	const clickedAway = page.getByTestId("focus-recovery-clicked-away");
	await clickedAway.focus();
	await clickedAway.blur();
	await settleFrames(page);
	await clickedAway.evaluate((element) => element.remove());
	await settleFrames(page);
	expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});
