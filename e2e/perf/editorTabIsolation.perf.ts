import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "../fixtures/app";
import {
	assertProfilingReady,
	attachRenderProfiler,
	detachRenderProfiler,
	type RenderProfile,
	readRenderProfile,
	resetRenderProfile,
} from "./renderProfiler";

// Pins shell/layout/SPEC.md's GroupTabBody contract against editor-tab cache writes.

function renders(profile: RenderProfile, component: string): number {
	return profile.components[component]?.renders ?? 0;
}

async function nextFrames(page: Page, count = 2): Promise<void> {
	await page.evaluate(async (frames) => {
		for (let frame = 0; frame < frames; frame += 1) await new Promise(requestAnimationFrame);
	}, count);
}

test.beforeEach(async ({ page, baseURL }) => {
	if (!baseURL) throw new Error("isolation proof needs a baseURL");
	await attachRenderProfiler(page, baseURL, {});
});

test.afterEach(async ({ page }) => {
	await detachRenderProfiler(page);
});

test("a review tab's own write re-renders only its body, never sibling bodies or the Changes list", async ({
	page,
}) => {
	await openFixtureProject(page);
	await assertProfilingReady(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "script.ts"), "export const edited = true;\n");
	await revealWorkbenchTool(page, "changes");
	const row = page.getByTestId("change-item").filter({ hasText: "script.ts" });
	await row.click();
	const section = page.locator('[data-testid="changes-section"][data-path="script.ts"]');
	await expect(section.getByTestId("changes-section-toggle")).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	await nextFrames(page);

	await resetRenderProfile(page);
	await section.getByTestId("changes-section-toggle").click();
	await expect(section).toHaveAttribute("data-collapsed", "true");
	await nextFrames(page);
	const profile = await readRenderProfile(page);

	expect(renders(profile, "ChangesReviewPane")).toBeGreaterThan(0);
	expect(renders(profile, "GroupTabBody")).toBe(0);
	expect(renders(profile, "ChangesPanel")).toBe(0);
});
