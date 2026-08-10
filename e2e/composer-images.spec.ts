import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// Attach-time image downscale (TASK-image-attachment-downscale): a pasted/dropped image larger than
// 1568px on its long edge is downscaled in the browser BEFORE it becomes an ImageContent — otherwise it
// enters the session history raw and, once the request carries >20 images, Anthropic's 2000px per-side
// cap 400s every subsequent turn (the "bricked chat"). The composer chip surfaces the final W×H
// (`composer-image` testid, data-width/data-height), which is what these specs assert against. No agent
// needed: the composer is interactive as soon as the chat tab mounts, and nothing here sends a prompt.

/** Open the fixture project and land in a workspace with a mounted chat composer. */
async function openChatComposer(page: import("@playwright/test").Page): Promise<void> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("chat-input")).toBeVisible();
}

/** Paste a generated PNG of the given size into the composer via a synthetic ClipboardEvent. */
async function pastePng(
	page: import("@playwright/test").Page,
	width: number,
	height: number,
): Promise<void> {
	await page.getByTestId("chat-input").evaluate(
		async (el, size) => {
			const canvas = document.createElement("canvas");
			canvas.width = size.width;
			canvas.height = size.height;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("no 2d context");
			ctx.fillStyle = "#3366aa";
			ctx.fillRect(0, 0, size.width, size.height);
			const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
			if (!blob) throw new Error("toBlob failed");
			const file = new File([blob], "pasted.png", { type: "image/png" });
			const dt = new DataTransfer();
			dt.items.add(file);
			el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
		},
		{ width, height },
	);
}

test("pasting an oversized image downscales it to the 1568px long edge before it can be sent", async ({
	page,
}) => {
	await openChatComposer(page);

	// 2400×1600 would trip Anthropic's 2000px many-image cap if sent raw.
	await pastePng(page, 2400, 1600);

	const chip = page.getByTestId("composer-image");
	await expect(chip).toHaveCount(1);
	await expect(chip).toHaveAttribute("data-width", "1568");
	await expect(chip).toHaveAttribute("data-height", "1045"); // 1600 * (1568 / 2400), rounded
	await expect(chip).toContainText("1568×1045");
});

test("pasting a small image leaves its dimensions untouched", async ({ page }) => {
	await openChatComposer(page);

	await pastePng(page, 640, 480);

	const chip = page.getByTestId("composer-image");
	await expect(chip).toHaveCount(1);
	await expect(chip).toHaveAttribute("data-width", "640");
	await expect(chip).toHaveAttribute("data-height", "480");
});
