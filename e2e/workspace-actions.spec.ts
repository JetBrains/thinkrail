import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { expect, test, type WebSocketRoute } from "@playwright/test";
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

test("a managed workspace can be renamed with its branch while its worktree path stays put", async ({
	page,
}) => {
	await openFixtureProject(page);
	const created = await createWorkspaceViaDialog(page);
	await settleAfterCreate(page);
	const row = worktreeRows(page).first();

	await openWorkspaceMenu(row);
	await page.getByTestId("workspace-rename").click();
	const dialog = page.getByTestId("rename-workspace-dialog");
	const input = page.getByTestId("rename-workspace-input");
	const submit = page.getByTestId("rename-workspace-submit");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Git branch");
	await expect(dialog).toContainText("folder stays in place");
	await expect(input).toHaveValue(created.name);
	await expect(input).toBeFocused();

	await input.fill("   ");
	await expect(submit).toBeDisabled();
	await input.fill("Manual Workspace Name");
	await submit.click();

	await expect(dialog).toHaveCount(0);
	await expect(row.getByTestId("workspace-name")).toHaveText("Manual Workspace Name");
	await expect(row.getByTestId("workspace-branch")).toHaveText("manual-workspace-name");
	expect(
		execFileSync("git", ["-C", created.worktreePath, "symbolic-ref", "--short", "HEAD"], {
			encoding: "utf8",
		}).trim(),
	).toBe("manual-workspace-name");
	expect(existsSync(created.worktreePath)).toBe(true);
});

test("an open rename dialog survives reconnect and waits for the current welcome", async ({
	page,
}) => {
	let firstSocket: WebSocketRoute | undefined;
	let socketsOpened = 0;
	let releaseReconnect: () => void = () => {};
	const reconnectAllowed = new Promise<void>((resolve) => {
		releaseReconnect = resolve;
	});
	await page.routeWebSocket(/\/ws(\?|$)/, async (socket) => {
		socketsOpened += 1;
		if (socketsOpened > 1) await reconnectAllowed;
		firstSocket ??= socket;
		socket.connectToServer();
	});

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await settleAfterCreate(page);
	const row = worktreeRows(page).first();
	await openWorkspaceMenu(row);
	await page.getByTestId("workspace-rename").click();
	const dialog = page.getByTestId("rename-workspace-dialog");
	const submit = page.getByTestId("rename-workspace-submit");
	await expect(dialog).toBeVisible();

	await firstSocket?.close();
	await expect(page.getByTestId("connection-status")).not.toHaveAttribute(
		"data-status",
		"connected",
	);
	await expect(dialog).toBeVisible();
	await expect(submit).toBeDisabled();

	releaseReconnect();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect.poll(() => socketsOpened).toBeGreaterThan(1);
	await expect(dialog).toBeVisible();
	await expect(submit).toBeEnabled();
	await page.getByTestId("rename-workspace-input").fill("Rename After Reconnect");
	await submit.click();
	await expect(row.getByTestId("workspace-name")).toHaveText("Rename After Reconnect");
});

test("the Default workspace's kebab menu offers only non-mutating actions", async ({ page }) => {
	await openFixtureProject(page);
	const row = page.locator('[data-testid="workspace-item"][data-kind="default"]');
	await openWorkspaceMenu(row);
	await expect(page.getByTestId("workspace-open-in")).toBeVisible();
	await expect(page.getByTestId("workspace-copy-path")).toBeVisible();
	await expect(page.getByTestId("workspace-rename")).toHaveCount(0);
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
	await expect(page.getByTestId("workspace-rename")).toHaveCount(0);
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
