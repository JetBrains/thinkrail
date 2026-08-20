import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("Specs tab renders the worktree's spec tree and opens a spec as an editor tab", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);

	const tabs = page.locator('[data-testid="tab-specs"], [data-testid="tab-files"]');
	await expect(tabs.first()).toHaveAttribute("data-testid", "tab-specs");
	await expect(page.getByTestId("tab-specs")).toHaveAttribute("data-active", "true");

	const root = page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]');
	const child = page.locator('[data-testid="spec-node"][data-spec-id="sample-module"]');
	await expect(root).toHaveAttribute("data-depth", "0");
	await expect(root).toHaveAttribute("data-main-spec", "true");
	await expect(root).toHaveAttribute("data-spec-role", "Main spec");
	await expect(root).toContainText("Main spec");
	await expect(child).toHaveAttribute("data-depth", "1");
	await expect(child).toHaveAttribute("data-spec-role", "MODULE");
	await expect(child).toContainText("MODULE");

	expect(await child.getAttribute("data-status")).toBeNull();
	await expect(child).not.toContainText("active");
	await expect(page.getByTestId("spec-status")).toHaveCount(0);
	await expect(page.getByTestId("spec-tree-branch")).toHaveCount(0);
	await expect(page.getByTestId("spec-tree-rail")).toHaveCount(0);
	const rootLeft = await root.evaluate((element) => element.getBoundingClientRect().left);
	const childLeft = await child.evaluate((element) => element.getBoundingClientRect().left);
	expect(childLeft - rootLeft).toBeGreaterThanOrEqual(10);
	expect(
		await root.evaluate((element) => element.getBoundingClientRect().height),
	).toBeLessThanOrEqual(30);

	await root.click();
	await expect(page.getByTestId("editor-pane")).toContainText("throwaway fixture project");
	await expect(root).toHaveAttribute("data-active", "true");
	await expect(child).toBeVisible();

	const rootToggle = page.locator("li", { has: root }).getByTestId("spec-toggle").first();
	await rootToggle.click();
	await expect(child).toHaveCount(0);
	await rootToggle.click();
	await expect(child).toBeVisible();

	await child.click();
	await expect(page.getByTestId("editor-pane")).toContainText("sample-root");
	await expect(child).toHaveAttribute("data-active", "true");
	await expect(root).toHaveAttribute("data-active", "false");

	const worktree = workspace.worktreePath;
	mkdirSync(join(worktree, "module-b"), { recursive: true });
	writeFileSync(
		join(worktree, "module-b", "SPEC.md"),
		"---\nid: sample-module-b\ntype: module-design\ntitle: Sample Module B\nparent: sample-root\n---\n\n## Responsibility\n\nAdded mid-session by the e2e suite.\n",
	);
	mkdirSync(join(worktree, "module-a", "submodule"), { recursive: true });
	writeFileSync(
		join(worktree, "module-a", "submodule", "SPEC.md"),
		"---\nid: sample-submodule\ntype: submodule-design\ntitle: Sample Submodule\nparent: sample-module\n---\n\n## Responsibility\n\nNested beneath the first module.\n",
	);
	const moduleB = page.locator('[data-testid="spec-node"][data-spec-id="sample-module-b"]');
	const submodule = page.locator('[data-testid="spec-node"][data-spec-id="sample-submodule"]');
	await expect(moduleB).toBeVisible();
	await expect(submodule).toBeVisible();
	await expect(page.getByTestId("specs-refresh")).toBeVisible();
	await page.getByTestId("specs-refresh").click();
	await expect(moduleB).toBeVisible();
	await expect(submodule).toBeVisible();
	await expect(submodule).toHaveAttribute("data-depth", "2");
	await expect(submodule).toHaveAttribute("data-spec-role", "SUBMODULE");
	const childLeftAfterRefresh = await child.evaluate(
		(element) => element.getBoundingClientRect().left,
	);
	const moduleBLeft = await moduleB.evaluate((element) => element.getBoundingClientRect().left);
	const submoduleLeft = await submodule.evaluate((element) => element.getBoundingClientRect().left);
	expect(Math.abs(moduleBLeft - childLeftAfterRefresh)).toBeLessThanOrEqual(1);
	expect(submoduleLeft - childLeftAfterRefresh).toBeGreaterThanOrEqual(10);
	await expect(page.getByTestId("spec-tree-branch")).toHaveCount(0);
	await expect(page.getByTestId("spec-tree-rail")).toHaveCount(0);
});
