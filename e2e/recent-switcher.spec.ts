import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRow } from "./fixtures/app";

function switcher(page: Page) {
	return page.getByTestId("recent-switcher");
}

async function visit(page: Page, name: string): Promise<void> {
	await worktreeRow(page, name).click();
	await expect(worktreeRow(page, name)).toHaveAttribute("data-active", "true");
}

async function tap(page: Page, chord: "Tab" | "Shift+Tab"): Promise<void> {
	await page.keyboard.down("Control");
	await page.keyboard.press(chord);
	await page.keyboard.up("Control");
}

test("Ctrl+Tab taps back to the previous workspace; holding it picks a recent one, Esc keeps you put", async ({
	page,
}) => {
	await openFixtureProject(page);
	const [a, b, c] = [
		await createWorkspaceViaDialog(page),
		await createWorkspaceViaDialog(page),
		await createWorkspaceViaDialog(page),
	];
	for (const workspace of [a, b, c]) await visit(page, workspace.name);

	await tap(page, "Tab");
	await expect(worktreeRow(page, b.name)).toHaveAttribute("data-active", "true");
	await expect(switcher(page)).toBeHidden();
	await tap(page, "Tab");
	await expect(worktreeRow(page, c.name)).toHaveAttribute("data-active", "true");

	await page.keyboard.down("Control");
	await page.keyboard.press("Tab");
	await expect(switcher(page)).toBeVisible();
	const rows = switcher(page).getByTestId("search-row");
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toHaveAttribute("data-item-id", `workspace:${c.id}`);
	await expect(rows.nth(1)).toHaveAttribute("data-item-id", `workspace:${b.id}`);
	await expect(rows.nth(2)).toHaveAttribute("data-item-id", `workspace:${a.id}`);
	await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Tab");
	await expect(rows.nth(2)).toHaveAttribute("aria-selected", "true");
	await page.keyboard.up("Control");
	await expect(switcher(page)).toBeHidden();
	await expect(worktreeRow(page, a.name)).toHaveAttribute("data-active", "true");

	await page.keyboard.down("Control");
	await page.keyboard.press("Tab");
	await expect(switcher(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(switcher(page)).toBeHidden();
	await page.keyboard.up("Control");
	await expect(worktreeRow(page, a.name)).toHaveAttribute("data-active", "true");

	await tap(page, "Shift+Tab");
	await expect(worktreeRow(page, b.name)).toHaveAttribute("data-active", "true");
});
