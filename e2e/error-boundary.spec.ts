import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("a failed editor chunk shows the boundary's reload fallback and keeps the shell alive", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	await page.route(/MonacoEditor.*\.js(\?.*)?$/, (route) => route.abort());

	await page.getByTestId("tab-files").click();
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
