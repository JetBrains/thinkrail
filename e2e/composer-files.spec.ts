import { expect, type Locator, type Page, test } from "@playwright/test";
import type { NativeClipboardBridge, NativeClipboardFile } from "@thinkrail/contracts";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

async function openChatComposer(page: Page): Promise<Locator> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();
	return input;
}

async function png(page: Page, width: number, height: number) {
	return page.evaluate(
		(size) => {
			const canvas = document.createElement("canvas");
			canvas.width = size.width;
			canvas.height = size.height;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("No canvas context");
			context.fillStyle = "#3366aa";
			context.fillRect(0, 0, size.width, size.height);
			const data = canvas.toDataURL("image/png").split(",")[1];
			if (!data) throw new Error("No PNG data");
			return { data, mimeType: "image/png" };
		},
		{ width, height },
	);
}

async function nativeFiles(page: Page, files: NativeClipboardFile[]): Promise<void> {
	await page.evaluate((entries) => {
		const bridge: NativeClipboardBridge = { readFiles: async () => entries };
		Reflect.set(globalThis, "__THINKRAIL_NATIVE_CLIPBOARD__", bridge);
	}, files);
}

async function holdNativeFiles(page: Page): Promise<void> {
	await page.evaluate(() => {
		const pending: ((files: NativeClipboardFile[]) => void)[] = [];
		const bridge: NativeClipboardBridge = {
			readFiles: () =>
				new Promise<NativeClipboardFile[]>((resolve) => {
					pending.push(resolve);
				}),
		};
		Reflect.set(globalThis, "__resolveClipboardFiles", (files: NativeClipboardFile[]) => {
			for (const resolve of pending.splice(0)) resolve(files);
		});
		Reflect.set(globalThis, "__THINKRAIL_NATIVE_CLIPBOARD__", bridge);
	});
}

async function resolveNativeFiles(page: Page, files: NativeClipboardFile[]): Promise<void> {
	await page.evaluate((entries) => {
		const resolve: unknown = Reflect.get(globalThis, "__resolveClipboardFiles");
		if (typeof resolve !== "function") throw new Error("Clipboard read was not started");
		resolve(entries);
		Reflect.deleteProperty(globalThis, "__resolveClipboardFiles");
	}, files);
}

async function paste(
	input: Locator,
	payload: { text?: string; file?: { name: string; data: string; mimeType: string } },
): Promise<boolean> {
	return input.evaluate((element, contents) => {
		const clipboardData = new DataTransfer();
		if (contents.text !== undefined) clipboardData.setData("text/plain", contents.text);
		if (contents.file) {
			const { name, data, mimeType } = contents.file;
			const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
			clipboardData.items.add(new File([bytes], name, { type: mimeType }));
		}
		const event = new ClipboardEvent("paste", {
			clipboardData,
			bubbles: true,
			cancelable: true,
		});
		element.dispatchEvent(event);
		return event.defaultPrevented;
	}, payload);
}

