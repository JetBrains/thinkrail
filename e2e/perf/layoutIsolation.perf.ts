import { realpathSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "../fixtures/app";
import { E2E_FIXTURE_REPO } from "../fixtures/paths";
import { seedWorkspaceSession } from "../fixtures/sessions";
import { chatHistory } from "./chatReplay";
import {
	assertProfilingReady,
	attachRenderProfiler,
	detachRenderProfiler,
	MARKDOWN_SUBTREE,
	type RenderProfile,
	readRenderProfile,
	resetRenderProfile,
} from "./renderProfiler";

// Proves the workbench rerender isolation contract (shell/layout/SPEC.md): root-local resize churn
// and cross-region selection must not re-render other groups' mounted tab bodies. These counts are 0
// only because the group subtree is memoized and the tab body sits behind the GroupTabBody boundary;
// before that work every one of these was non-zero.

const SUBTREE_ROOTS = { [MARKDOWN_SUBTREE]: ["AssistantMarkdown", "Markdown"] };

function renders(profile: RenderProfile, component: string): number {
	return profile.components[component]?.renders ?? 0;
}

// The expensive chat body (and its markdown subtree) must never re-render, and the memoized
// GroupTabBody boundary must skip. This holds even when the enclosing group view legitimately
// re-renders (e.g. a resize that changes the center's own width fires its size observer).
function bodyIsolated(profile: RenderProfile): void {
	expect(renders(profile, "ChatResourceBody")).toBe(0);
	expect(profile.subtrees[MARKDOWN_SUBTREE]?.rootRenders ?? 0).toBe(0);
	expect(renders(profile, "GroupTabBody")).toBe(0);
}

async function openCenterChat(page: Page): Promise<void> {
	await openFixtureProject(page);
	await assertProfilingReady(page);
	const title = "Isolation chat";
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: title,
		messages: chatHistory(1_700_900_000_000, 12),
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, title);
	const chat = page.getByTestId("chat-scroll");
	await expect(chat).toBeVisible();
	await expect(
		chat.locator('[data-testid="chat-message"][data-role="assistant"]').first(),
	).toBeVisible();
}

async function nextFrames(page: Page, count = 2): Promise<void> {
	await page.evaluate(async (frames) => {
		for (let frame = 0; frame < frames; frame += 1) await new Promise(requestAnimationFrame);
	}, count);
}

// Drag a resize handle, but sample the profiler only across the live move phase (after pointer-down,
// before pointer-up) — the drag projection is root-local there and must not reach the bodies. The
// pointer-up commit legitimately changes the document and is intentionally excluded.
async function profileResizeMoves(page: Page, handle: Locator): Promise<RenderProfile> {
	const box = await handle.boundingBox();
	if (!box) throw new Error("resize handle has no bounding box");
	const startX = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await resetRenderProfile(page);
	for (let step = 1; step <= 8; step += 1) {
		await page.mouse.move(startX - step * 10, y, { steps: 2 });
		await nextFrames(page, 1);
	}
	const profile = await readRenderProfile(page);
	await page.mouse.up();
	return profile;
}

test.beforeEach(async ({ page, baseURL }) => {
	if (!baseURL) throw new Error("isolation proof needs a baseURL");
	await attachRenderProfiler(page, baseURL, SUBTREE_ROOTS);
});

test.afterEach(async ({ page }) => {
	await detachRenderProfiler(page);
});

test("resizing a side panel does not re-render the center chat body", async ({ page }) => {
	await openCenterChat(page);
	const handle = page.getByTestId("resize-right");
	await expect(handle).toBeVisible();

	const profile = await profileResizeMoves(page, handle);

	// The drag must have driven real React commits (the root re-renders on each projection frame)…
	expect(profile.commits).toBeGreaterThan(0);
	// …while every body stayed put.
	bodyIsolated(profile);
});

test("focusing another region does not re-render the center chat body", async ({ page }) => {
	await openCenterChat(page);
	const chat = page.getByTestId("chat-scroll");
	const projects = page.getByTestId("left-nav");
	await expect(projects).toBeVisible();

	// Focus the center first, then shift focus to the projects region so attention actually changes.
	await chat.click();
	await nextFrames(page);
	await resetRenderProfile(page);
	await projects.click();
	await nextFrames(page);
	const profile = await readRenderProfile(page);

	// A cross-region focus change re-renders nothing in the center: the group view keeps its
	// selectedId and skips, and the body behind it never runs.
	bodyIsolated(profile);
	expect(renders(profile, "CenterGroupView")).toBe(0);
});
