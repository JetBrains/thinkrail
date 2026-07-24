import { writeFileSync } from "node:fs";
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
	// Dirty the PROJECT ROOT after reset: two untracked files, one env-ish. resetState cleans up.
	writeFileSync(join(E2E_FIXTURE_REPO, ".env"), "SECRET=1\n");
	writeFileSync(join(E2E_FIXTURE_REPO, "notes.todo"), "remember\n");
	await page.getByTestId("add-workspace").first().click();
	await expect(page.getByTestId("stays-behind-counts")).toContainText("2 untracked");
	await expect(page.getByTestId("stays-behind-env")).toContainText(".env won't travel");
});
