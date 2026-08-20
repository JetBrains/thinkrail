import { existsSync, readFileSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openWorkspaceMenu,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";
import { E2E_EDITOR_LOG } from "./fixtures/paths";

test.beforeEach(() => {
	rmSync(E2E_EDITOR_LOG, { force: true });
});

async function settleAfterCreate(page: import("@playwright/test").Page): Promise<void> {
	await waitTerminalReady(page);
}

test("Open in launches the detected editor detached at the worktree path", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await settleAfterCreate(page);
	const row = worktreeRows(page).first();

	await openWorkspaceMenu(row);
	await page.getByTestId("workspace-open-in").click();
	const vsCode = page.getByTestId("workspace-open-in-editor").filter({ hasText: "VS Code" });
	await expect(vsCode).toBeVisible();
	await vsCode.click();

	await expect.poll(() => existsSync(E2E_EDITOR_LOG)).toBe(true);
	const invocation = readFileSync(E2E_EDITOR_LOG, "utf8").trim();
	expect(invocation).toContain("/worktrees/sample-project/");
});

test("Copy path copies the worktree's absolute path to the clipboard", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await settleAfterCreate(page);
	const row = worktreeRows(page).first();

	await openWorkspaceMenu(row);
	await page.getByTestId("workspace-copy-path").click();
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied).toContain("/worktrees/sample-project/");
});

test("the Default workspace's kebab menu offers Open in / Copy path but no Remove", async ({
	page,
}) => {
	await openFixtureProject(page);
	const row = page.locator('[data-testid="workspace-item"][data-kind="default"]');
	await openWorkspaceMenu(row);
	await expect(page.getByTestId("workspace-open-in")).toBeVisible();
	await expect(page.getByTestId("workspace-copy-path")).toBeVisible();
	await expect(page.getByTestId("workspace-remove")).toHaveCount(0);
});

test("right-click opens the workspace's kebab menu without activating it", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await settleAfterCreate(page);

	const activeRow = worktreeRows(page).first();
	const defaultRow = page.locator('[data-testid="workspace-item"][data-kind="default"]');
	await expect(activeRow).toHaveAttribute("data-active", "true");
	await expect(defaultRow).toHaveAttribute("data-active", "false");

	const rowBox = await defaultRow.boundingBox();
	if (!rowBox) throw new Error("Workspace row has no geometry");
	await page.mouse.click(rowBox.x + 4, rowBox.y + rowBox.height / 2, { button: "right" });
	const actions = page.getByTestId("workspace-actions");
	await expect(actions).toBeVisible();
	const [actionsBox, kebabBox] = await Promise.all([
		actions.boundingBox(),
		defaultRow.getByTestId("workspace-menu").boundingBox(),
	]);
	if (!actionsBox || !kebabBox) throw new Error("Workspace menu has no anchor geometry");
	expect(Math.abs(actionsBox.x + actionsBox.width - (kebabBox.x + kebabBox.width))).toBeLessThan(8);
	expect(Math.abs(actionsBox.y - (kebabBox.y + kebabBox.height))).toBeLessThan(12);
	await expect(page.getByTestId("workspace-copy-path")).toBeVisible();
	await expect(page.getByTestId("workspace-remove")).toHaveCount(0);
	await expect(activeRow).toHaveAttribute("data-active", "true");
	await expect(defaultRow).toHaveAttribute("data-active", "false");
});

test("the kebab is hover-only ONLY on devices that actually have hover — never invisible by default", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await settleAfterCreate(page);
	const row = worktreeRows(page).first();
	const kebab = row.getByTestId("workspace-menu");

	const opacityZeroIsHoverGated = await page.evaluate(() => {
		function findHoverGatedOpacityZero(rules: CSSRuleList): boolean {
			for (const rule of Array.from(rules)) {
				if (
					rule instanceof CSSMediaRule &&
					/hover:\s*hover/.test(rule.media.mediaText) &&
					findOpacityZero(rule.cssRules)
				) {
					return true;
				}
				const grouping = rule as CSSRule & { cssRules?: CSSRuleList };
				if (grouping.cssRules && findHoverGatedOpacityZero(grouping.cssRules)) return true;
			}
			return false;
		}
		function findOpacityZero(rules: CSSRuleList): boolean {
			for (const rule of Array.from(rules)) {
				if (
					rule instanceof CSSStyleRule &&
					rule.selectorText.includes("opacity-0") &&
					rule.style.opacity === "0"
				) {
					return true;
				}
			}
			return false;
		}
		for (const sheet of Array.from(document.styleSheets)) {
			let rules: CSSRuleList;
			try {
				rules = sheet.cssRules;
			} catch {
				continue;
			}
			if (findHoverGatedOpacityZero(rules)) return true;
		}
		return false;
	});
	expect(opacityZeroIsHoverGated).toBe(true);

	await expect(kebab).toHaveCSS("opacity", "0");
	await row.hover();
	await expect(kebab).toHaveCSS("opacity", "1");
});
