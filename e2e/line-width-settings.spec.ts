import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	openWorkspaceChat,
	PHONE_VIEWPORT,
} from "./fixtures/app";
import { installChannelHold } from "./fixtures/channelHold";
import { LONG_LINE } from "./fixtures/repo";

function widthControls(page: Page) {
	return {
		chatInput: page.getByTestId("chat-line-width-input"),
		chatSave: page.getByTestId("chat-line-width-save"),
		chatBounded: page.getByTestId("chat-line-width-bounded"),
		fileInput: page.getByTestId("file-line-width-input"),
		fileSave: page.getByTestId("file-line-width-save"),
		fileBounded: page.getByTestId("file-line-width-bounded"),
	};
}

async function openLineWidthSettings(page: Page): Promise<void> {
	if (!(await page.getByTestId("settings-dialog").isVisible())) {
		await page.getByTestId("open-settings").click();
	}
	const lineWidthNav = page.getByTestId("settings-nav-line-width");
	await expect(lineWidthNav).toBeVisible();
	await lineWidthNav.click();
	await expect(page.getByTestId("settings-line-width")).toBeVisible();
}

async function saveWidth(input: Locator, save: Locator, value: number): Promise<void> {
	await input.fill(String(value));
	await expect(save).toBeEnabled();
	await save.click();
	await expect(save).toBeDisabled();
}

async function restoreLineWidthDefaults(page: Page): Promise<void> {
	if (page.isClosed()) return;
	if (await page.getByTestId("settings-dialog").isVisible()) await page.keyboard.press("Escape");
	await openLineWidthSettings(page);
	const controls = widthControls(page);
	if ((await controls.chatInput.inputValue()) !== "120") {
		await saveWidth(controls.chatInput, controls.chatSave, 120);
	}
	if ((await controls.fileInput.inputValue()) !== "120") {
		await saveWidth(controls.fileInput, controls.fileSave, 120);
	}
	if ((await controls.chatBounded.getAttribute("data-active")) !== "true") {
		await controls.chatBounded.click();
		await expect(controls.chatBounded).toHaveAttribute("data-active", "true");
	}
	if ((await controls.fileBounded.getAttribute("data-active")) !== "true") {
		await controls.fileBounded.click();
		await expect(controls.fileBounded).toHaveAttribute("data-active", "true");
	}
	await page.keyboard.press("Escape");
}

async function expectWrapped(viewLines: Locator): Promise<void> {
	await expect(viewLines).toBeVisible();
	await expect.poll(() => viewLines.locator(":scope > .view-line").count()).toBeGreaterThan(1);
}

test("line-width controls validate drafts, converge on broadcasts, and persist", async ({
	page,
}) => {
	const channelHold = await installChannelHold(page);
	let release = () => {};
	try {
		await page.goto("/");
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openLineWidthSettings(page);
		const controls = widthControls(page);

		await expect(controls.chatInput).toHaveValue("120");
		await expect(controls.fileInput).toHaveValue("120");
		await expect(controls.chatBounded).toHaveAttribute("data-active", "true");
		await expect(controls.fileBounded).toHaveAttribute("data-active", "true");

		await controls.chatInput.fill("90");
		await controls.chatInput.press("Escape");
		await expect(controls.chatInput).toHaveValue("120");

		await controls.chatInput.fill("39");
		await expect(controls.chatInput).toHaveAttribute("aria-invalid", "true");
		await expect(page.getByText("Enter a whole number from 40 to 240.")).toBeVisible();
		await expect(controls.chatSave).toBeDisabled();

		await controls.chatInput.fill("80");
		await expect(controls.chatSave).toBeEnabled();
		await controls.chatInput.press("Enter");
		await expect(controls.chatSave).toBeDisabled();
		await saveWidth(controls.fileInput, controls.fileSave, 160);

		const held = channelHold.arm("settings.changed");
		release = held.release;
		await controls.chatBounded.click();
		await held.held;
		await expect(controls.chatBounded).toHaveAttribute("data-active", "true");
		release();
		release = () => {};
		await expect(controls.chatBounded).toHaveAttribute("data-active", "false");
		await expect(controls.fileBounded).toHaveAttribute("data-active", "true");

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openLineWidthSettings(page);
		await expect(controls.chatInput).toHaveValue("80");
		await expect(controls.fileInput).toHaveValue("160");
		await expect(controls.chatBounded).toHaveAttribute("data-active", "false");
		await expect(controls.fileBounded).toHaveAttribute("data-active", "true");
	} finally {
		release();
		await restoreLineWidthDefaults(page).catch(() => {});
	}
});

