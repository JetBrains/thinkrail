import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

test("opens a git repo as a project and lists it", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("open-project-dialog")).toBeVisible();
	await page.getByTestId("add-project-input").fill(E2E_FIXTURE_REPO);
	await page.getByTestId("add-project-submit").click();

	await expect(
		page.getByTestId("project-item").filter({ hasText: basename(E2E_FIXTURE_REPO) }),
	).toBeVisible();
});
