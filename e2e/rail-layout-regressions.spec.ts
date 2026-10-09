import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
	waitTerminalReady,
	worktreeRow,
} from "./fixtures/app";

async function openDefault(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
}

async function startDrag(page: Page, source: Locator): Promise<void> {
	const start = await source.boundingBox();
	if (!start) throw new Error("Missing drag source");
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2 + 8, {
		steps: 4,
	});
}

async function finishDrag(page: Page, target: Locator): Promise<void> {
	await expect(target).toBeVisible();
	const end = await target.boundingBox();
	if (!end) throw new Error("Missing drop target");
	await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
	await expect(target).toHaveAttribute("data-drop-active", "true");
	await page.mouse.up();
}

async function drag(page: Page, source: Locator, target: Locator): Promise<void> {
	await startDrag(page, source);
	await finishDrag(page, target);
}

test("bottom measurement reconnects after a frame transition and viewport resize", async ({
	page,
}) => {
	await openDefault(page);
	await page.getByTestId("tool-rail-specs").click();
	await page.getByRole("button", { name: "Bottom panel alignment" }).click();
	await page.getByRole("menuitemradio", { name: "Full width", exact: true }).click();
	await page.setViewportSize({ width: 1440, height: 680 });
	const panel = page.getByTestId("bottom-panel");
	await expect
		.poll(async () => {
			const [body, whole] = await Promise.all([
				panel.boundingBox(),
				page.getByTestId("workbench").boundingBox(),
			]);
			if (!body || !whole) throw new Error("Missing bottom geometry");
			return Math.abs(body.height - whole.height * 0.3);
		})
		.toBeLessThan(2);
	const handle = await page.getByTestId("resize-bottom").boundingBox();
	const rail = await page.getByTestId("bottom-tool-rail").boundingBox();
	if (!handle || !rail) throw new Error("Missing bottom resize controls");
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2, rail.y - 100, { steps: 12 });
	await page.mouse.up();
	await expect
		.poll(async () => (await panel.boundingBox())?.height ?? 0)
		.toBeGreaterThanOrEqual(151);
});

for (const allFolded of [false, true]) {
	test(`explicit terminal drop restores a ${allFolded ? "fully" : "partially"} folded bottom region`, async ({
		page,
	}) => {
		await openDefault(page);
		const terminalRail = page.getByTestId("terminal-rail-group");
		const destination = await terminalRail.getAttribute("data-group-id");
		if (!destination) throw new Error("Missing terminal group identity");
		if (!allFolded) {
			await page.getByTestId("tool-rail-changes").click({ button: "right" });
			await page.getByRole("menuitem", { name: "New bottom group at right", exact: true }).click();
		}
		await terminalRail.click();
		await expect(terminalRail).toHaveAttribute("aria-pressed", "false");
		await page.getByTestId("center-tab-strip").getByTestId("new-terminal").click();
		const source = page.getByTestId("center-group").getByTestId("terminal-tab");
		await expect(source).toBeVisible();
		const target = allFolded ? page.getByTestId("bottom-drop-zone") : terminalRail;
		await drag(page, source, target);
		const group = page
			.getByTestId("bottom-group")
			.and(page.locator(`[data-group-id="${destination}"]`));
		await expect(group).toBeVisible();
		await expect(group.getByTestId("terminal-tab")).toHaveCount(2);
		await expect(page.getByTestId("center-group").getByTestId("terminal-tab")).toHaveCount(0);
		await expect(terminalRail).toHaveAttribute("aria-pressed", "true");
		await expect(group.locator('[data-testid="terminal-instance"][data-ready="true"]')).toHaveCount(
			1,
		);
	});
}

