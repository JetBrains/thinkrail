import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	openWorkspaceChat,
	PHONE_VIEWPORT,
	revealWorkbenchTool,
} from "./fixtures/app";
import { installChannelHold } from "./fixtures/channelHold";
import { pierreDeletionsSide } from "./fixtures/pierre";
import { LONG_LINE } from "./fixtures/repo";

type LineWidthKind = "chat" | "file";

// Chat line width lives on the Chat page, the file line width in Appearance → Editor.
const LINE_WIDTH_NAV: Record<LineWidthKind, string> = {
	chat: "settings-nav-chat",
	file: "settings-nav-appearance",
};

function widthControls(page: Page, kind: LineWidthKind) {
	return {
		input: page.getByTestId(`${kind}-line-width-input`),
		bounded: page.getByTestId(`${kind}-line-width-bounded`),
	};
}

async function openLineWidthSettings(page: Page, kind: LineWidthKind) {
	if (!(await page.getByTestId("settings-dialog").isVisible())) {
		await page.getByTestId("open-settings").click();
	}
	const nav = page.getByTestId(LINE_WIDTH_NAV[kind]);
	await expect(nav).toBeVisible();
	await nav.click();
	await expect(page.getByTestId(`${kind}-line-width-control`)).toBeVisible();
	return widthControls(page, kind);
}

/**
 * Widths auto-save on Enter. Escape then drops the draft back to the stored width, so the value
 * reads `value` only once the host's settings broadcast has reached this page's store.
 */
async function saveWidth(input: Locator, value: number): Promise<void> {
	await input.fill(String(value));
	await input.press("Enter");
	await input.press("Escape");
	await expect(input).toHaveValue(String(value));
}

/** Escape inside a focused width draft only resets that draft, so close the dialog by its button. */
async function closeSettings(page: Page): Promise<void> {
	const dialog = page.getByTestId("settings-dialog");
	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(dialog).toBeHidden();
}

async function restoreLineWidthDefaults(page: Page): Promise<void> {
	if (page.isClosed()) return;
	if (await page.getByTestId("settings-dialog").isVisible()) await closeSettings(page);
	for (const kind of ["chat", "file"] as const) {
		const controls = await openLineWidthSettings(page, kind);
		if ((await controls.input.inputValue()) !== "120") await saveWidth(controls.input, 120);
		if ((await controls.bounded.getAttribute("data-active")) !== "true") {
			await controls.bounded.click();
			await expect(controls.bounded).toHaveAttribute("data-active", "true");
		}
	}
	await closeSettings(page);
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
		const chat = await openLineWidthSettings(page, "chat");
		await expect(chat.input).toHaveValue("120");
		await expect(chat.bounded).toHaveAttribute("data-active", "true");
		const file = await openLineWidthSettings(page, "file");
		await expect(file.input).toHaveValue("120");
		await expect(file.bounded).toHaveAttribute("data-active", "true");

		await openLineWidthSettings(page, "chat");
		await chat.input.fill("90");
		await chat.input.press("Escape");
		await expect(chat.input).toHaveValue("120");

		await chat.input.fill("39");
		await expect(chat.input).toHaveAttribute("aria-invalid", "true");
		await expect(page.getByText("Enter a whole number from 40 to 240.")).toBeVisible();
		// An invalid draft is never committed: Enter keeps the draft and its error.
		await chat.input.press("Enter");
		await expect(chat.input).toHaveValue("39");
		await expect(chat.input).toHaveAttribute("aria-invalid", "true");

		await saveWidth(chat.input, 80);
		await expect(chat.input).not.toHaveAttribute("aria-invalid", "true");
		await openLineWidthSettings(page, "file");
		await saveWidth(file.input, 160);

		await openLineWidthSettings(page, "chat");
		const held = channelHold.arm("settings.changed");
		release = held.release;
		await chat.bounded.click();
		await held.held;
		await expect(chat.bounded).toHaveAttribute("data-active", "true");
		release();
		release = () => {};
		await expect(chat.bounded).toHaveAttribute("data-active", "false");
		await openLineWidthSettings(page, "file");
		await expect(file.bounded).toHaveAttribute("data-active", "true");

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openLineWidthSettings(page, "chat");
		await expect(chat.input).toHaveValue("80");
		await expect(chat.bounded).toHaveAttribute("data-active", "false");
		await openLineWidthSettings(page, "file");
		await expect(file.input).toHaveValue("160");
		await expect(file.bounded).toHaveAttribute("data-active", "true");
	} finally {
		release();
		await restoreLineWidthDefaults(page).catch(() => {});
	}
});

test("the file width wraps source and updates an already-mounted editor", async ({ page }) => {
	try {
		await openFixtureProject(page);
		await createWorkspaceViaDialog(page);
		await revealWorkbenchTool(page, "files");
		await page.getByTestId("file-node").filter({ hasText: "LONG_LINE.txt" }).dblclick();

		const viewLines = page.locator('[data-testid="editor-pane"]:visible .view-lines');
		await expectWrapped(viewLines);
		const defaultVisualLines = await viewLines.locator(":scope > .view-line").count();

		const file = await openLineWidthSettings(page, "file");
		await saveWidth(file.input, 40);
		await closeSettings(page);
		await expect
			.poll(() => viewLines.locator(":scope > .view-line").count())
			.toBeGreaterThan(defaultVisualLines);
	} finally {
		await restoreLineWidthDefaults(page).catch(() => {});
	}
});

test("Pierre renders both sides of a long-line diff", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "LONG_LINE.txt"), `changed ${LONG_LINE}`);

	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "LONG_LINE.txt" }).dblclick();
	const diff = page.getByTestId("diff-view");
	await expect(
		pierreDeletionsSide(diff).getByText(LONG_LINE.trim(), { exact: false }).last(),
	).toBeVisible();
	await expect(
		diff
			.locator("[data-additions]")
			.getByText(`changed ${LONG_LINE}`.trim(), { exact: false })
			.last(),
	).toBeVisible();
});

test("chat uses the selected measure and optionally exceeds a narrow pane", async ({ page }) => {
	try {
		await openWorkspaceChat(page);
		const chat = await openLineWidthSettings(page, "chat");
		await saveWidth(chat.input, 40);
		await closeSettings(page);

		const input = page.getByTestId("chat-input");
		await input.fill(LONG_LINE);
		await input.press("Enter");
		const userMessage = page.locator('[data-testid="chat-message"][data-role="user"]').last();
		await expect(userMessage).toBeVisible();
		const row = userMessage.locator('xpath=ancestor::*[@data-testid="chat-row"][1]');
		// Poll the measure: the `--chat-transcript-width` custom property is applied via a ref callback and a
		// native webview can flush its layout a frame later, so a single synchronous read is racy.
		await expect
			.poll(() =>
				row.evaluate((element) => {
					const probe = document.createElement("div");
					probe.style.position = "fixed";
					probe.style.width = "40ch";
					document.body.append(probe);
					const expectedTextWidth = probe.getBoundingClientRect().width;
					probe.remove();
					const gutter = Number.parseFloat(
						getComputedStyle(document.documentElement).getPropertyValue("--chat-gutter"),
					);
					return Math.abs(element.getBoundingClientRect().width - (expectedTextWidth + 2 * gutter));
				}),
			)
			.toBeLessThanOrEqual(2);

		await openLineWidthSettings(page, "chat");
		await saveWidth(chat.input, 240);
		await closeSettings(page);
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

		await openLineWidthSettings(page, "chat");
		await chat.bounded.click();
		await expect(chat.bounded).toHaveAttribute("data-active", "false");
		await closeSettings(page);
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
