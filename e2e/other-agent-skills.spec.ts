import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { E2E_HOME_DIR } from "./fixtures/paths";

const SKILL = "e2e-other-agent-widget";
const skillDir = join(E2E_HOME_DIR, ".claude", "skills", SKILL);

async function setOtherAgentSkills(page: Page, enabled: boolean): Promise<void> {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-extensions").click();
	const toggle = page.getByTestId("other-agent-skills-toggle");
	if ((await toggle.getAttribute("data-active")) !== String(enabled)) await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", String(enabled));
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
}

async function openSkills(page: Page) {
	await page.getByTestId("open-skills").click();
	const dialog = page.getByTestId("skills-dialog");
	await expect(dialog.getByTestId("skills-size")).toBeVisible();
	return dialog;
}

test.beforeEach(() => {
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(
		join(skillDir, "SKILL.md"),
		`---\nname: ${SKILL}\ndescription: A personal skill another agent keeps.\n---\nBody.\n`,
	);
});

test.afterEach(() => {
	rmSync(skillDir, { recursive: true, force: true });
});

test("other agents' skills stay off until opted in host-wide, and the catalog size follows", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	let dialog = await openSkills(page);
	const personal = dialog.locator('[data-testid="skill-group"][data-group="personal"]');
	await expect(personal).toHaveAttribute("data-on", "false");
	await expect(dialog.getByTestId("skills-other-agents-off")).toBeVisible();
	const offSize = await dialog.getByTestId("skills-size").textContent();
	await page.keyboard.press("Escape");

	await setOtherAgentSkills(page, true);
	try {
		dialog = await openSkills(page);
		await expect(personal).toHaveAttribute("data-on", "true");
		await expect(dialog.getByTestId("skills-other-agents-off")).toBeHidden();
		await expect(dialog.getByTestId("skills-size")).not.toHaveText(offSize ?? "");
		await page.keyboard.press("Escape");
	} finally {
		await setOtherAgentSkills(page, false);
	}
});