test("a terminal dropped on a rail boundary beside a folded tool pane gets its own visible pane", async ({
	page,
}) => {
	await openDefault(page);
	const specs = page.getByTestId("tool-rail-specs");
	const specsGroupId = await specs.evaluate(
		(button) => button.closest<HTMLElement>("[data-group-id]")?.dataset.groupId,
	);
	await specs.click();
	await expect(specs).toHaveAttribute("aria-pressed", "false");
	await page.getByTestId("center-tab-strip").getByTestId("new-terminal").click();
	const terminal = page.getByTestId("center-group").getByTestId("terminal-tab");
	await startDrag(page, terminal);
	await expect(page.locator('[data-drop-label="Insert before Specs"]')).toHaveCount(0);
	await expect(page.locator('[data-drop-label="Join right group"]')).toHaveCount(0);
	const boundary = page.locator('[data-drop-label="New right pane here"]').first();
	await expect(boundary).toBeVisible();
	await finishDrag(page, boundary);
	const panes = page.locator('[data-side="right"][data-group-id]');
	await expect(panes).toHaveCount(2);
	const created = panes.first();
	await expect(created).not.toHaveAttribute("data-group-id", specsGroupId ?? "");
	await expect(created.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(created.locator('[data-testid="terminal-instance"][data-ready="true"]')).toHaveCount(
		1,
	);
	await expect(specs).toHaveAttribute("aria-pressed", "false");
	await expect(page.getByTestId("changes-view-toggle")).toBeVisible();
});

test("a fresh resize remains writable after its previous handle was removed during cancellation", async ({
	page,
}) => {
	await openDefault(page);
	const handle = page.getByTestId("resize-right");
	const first = await handle.boundingBox();
	if (!first) throw new Error("Missing resize handle");
	await page.mouse.move(first.x, first.y + first.height / 2);
	await page.mouse.down();
	await page.mouse.move(first.x - 40, first.y + first.height / 2, { steps: 8 });
	await pressPlatformShortcut(page, "j");
	await expect(handle).toHaveCount(0);
	await page.mouse.up();
	await pressPlatformShortcut(page, "j");
	await expect(handle).toBeVisible();
	const before = await frame(page);
	const next = await handle.boundingBox();
	if (!next) throw new Error("Missing restored resize handle");
	await page.mouse.move(next.x, next.y + next.height / 2);
	await page.mouse.down();
	await page.mouse.move(next.x - 40, next.y + next.height / 2, { steps: 8 });
	await page.mouse.up();
	await expect.poll(() => frame(page)).not.toBe(before);
});

async function groupSizes(handle: Locator): Promise<number[]> {
	return handle.evaluate((element) => {
		const group = element.closest<HTMLElement>("[data-panel-group]");
		if (!group) throw new Error("Missing resizable group");
		const horizontal = group.dataset.panelGroupDirection === "horizontal";
		return Array.from(group.querySelectorAll<HTMLElement>(":scope > [data-panel-id]")).map(
			(panel) =>
				horizontal ? panel.getBoundingClientRect().width : panel.getBoundingClientRect().height,
		);
	});
}

async function frame(page: Page): Promise<string> {
	return page.evaluate(() => {
		const key = Object.keys(localStorage).find((key) => key.startsWith("thinkrail:workbench:"));
		if (!key) throw new Error("Missing persisted frame");
		return JSON.stringify(JSON.parse(localStorage.getItem(key) ?? "null").frame);
	});
}

for (const kind of [
	"outer-side",
	"aligned-side",
	"bottom-height",
	"side-groups",
	"bottom-groups",
	"center-split",
] as const) {
	test(`workspace switching restores the uncommitted ${kind} resize without remounting`, async ({
		page,
	}) => {
		await openDefault(page);
		const other = await createWorkspaceViaDialog(page);
		await waitTerminalReady(page);
		await defaultWorkspaceRow(page).getByRole("button").first().click();
		await waitTerminalReady(page);
		if (kind === "aligned-side") {
			await page.getByRole("button", { name: "Bottom panel alignment" }).click();
			await page.getByRole("menuitemradio", { name: "Full width", exact: true }).click();
		}
		if (kind === "bottom-groups") {
			await page.getByTestId("tool-rail-changes").click({ button: "right" });
			await page.getByRole("menuitem", { name: "New bottom group at right", exact: true }).click();
		}
		if (kind === "center-split") {
			await revealWorkbenchTool(page, "files");
			for (const name of ["README.md", "notes.txt"])
				await page.getByTestId("file-node").filter({ hasText: name }).dblclick();
			await page
				.getByTestId("editor-tab")
				.filter({ hasText: "notes.txt" })
				.click({ button: "right" });
			await page.getByRole("menuitem", { name: "Split right", exact: true }).click();
		}
		const id = {
			"outer-side": "resize-right",
			"aligned-side": "resize-left",
			"bottom-height": "resize-bottom",
			"side-groups": "right-group-resize",
			"bottom-groups": "bottom-group-resize",
			"center-split": "center-split-resize",
		}[kind];
		const handle = page.getByTestId(id);
		await expect(handle).toBeVisible();
		await handle.evaluate((element) =>
			element.closest("[data-panel-group]")?.setAttribute("data-resize-probe", "retained"),
		);
		const before = await groupSizes(handle);
		const persisted = await frame(page);
		const bounds = await handle.boundingBox();
		if (!bounds) throw new Error("Missing resize handle geometry");
		const vertical = (await handle.getAttribute("aria-orientation")) === "horizontal";
		const x = bounds.x + bounds.width / 2;
		const y = bounds.y + bounds.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + (vertical ? 0 : 40), y + (vertical ? 40 : 0), { steps: 8 });
		const difference = async () =>
			Math.max(
				...(await groupSizes(handle)).map((size, index) => Math.abs(size - (before[index] ?? 0))),
			);
		await expect.poll(difference).toBeGreaterThan(20);
		await page.goto(`/#/v1/projects/${other.projectId}/workspaces/${other.id}`);
		await expect(worktreeRow(page, other.name)).toHaveAttribute("data-active", "true");
		await expect(page.locator('[data-resize-probe="retained"]')).toHaveCount(1);
		await expect.poll(difference).toBeLessThan(2);
		await page.mouse.move(x + (vertical ? 0 : 60), y + (vertical ? 60 : 0), { steps: 4 });
		await expect.poll(difference).toBeLessThan(2);
		await page.mouse.up();
		await expect.poll(difference).toBeLessThan(2);
		expect(await frame(page)).toBe(persisted);
		await expect(page.getByTestId("toast")).toContainText("Your drag was canceled");
		await page.reload();
		await expect(handle).toBeVisible();
		await expect.poll(difference).toBeLessThan(2);
		expect(await frame(page)).toBe(persisted);
	});
}
