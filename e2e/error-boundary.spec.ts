import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// A failed lazy chunk must degrade the ONE panel, not blank the app. We simulate a stale/unreachable
// chunk by aborting the editor's dynamic-import request at the network layer (no prod fault-injection
// code) — the rejected `import()` throws through Suspense into the per-tab ErrorBoundary, which
// classifies it as a chunk-load error and offers a page reload.
test("a failed editor chunk shows the boundary's reload fallback and keeps the shell alive", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	// Abort the lazily-loaded Monaco chunk (Vite default name: `assets/MonacoEditor-<hash>.js`).
	await page.route(/MonacoEditor.*\.js(\?.*)?$/, (route) => route.abort());

	await page.getByTestId("tab-files").click();
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	// Plain text → straight to the Monaco editor path, whose chunk we just blocked.
	await notes.dblclick();

	// The boundary catches it and, because it's a chunk-load failure, offers a reload (not a retry).
	const fallback = page.getByTestId("error-boundary-fallback");
	await expect(fallback).toBeVisible();
	await expect(fallback).toContainText("editor");
	await expect(page.getByTestId("error-reload")).toBeVisible();
	await expect(page.getByTestId("error-retry")).toHaveCount(0);

	// Containment: the crash stayed inside the center pane — the tab strip and the rest of the shell live.
	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toBeVisible();
	await expect(page.getByTestId("shell")).toBeVisible();
	await expect(page.getByTestId("right-panel")).toBeVisible();
});
