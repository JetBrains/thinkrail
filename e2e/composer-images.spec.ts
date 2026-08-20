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

test("pasting a within-bounds BMP re-encodes it to a provider-accepted type", async ({ page }) => {
	await openChatComposer(page);

	// A hand-built 24bpp BMP, 64×48 — within every pixel bound, but `image/bmp` is not a type the
	// provider accepts, so the attach pipeline must re-encode it (as PNG) instead of passing it raw.
	await page.getByTestId("chat-input").evaluate(async (el) => {
		const w = 64;
		const h = 48;
		const rowSize = Math.ceil((w * 3) / 4) * 4;
		const size = 54 + rowSize * h;
		const view = new DataView(new ArrayBuffer(size));
		view.setUint8(0, 0x42); // 'B'
		view.setUint8(1, 0x4d); // 'M'
		view.setUint32(2, size, true);
		view.setUint32(10, 54, true); // pixel data offset
		view.setUint32(14, 40, true); // BITMAPINFOHEADER
		view.setInt32(18, w, true);
		view.setInt32(22, h, true);
		view.setUint16(26, 1, true); // planes
		view.setUint16(28, 24, true); // bpp
		view.setUint32(34, rowSize * h, true);
		const file = new File([view.buffer], "shot.bmp", { type: "image/bmp" });
		const dt = new DataTransfer();
		dt.items.add(file);
		el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
	});

	const chip = page.getByTestId("composer-image");
	await expect(chip).toHaveCount(1);
	await expect(chip).toHaveAttribute("data-width", "64");
	await expect(chip).toHaveAttribute("data-height", "48");
	await expect(chip).toHaveAttribute("data-mime", "image/png");
	await expect(chip).toContainText("shot.bmp");
});

test("an undecodable provider-unsupported file is refused with an error chip, never attached raw", async ({
	page,
}) => {
	await openChatComposer(page);

	// Garbage bytes labeled image/heic: Chromium can't decode it, and the provider rejects the media
	// type outright — the old raw fallback would poison the session, so the composer must refuse it
	// and say so (silently dropping the pick would read as a successful attach).
	await page.getByTestId("chat-input").evaluate(async (el) => {
		const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])], "photo.heic", {
			type: "image/heic",
		});
		const dt = new DataTransfer();
		dt.items.add(file);
		el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
	});

	const error = page.getByTestId("composer-image-error");
	await expect(error).toHaveCount(1);
	await expect(error).toContainText("photo.heic");
	await expect(page.getByTestId("composer-image")).toHaveCount(0);

	// Dismissible — the strip returns to empty.
	await error.getByRole("button", { name: "Dismiss" }).click();
	await expect(error).toHaveCount(0);
});
