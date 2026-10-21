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

// Pins resource-renderers' per-slot review-draft subscription: a keystroke re-renders its composer only.

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

test("typing in a Changes composer re-renders the composer, not the diff surface or its hunk toolbars", async ({
	page,
}) => {
	await openFixtureProject(page);
	await assertProfilingReady(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(
		join(workspace.worktreePath, "isolation.ts"),
		Array.from({ length: 40 }, (_, line) => `export const value${line} = ${line};`).join("\n"),
	);
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "isolation.ts" }).click();
	const section = page.locator('[data-testid="changes-section"][data-path="isolation.ts"]');
	await section.getByTestId("hunk-ask-agent").first().click();
	const input = section.getByTestId("review-composer-input");
	await expect(input).toBeVisible();
	await input.press("End");
	await input.pressSequentially(" a");
	await expect(input).toHaveValue(/ a$/);
	await nextFrames(page);

	await resetRenderProfile(page);
	await input.pressSequentially("bcdef");
	await expect(input).toHaveValue(/ abcdef$/);
	await nextFrames(page);
	const profile = await readRenderProfile(page);

	expect(renders(profile, "ReviewComposer")).toBeGreaterThan(0);
	expect(renders(profile, "PierreDiffSurface")).toBe(0);
	expect(renders(profile, "HunkToolbar")).toBe(0);
});
