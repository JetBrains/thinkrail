import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, PHONE_VIEWPORT } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

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

	const groupKey = await row
		.locator('xpath=ancestor::*[@data-testid="skill-group"]')
		.getAttribute("data-group");
	const group = page.locator(`[data-testid="skill-group"][data-group="${groupKey}"]`);
	const parentSwitch = group.getByTestId("group-toggle");
	const fixedSkillSwitch = group
		.locator(`[data-testid="skill-row"][data-skill="${skillName}"]`)
		.getByTestId("skill-toggle");
	await parentSwitch.click();
	await expect(parentSwitch).toHaveAttribute("aria-checked", "false");
	await expect(fixedSkillSwitch).toBeDisabled();
	await parentSwitch.click();
	await expect(parentSwitch).toHaveAttribute("aria-checked", "true");

	await page.setViewportSize(PHONE_VIEWPORT);
	await expect(dialog).toBeVisible();
	expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("a chat's Skills dialog names the project's Pi resources and grants them with its trust", async ({
	page,
}) => {
	const trustRequests: Array<Record<string, unknown>> = [];
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			if (typeof payload !== "string") return;
			try {
				const request = JSON.parse(payload) as {
					method?: string;
					params?: Record<string, unknown>;
				};
				if (request.method === "project.setTrust" && request.params)
					trustRequests.push(request.params);
			} catch {}
		});
	});
	const prompts = join(E2E_FIXTURE_REPO, ".pi", "prompts");
	mkdirSync(prompts, { recursive: true });
	writeFileSync(join(prompts, "e2e-kickoff.md"), "---\ndescription: Kick off\n---\nGo\n");
	try {
		await openFixtureProject(page);
		await createWorkspaceViaDialog(page);
		await page.getByTestId("open-skills").click();

		const banner = page.getByTestId("skills-trust-all");
		await expect(banner).toContainText("1 skill and its own Pi resources");
		await expect(banner).toContainText("Trust loads its prompts.");
		await banner.getByRole("button", { name: "Trust project" }).click();
		await expect(banner).toHaveCount(0);
		expect(trustRequests.at(-1)).toMatchObject({ trusted: true, resources: true });
	} finally {
		rmSync(join(E2E_FIXTURE_REPO, ".pi"), { recursive: true, force: true });
	}
});