test("the file width wraps source and updates an already-mounted editor", async ({ page }) => {
	try {
		await openFixtureProject(page);
		await createWorkspaceViaDialog(page);
		await page.getByTestId("tab-files").click();
		await page.getByTestId("file-node").filter({ hasText: "LONG_LINE.txt" }).dblclick();

		const viewLines = page.locator('[data-testid="editor-pane"]:visible .view-lines');
		await expectWrapped(viewLines);
		const defaultVisualLines = await viewLines.locator(":scope > .view-line").count();

		await openLineWidthSettings(page);
		const controls = widthControls(page);
		await saveWidth(controls.fileInput, controls.fileSave, 40);
		await page.keyboard.press("Escape");
		await expect
			.poll(() => viewLines.locator(":scope > .view-line").count())
			.toBeGreaterThan(defaultVisualLines);
	} finally {
		await restoreLineWidthDefaults(page).catch(() => {});
	}
});

test("the default file width wraps both sides of a long-line diff", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "LONG_LINE.txt"), `changed ${LONG_LINE}`);

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "LONG_LINE.txt" }).click();
	const viewLineGroups = page.getByTestId("diff-pane").locator(".view-lines");
	await expect(viewLineGroups).toHaveCount(2);
	await expectWrapped(viewLineGroups.nth(0));
	await expectWrapped(viewLineGroups.nth(1));
});

test("chat uses the selected measure and optionally exceeds a narrow pane", async ({ page }) => {
	try {
		await openWorkspaceChat(page);
		await openLineWidthSettings(page);
		const controls = widthControls(page);
		await saveWidth(controls.chatInput, controls.chatSave, 40);
		await page.keyboard.press("Escape");

		const input = page.getByTestId("chat-input");
		await input.fill(LONG_LINE);
		await input.press("Enter");
		const userMessage = page.locator('[data-testid="chat-message"][data-role="user"]').last();
		await expect(userMessage).toBeVisible();
		const row = userMessage.locator('xpath=ancestor::*[@data-testid="chat-row"][1]');
		const measure = await row.evaluate((element) => {
			const probe = document.createElement("div");
			probe.style.position = "fixed";
			probe.style.width = "40ch";
			document.body.append(probe);
			const expectedTextWidth = probe.getBoundingClientRect().width;
			probe.remove();
			return {
				actual: element.getBoundingClientRect().width,
				expected: expectedTextWidth + 24,
			};
		});
		expect(Math.abs(measure.actual - measure.expected)).toBeLessThanOrEqual(2);

		await openLineWidthSettings(page);
		await saveWidth(controls.chatInput, controls.chatSave, 240);
		await page.keyboard.press("Escape");
		await hideAuxiliaryWorkbench(page);
		await page.setViewportSize(PHONE_VIEWPORT);
		const transcriptScroll = page.getByTestId("chat-transcript-scroll");
		await expect
			.poll(async () => {
				const rowBox = await row.boundingBox();
				const scrollBox = await transcriptScroll.boundingBox();
				return rowBox !== null && scrollBox !== null && rowBox.width <= scrollBox.width + 1;
			})
			.toBe(true);

		await openLineWidthSettings(page);
		await controls.chatBounded.click();
		await expect(controls.chatBounded).toHaveAttribute("data-active", "false");
		await page.keyboard.press("Escape");
		await expect
			.poll(() => transcriptScroll.evaluate((element) => element.scrollWidth > element.clientWidth))
			.toBe(true);
		const overflow = await transcriptScroll.evaluate((element) => ({
			clientWidth: element.clientWidth,
			scrollLeft: element.scrollLeft,
			scrollWidth: element.scrollWidth,
		}));
		expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
		expect(overflow.scrollLeft).toBe(0);
	} finally {
		await restoreLineWidthDefaults(page).catch(() => {});
	}
});
