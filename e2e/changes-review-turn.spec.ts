import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openPersistedChat,
	revealWorkbenchTool,
} from "./fixtures/app";
import { commitFile } from "./fixtures/git";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const reviewTab = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="changes"]');

test("Review turn on a pruned snapshot opens that turn's review tab even when the Changes tool is not mounted", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	commitFile(
		workspace.worktreePath,
		"feature.ts",
		"export const feature = true;\n",
		"agent: add the feature",
	);
	const promptAt = 1_700_000_000_000;
	const seeded = seedWorkspaceSession(workspace.worktreePath, {
		name: "Add the feature flag",
		messages: [
			{ role: "user", text: "add the feature flag", timestamp: promptAt },
			{ role: "assistant", text: "Added feature.ts with the flag.", timestamp: promptAt + 4_000 },
		],
	});
	writeFileSync(
		join(E2E_DATA_DIR, "turns.json"),
		JSON.stringify({
			version: 1,
			byWorkspace: {
				[workspace.id]: [
					{
						id: `${seeded.id}:${promptAt + 500}`,
						workspaceId: workspace.id,
						sessionId: seeded.id,
						startedAt: promptAt + 500,
						settledAt: promptAt + 3_500,
						baseTree: "a".repeat(40),
						headTree: "b".repeat(40),
						changes: [{ path: "feature.ts", status: "added", added: 1, removed: 0 }],
					},
				],
			},
		}),
	);

	await page.reload();
	await openPersistedChat(page, "Add the feature flag");
	await revealWorkbenchTool(page, "review");
	await expect(page.getByTestId("changes-view-toggle")).toHaveCount(0);

	await page.getByTestId("turn-divider").first().getByTestId("turn-divider-review").click();
	await expect(page.getByTestId("changes-review-error")).toContainText(
		"That agent turn's snapshot is no longer in this repository.",
	);
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(page.getByTestId("changes-review-scope")).toContainText("Last turn");
});