test.describe("web clipboard behavior with an injected bridge (not native API coverage)", () => {
	for (const [platform, root] of [
		["macOS", "/Users/example/资料 folder"],
		["Windows", "C:\\Users\\example\\资料 folder"],
		["Linux", "/home/example/资料 folder"],
	]) {
		test(`${platform} paths: mixed PDF, folder and real PNG ignore the clipboard icon`, async ({
			page,
		}) => {
			const input = await openChatComposer(page);
			const separator = platform === "Windows" ? "\\" : "/";
			const pdf = `${root}${separator}报告 final.pdf`;
			const folder = `${root}${separator}参考 files`;
			const imagePath = `${root}${separator}真实 image.png`;
			await nativeFiles(page, [
				{ path: pdf },
				{ path: folder },
				{ path: imagePath, image: await png(page, 320, 180) },
			]);
			await input.fill("Review: REPLACE please");
			await input.evaluate((element) => {
				if (!(element instanceof HTMLTextAreaElement)) throw new Error("Expected textarea");
				element.setSelectionRange(8, 15);
			});
			expect(
				await paste(input, {
					text: [pdf, folder, imagePath].join("\n"),
					file: { name: "file-icon.png", ...(await png(page, 16, 16)) },
				}),
			).toBe(true);

			await expect(page.getByTestId("composer-image-pending")).toHaveCount(0);
			await expect(input).toHaveValue(`Review: ${pdf}\n${folder} please`);
			const chip = page.getByTestId("composer-image");
			await expect(chip).toHaveCount(1);
			await expect(chip).toContainText("真实 image.png");
			await expect(chip).toHaveAttribute("data-width", "320");
			await expect(chip).toHaveAttribute("data-height", "180");
			await expect(chip).toHaveAttribute("data-mime", "image/png");
			await expect(page.getByTestId("composer-image-error")).toHaveCount(0);
			await input.pressSequentially(" INSERTED");
			await expect(input).toHaveValue(`Review: ${pdf}\n${folder} INSERTED please`);
		});
	}

	test("a path inserted at a caret preserves both adjacent words and unicode", async ({ page }) => {
		const input = await openChatComposer(page);
		const path = "/home/example/项目 notes/说明.pdf";
		await nativeFiles(page, [{ path }]);
		await input.fill("beforeafter");
		await input.evaluate((element) => {
			if (!(element instanceof HTMLTextAreaElement)) throw new Error("Expected textarea");
			element.setSelectionRange(6, 6);
		});
		await paste(input, { text: path });
		await expect(input).toHaveValue(`before ${path} after`);
		await input.pressSequentially("next ");
		await expect(input).toHaveValue(`before ${path} next after`);
	});

	test("an empty native list leaves a screenshot as a real attachment", async ({ page }) => {
		const input = await openChatComposer(page);
		await nativeFiles(page, []);
		await input.fill("Describe this screenshot");
		await paste(input, { file: { name: "screenshot.png", ...(await png(page, 640, 480)) } });
		const chip = page.getByTestId("composer-image");
		await expect(chip).toHaveCount(1);
		await expect(chip).toContainText("screenshot.png");
		await expect(chip).toHaveAttribute("data-width", "640");
		await expect(chip).toHaveAttribute("data-height", "480");
		await expect(input).toHaveValue("Describe this screenshot");
		await expect(page.getByTestId("composer-image-error")).toHaveCount(0);
	});

	test("unsupported native HEIC bytes fall back to their path, never the clipboard icon", async ({
		page,
	}) => {
		const input = await openChatComposer(page);
		const path = "/Users/example/照片 holiday/photo.heic";
		await nativeFiles(page, [{ path, image: { data: "AAECAwQ=", mimeType: "image/heic" } }]);
		await paste(input, {
			text: path,
			file: { name: "file-icon.png", ...(await png(page, 16, 16)) },
		});
		await expect(input).toHaveValue(path);
		await expect(page.getByTestId("composer-image")).toHaveCount(0);
		await expect(page.getByTestId("composer-image-error")).toHaveCount(0);
	});

	test("browser PDF paste reports unavailable paths while preserving draft and clipboard text", async ({
		page,
	}) => {
		const input = await openChatComposer(page);
		await page.evaluate(() => Reflect.deleteProperty(globalThis, "__THINKRAIL_NATIVE_CLIPBOARD__"));
		await input.fill("Keep this: ");
		await paste(input, {
			text: "copied description",
			file: { name: "report.pdf", data: "JVBERi0xLjc=", mimeType: "application/pdf" },
		});
		const error = page.getByTestId("composer-image-error");
		await expect(error).toBeVisible();
		await expect(error).toContainText("report.pdf");
		await expect(error).toContainText("file path unavailable");
		await expect(input).toHaveValue("Keep this: copied description");
		await expect(page.getByTestId("composer-image")).toHaveCount(0);
	});

	test("native rejection reports an error instead of attaching an icon, but text-only paste works", async ({
		page,
	}) => {
		const input = await openChatComposer(page);
		await page.evaluate(() => {
			const bridge: NativeClipboardBridge = {
				readFiles: async () => {
					throw new Error("Synthetic native clipboard failure");
				},
			};
			Reflect.set(globalThis, "__THINKRAIL_NATIVE_CLIPBOARD__", bridge);
		});
		await input.fill("Existing draft ");
		await paste(input, {
			text: "/private/file.pdf",
			file: { name: "file-icon.png", ...(await png(page, 16, 16)) },
		});
		const error = page.getByTestId("composer-image-error");
		await expect(error).toBeVisible();
		await expect(error).toContainText("couldn't read file paths");
		await expect(page.getByTestId("composer-image")).toHaveCount(0);
		await expect(input).toHaveValue("Existing draft ");
		await error.getByRole("button", { name: "Dismiss" }).click();
		await paste(input, { text: "plain text still works" });
		await expect(input).toHaveValue("Existing draft plain text still works");
		await expect(error).toHaveCount(0);
	});

	test("pending native reads block sending until their paths are inserted", async ({ page }) => {
		const input = await openChatComposer(page);
		await holdNativeFiles(page);
		await input.fill("Review");
		await paste(input, {
			file: { name: "report.pdf", data: "JVBERi0xLjc=", mimeType: "application/pdf" },
		});
		await expect(page.getByTestId("composer-image-pending")).toBeVisible();
		await expect(page.getByTestId("chat-send")).toBeDisabled();
		await input.press("Enter");
		await expect(input).toHaveValue("Review");
		await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveCount(0);
		await resolveNativeFiles(page, [{ path: "/tmp/report.pdf" }]);
		await expect(input).toHaveValue("Review /tmp/report.pdf");
		await expect(page.getByTestId("composer-image-pending")).toHaveCount(0);
		await expect(page.getByTestId("chat-send")).toBeEnabled();
	});

	test("a draft edited during a native read is not overwritten or given stale attachments", async ({
		page,
	}) => {
		const input = await openChatComposer(page);
		const image = await png(page, 320, 180);
		await holdNativeFiles(page);
		await input.fill("Original draft");
		await paste(input, { text: "/tmp/report.pdf" });
		await expect(page.getByTestId("composer-image-pending")).toBeVisible();
		await input.fill("Edited while clipboard was pending");
		await resolveNativeFiles(page, [
			{ path: "/tmp/report.pdf" },
			{ path: "/tmp/photo.png", image },
		]);
		await expect(page.getByTestId("composer-image-pending")).toHaveCount(0);
		await expect(page.getByTestId("composer-image-error")).toContainText("draft changed");
		await expect(input).toHaveValue("Edited while clipboard was pending");
		await expect(page.getByTestId("composer-image")).toHaveCount(0);
		await expect(page.getByTestId("chat-send")).toBeEnabled();
	});

	test("ordinary text pastes are applied immediately even during a slow native lookup", async ({
		page,
	}) => {
		const input = await openChatComposer(page);
		await holdNativeFiles(page);
		await input.fill("Start ");
		await paste(input, { text: "first " });
		await expect(input).toHaveValue("Start first ");
		await input.pressSequentially("typed ");
		await paste(input, { text: "second" });
		await expect(input).toHaveValue("Start first typed second");
		await resolveNativeFiles(page, []);
		await expect(page.getByTestId("composer-image-pending")).toHaveCount(0);
		await expect(input).toHaveValue("Start first typed second");
		await expect(page.getByTestId("composer-image-error")).toHaveCount(0);
	});

	test("a copied image exposed as clipboard text does not leave a duplicate filename", async ({
		page,
	}) => {
		const input = await openChatComposer(page);
		await nativeFiles(page, [{ path: "/tmp/photo.png", image: await png(page, 320, 180) }]);
		await input.fill("Describe this ");
		await paste(input, { text: "photo.png" });
		await expect(page.getByTestId("composer-image")).toHaveCount(1);
		await expect(input).toHaveValue("Describe this ");
	});

	for (const change of ["selection", "edit and restore"] as const) {
		test(`a pending file paste is cancelled after ${change}`, async ({ page }) => {
			const input = await openChatComposer(page);
			await holdNativeFiles(page);
			await input.fill("original draft");
			await paste(input, {
				file: { name: "report.pdf", data: "JVBERi0xLjc=", mimeType: "application/pdf" },
			});
			await expect(page.getByTestId("composer-image-pending")).toBeVisible();
			if (change === "selection") await input.press("ArrowLeft");
			else {
				await input.fill("changed");
				await input.fill("original draft");
			}
			await resolveNativeFiles(page, [{ path: "/tmp/report.pdf" }]);
			await expect(page.getByTestId("composer-image-pending")).toHaveCount(0);
			await expect(input).toHaveValue("original draft");
			await expect(page.getByTestId("composer-image-error")).toContainText("draft changed");
		});
	}

	test("the workspace dialog uses the same mixed-file paste behavior and pending guard", async ({
		page,
	}) => {
		await openFixtureProject(page);
		await page.getByTestId("add-workspace").first().click();
		const dialog = page.getByTestId("new-workspace-dialog");
		await expect(dialog).toBeVisible();
		const prompt = dialog.getByTestId("ws-prompt");
		await holdNativeFiles(page);
		await prompt.fill("Review");
		await paste(prompt, {
			text: "/tmp/资料/report.pdf",
			file: { name: "file-icon.png", ...(await png(page, 16, 16)) },
		});
		await expect(dialog.getByTestId("composer-image-pending")).toBeVisible();
		await expect(page.getByTestId("create-workspace")).toBeDisabled();
		await prompt.press("Enter");
		await expect(dialog).toBeVisible();
		await resolveNativeFiles(page, [
			{ path: "/tmp/资料/report.pdf" },
			{ path: "/tmp/资料/folder notes" },
			{ path: "/tmp/资料/photo.png", image: await png(page, 320, 180) },
		]);
		await expect(prompt).toHaveValue("Review /tmp/资料/report.pdf\n/tmp/资料/folder notes");
		const chip = dialog.getByTestId("composer-image");
		await expect(chip).toHaveCount(1);
		await expect(chip).toContainText("photo.png");
		await expect(chip).toHaveAttribute("data-width", "320");
		await expect(chip).toHaveAttribute("data-height", "180");
		await expect(dialog.getByTestId("composer-image-error")).toHaveCount(0);
		await expect(dialog.getByTestId("composer-image-pending")).toHaveCount(0);
		await expect(page.getByTestId("create-workspace")).toBeEnabled();
	});
});
