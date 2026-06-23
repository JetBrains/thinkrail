import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

test("opens a git repo as a project via the directory picker", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	// "Open project" invokes the host's native directory picker — stubbed to E2E_FIXTURE_REPO in e2e.
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();

	await expect(
		page.getByTestId("project-item").filter({ hasText: basename(E2E_FIXTURE_REPO) }),
	).toBeVisible();
});
