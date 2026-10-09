import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
	waitTerminalReady,
	worktreeRow,
} from "./fixtures/app";

async function openDefaultWorkbench(page: Page): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
}

async function addTerminal(page: Page, group: Locator): Promise<void> {
	await group.getByRole("button", { name: "Add to this group", exact: true }).click();
	await page.getByRole("menuitem", { name: "New terminal", exact: true }).click();
}

async function startDrag(page: Page, locator: Locator): Promise<void> {
	const box = await locator.boundingBox();
	if (!box) throw new Error("drag source has no bounding box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8, { steps: 4 });
}

async function markMounted(page: Page, testIds: readonly string[]): Promise<void> {
	await page.evaluate((ids) => {
		for (const id of ids) {
			const element = document.querySelector(`[data-testid="${id}"]`);
			if (!element) throw new Error(`${id} is not mounted`);
			element.setAttribute("data-mount-probe", id);
		}
	}, testIds);
}

async function expectStillMounted(page: Page, testIds: readonly string[]): Promise<void> {
	for (const id of testIds)
		await expect(page.getByTestId(id)).toHaveAttribute("data-mount-probe", id);
}

test("folding, hiding, and showing regions keep the center and the other panes mounted", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await page.getByTestId("new-chat").click();
	await expect(page.getByTestId("chat-input")).toBeVisible();
	const center = ["center-tabs", "chat-input", "terminal-instance"] as const;
	const specs = page.getByTestId("tool-rail-specs");
	const toggle = async (
		survivors: readonly string[],
		action: () => Promise<void>,
	): Promise<void> => {
		await markMounted(page, survivors);
		await action();
		await expectStillMounted(page, survivors);
	};

	await toggle([...center, "left-nav", "changes-view-toggle"], async () => {
		await specs.click();
		await expect(specs).toHaveAttribute("aria-pressed", "false");
	});
	await toggle([...center, "left-nav", "changes-view-toggle"], async () => {
		await specs.click();
		await expect(specs).toHaveAttribute("aria-pressed", "true");
	});
	await toggle([...center, "left-nav"], async () => {
		await pressPlatformShortcut(page, "j");
		await expect(page.getByTestId("right-stack")).toHaveCount(0);
	});
	await toggle([...center, "left-nav"], async () => {
		await pressPlatformShortcut(page, "j");
		await expect(page.getByTestId("right-stack")).toBeVisible();
	});
	await toggle([...center, "changes-view-toggle"], async () => {
		await pressPlatformShortcut(page, "b");
		await expect(page.getByTestId("left-nav")).toHaveCount(0);
	});
	await toggle([...center, "changes-view-toggle"], async () => {
		await pressPlatformShortcut(page, "b");
		await expect(page.getByTestId("left-nav")).toBeVisible();
	});
	await toggle(["center-tabs", "chat-input", "left-nav", "changes-view-toggle"], async () => {
		await pressPlatformShortcut(page, "Shift+j");
		await expect(page.getByTestId("bottom-panel")).toHaveCount(0);
	});
	await toggle(["center-tabs", "chat-input", "left-nav", "changes-view-toggle"], async () => {
		await pressPlatformShortcut(page, "Shift+j");
		await waitTerminalReady(page);
	});
});

test("edge tools hide only their pane while terminal sessions stay grouped", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
	await expect(page.getByTestId("left-layout-rail")).toBeVisible();
	await expect(page.getByTestId("right-layout-rail")).toBeVisible();
	const bottomRail = page.getByTestId("bottom-tool-rail");
	await expect(bottomRail).toBeVisible();
	const bounds = await bottomRail.boundingBox();
	if (!bounds) throw new Error("bottom rail has no bounding box");
	for (const control of await bottomRail.locator("[data-rail-entry]").all()) {
		const box = await control.boundingBox();
		if (!box) throw new Error("rail control has no bounding box");
		expect(box.y).toBeGreaterThanOrEqual(bounds.y);
		expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
	}
	const specs = page.getByTestId("tool-rail-specs");
	await expect(specs).toHaveAttribute("aria-pressed", "true");
	await specs.click();
	await expect(specs).toHaveAttribute("aria-pressed", "false");
	await expect(page.getByTestId("changes-view-toggle")).toBeVisible();
	await specs.click();
	await expect(specs).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("spec-node").first()).toBeVisible();
	const terminalRail = page.getByTestId("terminal-rail-group");
	await expect(terminalRail).toHaveCount(1);
	await terminalRail.click();
	await expect(page.getByTestId("terminal-instance")).toHaveCount(0);
	await expect(page.getByTestId("bottom-tool-rail")).toBeVisible();
	await terminalRail.click();
	await waitTerminalReady(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await page
		.getByTestId("bottom-tab-strip")
		.getByRole("button", { name: "Add to this group", exact: true })
		.click();
	await page.getByRole("menuitem", { name: "New terminal", exact: true }).click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);
	await expect(terminalRail).toHaveCount(1);
	await page.getByTestId("terminal-tab").first().getByRole("tab").click();
	await expect(terminalRail).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("terminal-instance")).toHaveCount(1);
});

