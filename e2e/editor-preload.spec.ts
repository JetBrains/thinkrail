import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	revealWorkbenchTool,
} from "./fixtures/app";

function loadedResources(page: Page, pattern: RegExp) {
	return page.evaluate(
		(source) =>
			performance
				.getEntriesByType("resource")
				.filter((entry) => new RegExp(source).test(entry.name)).length,
		pattern.source,
	);
}

test("an idle-preloaded editor opens the first clicked file without a loading fallback", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "first.ts"), "export const firstOpen = 1;\n");
	await revealWorkbenchTool(page, "files");
	const row = page.getByTestId("file-node").filter({ hasText: "first.ts" });
	await expect(row).toBeVisible();

	await expect.poll(() => loadedResources(page, /MonacoEditor[^/]*\.js/)).toBeGreaterThan(0);
	await expect.poll(() => loadedResources(page, /\.wasm(\?|$)/)).toBeGreaterThan(0);

	await page.evaluate(() => {
		const seen = { fallback: false };
		Reflect.set(window, "__paneFallback", seen);
		new MutationObserver(() => {
			if (document.querySelector('[data-testid="file-pane-loading"]')) seen.fallback = true;
		}).observe(document.body, { subtree: true, childList: true });
	});
	await row.click();

	const pane = page.locator('[data-testid="editor-pane"]:visible');
	await expect(pane).toContainText("firstOpen");
	await expect(
		pane.locator(".view-line span span").filter({ hasText: /^export$/ }),
	).not.toHaveClass(/\bmtk1\b/);
	expect(
		await page.evaluate(() => Reflect.get(Reflect.get(window, "__paneFallback"), "fallback")),
	).toBe(false);
	expect(pageErrors).toEqual([]);
});

const PAST_IDLE_PRELOAD_MS = 5_000;

test("a phone viewport never preloads the Monaco editor, a desktop one does", async ({ page }) => {
	const editorChunk = /MonacoEditor[^/]*\.js(\?|$)/;
	const editorRequests: string[] = [];
	page.on("request", (request) => {
		if (editorChunk.test(request.url())) editorRequests.push(request.url());
	});
	await page.clock.install();
	await page.setViewportSize({ width: 390, height: 844 });
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);

	await page.clock.runFor(PAST_IDLE_PRELOAD_MS);
	await page.evaluate(() => fetch("/health").then(() => undefined));
	expect(editorRequests).toEqual([]);

	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await page.clock.runFor(PAST_IDLE_PRELOAD_MS);
	await expect.poll(() => editorRequests.length).toBeGreaterThan(0);
});
