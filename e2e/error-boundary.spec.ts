import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";

test("a failed editor chunk shows the boundary's reload fallback and keeps the shell alive", async ({
	page,
}) => {
	await page.route(/MonacoEditor.*\.js(\?.*)?$/, (route) => route.abort());
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	await revealWorkbenchTool(page, "files");
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	await notes.dblclick();

	const fallback = page.getByTestId("error-boundary-fallback");
	await expect(fallback).toBeVisible();
	await expect(fallback).toContainText("editor");
	await expect(page.getByTestId("error-reload")).toBeVisible();
	await expect(page.getByTestId("error-retry")).toHaveCount(0);

	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toBeVisible();
	await expect(page.getByTestId("shell")).toBeVisible();
	await expect(page.getByTestId("right-panel")).toBeVisible();
});

test("an editor preload that failed while offline recovers through the boundary's reload", async ({
	page,
}) => {
	let aborted = 0;
	const editorChunk = /MonacoEditor.*\.js(\?.*)?$/;
	await page.route(editorChunk, (route) => {
		aborted += 1;
		return route.abort();
	});
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect.poll(() => aborted).toBeGreaterThan(0);
	await page.unroute(editorChunk);

	await revealWorkbenchTool(page, "files");
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await notes.dblclick();

	const pane = page.locator('[data-testid="editor-pane"]:visible');
	const reload = page.getByTestId("error-reload");
	await expect(reload).toBeVisible();
	await reload.click();
	await expect(page.getByTestId("shell")).toBeVisible();
	const tab = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	await expect(tab).toBeVisible();
	await tab.click();
	await expect(pane).toContainText("plain-text-fixture");
	await expect(page.getByTestId("error-boundary-fallback")).toHaveCount(0);
});