test("a terminal pane's selected session survives a fold, a reload, and independent split panes", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await addTerminal(page, page.getByTestId("bottom-group"));
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);
	const selected = page
		.getByTestId("terminal-tab")
		.filter({ has: page.locator('[aria-selected="true"]') });
	const recalledId = await selected.getByRole("tab").getAttribute("data-layout-tab-id");
	await page.getByTestId("tool-rail-files").click({ button: "right" });
	await expect(
		page.getByRole("menuitem", {
			name: /Move to bottom pane .* — Tools and terminals use separate panes\./,
		}),
	).toBeDisabled();
	await page.keyboard.press("Escape");
	await page.getByTestId("terminal-rail-group").click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("terminal-rail-group").click();
	await expect(
		page
			.getByTestId("terminal-tab")
			.filter({ has: page.locator('[aria-selected="true"]') })
			.getByRole("tab"),
	).toHaveAttribute("data-layout-tab-id", recalledId ?? "");
	await page.getByTestId("terminal-tab").first().click({ button: "right" });
	await page.getByRole("menuitem", { name: "New bottom group at right", exact: true }).click();
	await expect(page.getByTestId("bottom-group")).toHaveCount(2);
	await expect(page.getByTestId("terminal-rail-group")).toHaveCount(2);
	await expect(page.locator('[data-testid="terminal-instance"][data-ready="true"]')).toHaveCount(2);
	const keys = await page
		.getByTestId("terminal-instance")
		.evaluateAll((elements) =>
			elements.map((element) => element.getAttribute("data-tab-key")).sort(),
		);
	await page.getByTestId("terminal-rail-group").first().click();
	await expect(page.getByTestId("bottom-group")).toHaveCount(1);
	await expect(page.getByTestId("terminal-instance")).toHaveCount(1);
	await page.getByTestId("terminal-rail-group").last().click();
	await expect(page.getByTestId("bottom-panel")).toHaveCount(0);
	await expect(page.getByTestId("resize-bottom")).toHaveCount(0);
	await expect(page.getByTestId("bottom-tool-rail")).toBeVisible();
	await page.getByTestId("terminal-rail-group").first().click();
	await page.getByTestId("terminal-rail-group").last().click();
	await expect(page.locator('[data-testid="terminal-instance"][data-ready="true"]')).toHaveCount(2);
	expect(
		await page
			.getByTestId("terminal-instance")
			.evaluateAll((elements) =>
				elements.map((element) => element.getAttribute("data-tab-key")).sort(),
			),
	).toEqual(keys);
});

async function railClusters(page: Page, rail: string): Promise<string[][]> {
	return page.getByTestId(rail).evaluate((root) => {
		const clusters: string[][] = [[]];
		for (const node of Array.from(root.children)) {
			if (node.getAttribute("data-testid") === "rail-separator") {
				clusters.push([]);
				continue;
			}
			for (const entry of Array.from(node.querySelectorAll<HTMLElement>("[data-rail-entry]"))) {
				clusters.at(-1)?.push(entry.dataset.testid ?? "");
			}
		}
		return clusters.filter((cluster) => cluster.length > 0);
	});
}

