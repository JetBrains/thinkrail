import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// The read-only Specs viewer: the right rail's Specs tab renders the worktree's spec-graph as its
// parent tree (fixture: sample-root → sample-module, seeded in global-setup), and double-clicking a
// node opens the spec file as a center editor tab — same flow as the file tree.
test("Specs tab renders the worktree's spec tree and opens a spec as an editor tab", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);

	// Specs sits left of All files / Changes — and is the default tab.
	const tabs = page.locator('[data-testid="tab-specs"], [data-testid="tab-files"]');
	await expect(tabs.first()).toHaveAttribute("data-testid", "tab-specs");
	await expect(page.getByTestId("tab-specs")).toHaveAttribute("data-active", "true");

	// The parent tree: the root spec at depth 0, its child nested at depth 1.
	const root = page.getByTestId("spec-node").filter({ hasText: "Sample Project" });
	const child = page.getByTestId("spec-node").filter({ hasText: "Sample Module" });
	await expect(root).toHaveAttribute("data-depth", "0");
	await expect(child).toHaveAttribute("data-depth", "1");
	await expect(child).toContainText("active"); // status badge

	// The chevron alone collapses/expands; a row single-click is inert (reserved for select-later).
	await root.click();
	await expect(child).toBeVisible();
	const rootToggle = page.locator("li", { has: root }).getByTestId("spec-toggle").first();
	await rootToggle.click();
	await expect(child).toHaveCount(0);
	await rootToggle.click();
	await expect(child).toBeVisible();

	// Double-click the child → its SPEC.md opens as a center editor tab.
	await child.dblclick();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "SPEC.md" })).toBeVisible();
	await expect(page.getByTestId("editor-pane")).toContainText("sample-root");

	// A spec added outside the app (agent/git/editor) appears after the header Refresh — the host
	// revalidates per read, the button just re-fetches.
	const worktree = workspace.worktreePath;
	mkdirSync(join(worktree, "module-b"), { recursive: true });
	writeFileSync(
		join(worktree, "module-b", "SPEC.md"),
		"---\nid: sample-module-b\ntype: module-design\ntitle: Sample Module B\nparent: sample-root\n---\n\n## Responsibility\n\nAdded mid-session by the e2e suite.\n",
	);
	await expect(page.getByTestId("spec-node").filter({ hasText: "Sample Module B" })).toHaveCount(0);
	await page.getByTestId("specs-refresh").click();
	await expect(page.getByTestId("spec-node").filter({ hasText: "Sample Module B" })).toBeVisible();
});
