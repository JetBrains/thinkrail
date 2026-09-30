import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, PHONE_VIEWPORT } from "./fixtures/app";

test("Skills renders existing controls as explicit switches without making rows interactive", async ({
	page,
}) => {
	const requests: Array<{ method?: string; params?: Record<string, unknown> }> = [];
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			if (typeof payload !== "string") return;
			try {
				requests.push(JSON.parse(payload) as { method?: string; params?: Record<string, unknown> });
			} catch {}
		});
	});
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("open-skills").click();

	const dialog = page.getByTestId("skills-dialog");
	const groupSwitch = page.getByTestId("group-toggle").first();
	await expect(groupSwitch).toHaveRole("switch");
	await expect(groupSwitch).toHaveAttribute("aria-checked", /true|false/);
	await expect(groupSwitch).toHaveText("");

	const skillSwitch = page.locator('[data-testid="skill-toggle"]:not(:disabled)').first();
	await expect(skillSwitch).toHaveRole("switch");
	const before = await skillSwitch.getAttribute("aria-checked");
	await skillSwitch.hover();
	await expect(page.getByRole("tooltip")).toHaveText(
		before === "true" ? "On — turn off" : "Off — turn on",
	);

	const row = skillSwitch.locator('xpath=ancestor::*[@data-testid="skill-row"]');
	const skillName = await row.getAttribute("data-skill");
	await row.getByText(skillName ?? "").click();
	await expect(skillSwitch).toHaveAttribute("aria-checked", before ?? "false");

	await skillSwitch.click();
	await expect(skillSwitch).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
	await expect
		.poll(
			() =>
				requests.findLast(
					(request) =>
						request.method === "workspace.setSkillOverride" && request.params?.name === skillName,
				)?.params?.override,
		)
		.toBe(before === "true" ? "off" : "on");

	const group = row.locator('xpath=ancestor::*[@data-testid="skill-group"]');
	const parentSwitch = group.getByTestId("group-toggle");
	await parentSwitch.click();
	await expect(parentSwitch).toHaveAttribute("aria-checked", "false");
	await expect(group.getByTestId("skill-toggle").first()).toBeDisabled();
	await parentSwitch.click();
	await expect(parentSwitch).toHaveAttribute("aria-checked", "true");

	await page.setViewportSize(PHONE_VIEWPORT);
	await expect(dialog).toBeVisible();
	expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