async function finishDrag(page: Page, target: Locator): Promise<void> {
	await expect(target).toBeVisible();
	const box = await target.boundingBox();
	if (!box) throw new Error("drop target has no bounding box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
	await expect(target).toHaveAttribute("data-drop-active", "true");
	await page.mouse.up();
}

test("rail clusters mirror the panes, boundary drops create panes, and tools never join a terminal pane", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await addTerminal(page, page.getByTestId("bottom-group"));
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);
	expect(await railClusters(page, "right-layout-rail")).toEqual([
		["tool-rail-specs", "tool-rail-files"],
		["tool-rail-changes", "tool-rail-review"],
	]);

	await startDrag(page, page.getByTestId("tool-rail-files"));
	await expect(
		page.getByTestId("bottom-tab-strip").locator("[data-drop-label^='Insert']"),
	).toHaveCount(0);
	await expect(page.locator('[data-drop-label="New right pane here"]')).toHaveCount(3);
	await finishDrag(page, page.locator('[data-drop-label="New right pane here"]').nth(1));
	await expect(page.locator('[data-side="right"][data-group-id]')).toHaveCount(3);
	expect(await railClusters(page, "right-layout-rail")).toEqual([
		["tool-rail-specs"],
		["tool-rail-files"],
		["tool-rail-changes", "tool-rail-review"],
	]);

	await startDrag(page, page.getByTestId("tool-rail-files"));
	await expect(page.locator('[data-drop-label="New right pane here"]')).toHaveCount(2);
	await finishDrag(page, page.locator('[data-drop-label="Insert after Review"]'));
	expect(await railClusters(page, "right-layout-rail")).toEqual([
		["tool-rail-specs"],
		["empty-rail-group"],
		["tool-rail-changes", "tool-rail-review", "tool-rail-files"],
	]);
	await expect(page.locator('[data-side="right"][data-group-id]')).toHaveCount(3);

	const title = page.getByTestId("auxiliary-pane-title").filter({ hasText: "Files" });
	await expect(title).toHaveCSS("cursor", "grab");
	await startDrag(page, title);
	await finishDrag(page, page.locator('[data-drop-label="Join left group"]'));
	expect(await railClusters(page, "left-layout-rail")).toEqual([
		["tool-rail-projects", "tool-rail-files"],
	]);
	await expect(page.getByTestId("auxiliary-pane-title").filter({ hasText: "Files" })).toBeVisible();

	await page.getByTestId("tab-review").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Remove tool from group", exact: true }).click();
	expect(await railClusters(page, "right-layout-rail")).toEqual([
		["tool-rail-specs"],
		["empty-rail-group"],
		["tool-rail-changes"],
		["tool-rail-review"],
	]);
	await expect(page.getByTestId("tool-rail-review")).toHaveClass(/text-text-subtle/);
	await page.getByTestId("tool-rail-review").click();
	await expect(page.getByTestId("tool-rail-review")).toHaveAttribute("aria-pressed", "true");
});

test("rail keyboard navigation changes focus without selection and keeps collapsed panels linked", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	const rail = page.getByTestId("right-layout-rail");
	await expect(rail).toHaveAttribute("role", "toolbar");
	await expect(rail).toHaveAttribute("aria-orientation", "vertical");
	const specs = page.getByTestId("tool-rail-specs");
	const files = page.getByTestId("tool-rail-files");
	await specs.focus();
	await page.keyboard.press("ArrowDown");
	await expect(files).toBeFocused();
	await expect(specs).toHaveAttribute("aria-pressed", "true");
	await expect(files).toHaveAttribute("aria-pressed", "false");
	await page.keyboard.press("Enter");
	await expect(files).toHaveAttribute("aria-pressed", "true");
	const panelId = await files.getAttribute("aria-controls");
	if (!panelId) throw new Error("Files rail control has no panel relationship");
	const panel = page.locator(`[id="${panelId}"]`);
	await expect(panel).toBeVisible();
	await page.keyboard.press("Space");
	await expect(files).toBeFocused();
	await expect(files).toHaveAttribute("aria-pressed", "false");
	await expect(panel).toBeHidden();
	await expect(panel).toHaveAttribute("aria-labelledby", (await files.getAttribute("id")) ?? "");
	await expect(page.getByTestId("changes-view-toggle")).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(panel).toBeVisible();
	await expect(rail.locator('[data-rail-entry][tabindex="0"]')).toHaveCount(1);
});

test("a workspace switch cancels a singleton drag even though its frame placement still exists", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	const other = await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await defaultWorkspaceRow(page).getByRole("button").first().click();
	await waitTerminalReady(page);
	await startDrag(page, page.getByTestId("tool-rail-files"));
	const target = page.locator('[data-drop-label="Create bottom group to the right"]');
	await expect(target).toBeVisible();
	const drop = await target.boundingBox();
	if (!drop) throw new Error("bottom drop target has no bounding box");
	await page.goBack();
	await expect(worktreeRow(page, other.name)).toHaveAttribute("data-active", "true");
	await expect(target).toHaveCount(0);
	await expect(page.getByTestId("tab-files")).not.toHaveAttribute("data-dragging", "true");
	await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2);
	await page.mouse.up();
	await expect(page.getByTestId("bottom-group")).toHaveCount(1);
	await expect(page.getByTestId("right-layout-rail").getByTestId("tool-rail-files")).toBeVisible();
	await expect(page.getByTestId("toast")).toContainText("Your drag was canceled");
	await defaultWorkspaceRow(page).getByRole("button").first().click();
	await expect(page.getByTestId("bottom-group")).toHaveCount(1);
	await expect(page.getByTestId("right-layout-rail").getByTestId("tool-rail-files")).toBeVisible();
});
