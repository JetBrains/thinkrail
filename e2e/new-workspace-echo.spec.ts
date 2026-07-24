import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

test("clean repo: the static stays-behind line shows, without counts", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();
	await expect(page.getByTestId("stays-behind")).toContainText("stay behind");
	await expect(page.getByTestId("stays-behind-counts")).toHaveCount(0);
});

test("dirty repo: real untracked counts + the .env hooks nudge", async ({ page }) => {
	await openFixtureProject(page);
	// Dirty the PROJECT ROOT after reset: two untracked files, one env-ish. resetState only re-seeds a
	// BROKEN repo (fixtureRepoHealthy) — it never git-cleans a merely dirty working tree — so this test
	// cleans up after itself.
	const envPath = join(E2E_FIXTURE_REPO, ".env");
	const notesPath = join(E2E_FIXTURE_REPO, "notes.todo");
	writeFileSync(envPath, "SECRET=1\n");
	writeFileSync(notesPath, "remember\n");
	try {
		await page.getByTestId("add-workspace").first().click();
		await expect(page.getByTestId("stays-behind-counts")).toContainText("2 untracked");
		await expect(page.getByTestId("stays-behind-env")).toContainText(".env won't travel");
	} finally {
		rmSync(envPath, { force: true });
		rmSync(notesPath, { force: true });
	}
});
