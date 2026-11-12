import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";
import { expectDialogContained } from "./fixtures/dialogContainment";

for (const size of [
	{ width: 1280, height: 420 },
	{ width: 360, height: 640 },
]) {
	test(`the Create workspace dialog stays in a ${size.width}x${size.height} window with its action in reach`, async ({
		page,
	}) => {
		await openFixtureProject(page);
		const dialog = page.getByTestId("new-workspace-dialog");
		await page.getByTestId("add-workspace").first().click();
		await expect(dialog).toBeVisible();

		await page.setViewportSize(size);
		await expectDialogContained(dialog);
		await expect(page.getByTestId("create-workspace")).toBeInViewport({ ratio: 1 });
		await expect(page.getByTestId("ws-prompt")).toBeInViewport({ ratio: 1 });
		const skills = page.getByTestId("ws-manage-skills");
		await skills.scrollIntoViewIfNeeded();
		await expect(skills).toBeInViewport({ ratio: 1 });
	});
}

test("the Create workspace slash menu opens above the prompt and stays in the window", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await dialog.getByTestId("ws-prompt").fill("/");
	const menu = dialog.getByTestId("slash-menu");
	await expect(menu).toBeInViewport({ ratio: 1 });
});
