import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { commitFile } from "./fixtures/git";
import { E2eWire } from "./fixtures/wire";

test("Settings opened from the keyboard returns focus to its gear after Escape", async ({
	page,
}) => {
	await page.clock.install();
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	const gear = page.getByTestId("open-settings");
	await gear.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await page.clock.pauseAt(Math.ceil(Date.now() / 1000) * 1000 + 1000);
	await page.keyboard.press("Escape");
	await page.clock.runFor(1);
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
	await expect(gear).toBeFocused();
});

test("a changed file returns focus from its stale review composer to the review surface", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const file = "focus.ts";
	commitFile(workspace.worktreePath, file, "export const value = 1;\n", "seed focus review");
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("workspace.setDiffBase", { id: workspace.id, ref: "HEAD" });
	} finally {
		wire.close();
	}
	writeFileSync(join(workspace.worktreePath, file), "export const value = 2;\n");
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: file }).dblclick();
	const cursor = page.getByTestId("diff-view").getByTestId("review-cursor");
	await expect(page.getByTestId("diff-view")).toContainText("value = 2");
	await cursor.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("review-composer-input")).toBeFocused();
	await page.keyboard.type("Unfinished review");
	writeFileSync(join(workspace.worktreePath, file), "export const value = 3;\n");
	const notice = page.getByTestId("review-selection-stale");
	await expect(notice).toBeVisible();
	await expect(cursor).toBeFocused();
});
