import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	PHONE_VIEWPORT,
	revealWorkbenchTool,
} from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { pierreLines, selectPierreLine } from "./fixtures/pierre";

const worktree = () => join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");

async function goPhone(page: Page): Promise<void> {
	await page.setViewportSize(PHONE_VIEWPORT);
	await hideAuxiliaryWorkbench(page);
}

async function noHorizontalOverflow(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			),
		)
		.toBeLessThanOrEqual(0);
}

test("a phone-class viewport renders a code file with Pierre, swapping Monaco out and back with the viewport", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	await expect(page.locator(".monaco-editor").first()).toBeVisible();

	await goPhone(page);
	const fileView = page.getByTestId("file-view");
	await expect(fileView).toBeVisible();
	await expect(pierreLines(fileView, "plain-text-fixture")).toHaveCount(1);
	await expect(page.locator(".monaco-editor")).toHaveCount(0);
	await noHorizontalOverflow(page);

	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(page.locator(".monaco-editor").first()).toBeVisible();
	await expect(pierreLines(page.getByTestId("file-view"))).toHaveCount(0);
});

test("a phone-class diff is unified only, and a tapped line authors a thread that is placed inline", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	writeFileSync(
		join(worktree(), "script.ts"),
		"export const one = 1;\nexport const two = 2;\nexport const three = 3;\n",
	);
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	const diff = page.getByTestId("diff-view");
	await expect(diff.getByText("three = 3", { exact: false }).last()).toBeVisible();
	await expect(page.getByTestId("diff-toggle-split")).toBeVisible();

	await goPhone(page);
	await expect(diff.getByText("three = 3", { exact: false }).last()).toBeVisible();
	await expect(page.getByTestId("diff-toggle-split")).toHaveCount(0);
	await expect(page.getByTestId("diff-toggle-inline")).toHaveCount(0);
	await expect(page.getByTestId("hunk-toolbar").first()).toBeVisible();
	await noHorizontalOverflow(page);

	await selectPierreLine(diff, "two = 2");
	const composer = page.getByTestId("review-composer");
	await expect(composer).toBeVisible();
	await expect(composer).toContainText("Line 2");
	await page.getByTestId("review-composer-input").fill("From a phone.");
	await page.getByTestId("review-composer-save").click();
	await expect(composer).toHaveCount(0);

	const thread = page.getByTestId("review-thread-card");
	await expect(thread).toHaveCount(1);
	await expect(thread).toHaveAttribute("data-status", "draft");
	await expect(diff.getByTestId("review-thread-card")).toHaveCount(1);
	await expect(page.getByTestId("review-unplaced-strip")).toHaveCount(0);
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="diff"] [data-testid="review-tab-flag"]'),
	).toHaveAttribute("data-flag", "draft");
	await noHorizontalOverflow(page);

	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(diff.getByTestId("review-thread-card")).toHaveCount(1);
	await expect(page.getByTestId("diff-toggle-split")).toBeVisible();
	await revealWorkbenchTool(page, "review");
	await expect(page.getByTestId("review-comment")).toHaveCount(1);
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");

	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "script.ts" }).dblclick();
	await expect(page.locator(".monaco-editor").first()).toBeVisible();
	await goPhone(page);
	const fileView = page.getByTestId("file-view");
	await expect(fileView.getByTestId("review-thread-card")).toHaveCount(1);
	await expect(page.getByTestId("review-unplaced-strip")).toHaveCount(0);

	writeFileSync(join(worktree(), "script.ts"), "export const one = 1;\n");
	await expect(pierreLines(fileView, "two = 2")).toHaveCount(0);
	await expect(fileView.getByTestId("review-thread-card")).toHaveCount(0);
	await expect(page.getByTestId("review-unplaced-strip")).toBeVisible();
});
