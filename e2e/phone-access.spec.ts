import { expect, test } from "@playwright/test";

test("phone access is off by default, turns on from Settings with a scannable code, and stays as left", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await page.getByTestId("settings-nav-phone").click();
	const toggle = page.getByTestId("phone-access-toggle");
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(page.getByTestId("phone-access-show-code")).toBeHidden();

	await toggle.click();
	try {
		await expect(toggle).toHaveAttribute("data-active", "true");
		await page.getByTestId("phone-access-show-code").click();
		const code = page.getByTestId("phone-access-code");
		await expect(code).toHaveAttribute("data-expired", "false");
		await expect(code.getByRole("img", { name: "Pairing QR code" })).toHaveAttribute(
			"src",
			/^data:image\/svg\+xml/,
		);

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-phone").click();
		await expect(toggle).toHaveAttribute("data-active", "true");
	} finally {
		if ((await toggle.getAttribute("data-active")) === "true") await toggle.click();
	}
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(page.getByTestId("phone-access-show-code")).toBeHidden();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
