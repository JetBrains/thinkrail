import { expect, type Page, test } from "@playwright/test";
import { installChannelHold } from "./fixtures/channelHold";

async function openChatSettings(page: Page): Promise<void> {
	if (!(await page.getByTestId("settings-dialog").isVisible())) {
		await page.getByTestId("open-settings").click();
	}
	await page.getByTestId("settings-nav-chat").click();
	await expect(page.getByTestId("settings-auto-resume")).toBeVisible();
}

async function disableAutoResume(page: Page): Promise<void> {
	if (page.isClosed()) return;
	if (await page.getByTestId("settings-dialog").isVisible()) await page.keyboard.press("Escape");
	await openChatSettings(page);
	const toggle = page.getByTestId("auto-resume-toggle");
	if ((await toggle.getAttribute("data-active")) === "true") {
		await toggle.click();
		await expect(toggle).toHaveAttribute("data-active", "false");
	}
	await page.keyboard.press("Escape");
}

test("automatic continuation validates, converges on the host broadcast, and persists", async ({
	page,
}) => {
	const channelHold = await installChannelHold(page);
	let release = () => {};
	try {
		await page.goto("/");
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await disableAutoResume(page);
		await openChatSettings(page);
		const toggle = page.getByTestId("auto-resume-toggle");
		await expect(toggle).toHaveAttribute("data-active", "false");

		const held = channelHold.arm("settings.changed");
		release = held.release;
		await toggle.click();
		await held.held;
		await expect(toggle).toHaveAttribute("data-active", "false");
		release();
		release = () => {};
		await expect(toggle).toHaveAttribute("data-active", "true");

		const input = page.getByTestId("auto-resume-input");
		const save = page.getByTestId("auto-resume-save");
		await expect(input).toHaveValue("15");
		await input.fill("0");
		await expect(input).toHaveAttribute("aria-invalid", "true");
		await expect(page.getByText("Enter a whole number from 1 to 1440.")).toBeVisible();
		await expect(save).toBeDisabled();

		await input.fill("20");
		await expect(save).toBeEnabled();
		await save.click();
		await expect(page.getByText("Wait 20 minutes before continuing.")).toBeVisible();

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openChatSettings(page);
		await expect(page.getByTestId("auto-resume-input")).toHaveValue("20");
	} finally {
		release();
		await disableAutoResume(page).catch(() => {});
	}
});

test("settings shows the Local GitHub status block and degrades gh gracefully", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();

	await page.getByTestId("settings-nav-github").click();
	await expect(dialog).toContainText("Local GitHub");

	const status = page.getByTestId("settings-gh-status");
	await expect(status).toHaveAttribute("data-connected", "false");
	await expect(status).toContainText("Not connected");
	await expect(page.getByTestId("settings-gh-refresh")).toBeVisible();

	await page.getByTestId("settings-gh-refresh").click();
	await expect(status).toHaveAttribute("data-connected", "false");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
