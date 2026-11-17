import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

function writeWiki(root: string, files: Record<string, string>): void {
	const dir = join(root, "graphify-out", "wiki");
	mkdirSync(dir, { recursive: true });
	for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
}

test("the Repository wiki page reads a Graphify wiki, follows its links and returns to the workbench", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);

	await page.getByTestId("open-wiki").click();
	await expect(page.getByTestId("wiki-page")).toBeVisible();
	await expect(page.getByTestId("wiki-empty")).toBeVisible();
	await expect(page.getByTestId("wiki-build-panel")).toBeVisible();
	await expect(page.getByTestId("wiki-publish")).toBeDisabled();

	writeWiki(workspace.worktreePath, {
		"index.md":
			"# Knowledge Graph Index\n\n- [Core ideas](Core_ideas.md)\n- [Elsewhere](https://example.com/x)\n",
		"Core_ideas.md": "# Core ideas\n\nThe load-bearing concepts.\n\n[Back](index.md)\n",
	});
	await page.getByTestId("wiki-refresh").click();

	await expect(page.getByTestId("wiki-page-row")).toHaveCount(2);
	await expect(page.getByTestId("wiki-article")).toContainText("Knowledge Graph Index");
	await expect(page.getByTestId("wiki-meta")).toContainText("2 pages");
	await expect(page.getByTestId("wiki-publish")).toBeDisabled();

	await page.getByTestId("wiki-link").filter({ hasText: "Core ideas" }).click();
	await expect(page.getByTestId("wiki-article")).toHaveAttribute("data-path", "Core_ideas.md");
	await expect(page.getByTestId("wiki-article")).toContainText("The load-bearing concepts.");

	await page.getByTestId("wiki-filter").fill("index");
	await expect(page.getByTestId("wiki-page-row")).toHaveCount(1);

	await page.getByTestId("wiki-build-toggle").click();
	await expect(page.getByTestId("wiki-build-panel")).toBeVisible();
	await expect(page.getByTestId("wiki-code-only")).toHaveAttribute("data-active", "true");

	await page.getByTestId("wiki-back").click();
	await expect(page.getByTestId("wiki-page")).toHaveCount(0);
	await expect(page.getByTestId("shell")).toBeVisible();
});
