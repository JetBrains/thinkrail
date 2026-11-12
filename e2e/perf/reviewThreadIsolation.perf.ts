import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "../fixtures/app";
import { E2eWire } from "../fixtures/wire";
import {
	assertProfilingReady,
	attachRenderProfiler,
	detachRenderProfiler,
	type RenderProfile,
	readRenderProfile,
	resetRenderProfile,
} from "./renderProfiler";

// Pins panels/SPEC.md's per-file review threads: a comment on another file re-renders no open renderer.

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

test("a review comment on another file re-renders no open file's renderer", async ({ page }) => {
	await openFixtureProject(page);
	await assertProfilingReady(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "open.ts"), "export const openFile = 1;\n");
	writeFileSync(join(workspace.worktreePath, "other.ts"), "export const otherFile = 1;\n");
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "open.ts" }).dblclick();
	await expect(page.locator(".monaco-editor .view-lines").first()).toContainText("openFile");
	await revealWorkbenchTool(page, "review");
	await nextFrames(page);

	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await resetRenderProfile(page);
		await wire.request("review.commentAdd", {
			workspaceId: workspace.id,
			kind: "inline",
			anchor: {
				path: "other.ts",
				side: "worktree",
				selectors: [{ kind: "lineRange", startLine: 1, endLine: 1 }],
			},
			body: "A remark on another file.",
		});
		await expect(
			page.locator('[data-testid="review-file-section"][data-path="other.ts"]'),
		).toContainText("1 draft");
		await nextFrames(page);
		const profile = await readRenderProfile(page);

		expect(renders(profile, "ReviewPanel")).toBeGreaterThan(0);
		expect(renders(profile, "MonacoEditor")).toBe(0);
	} finally {
		wire.close();
	}
});
