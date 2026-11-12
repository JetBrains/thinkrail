import { appendFileSync, realpathSync, utimesSync } from "node:fs";
import { expect, type Locator, test } from "@playwright/test";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	expandActivityStep,
	openFixtureProject,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_700_000_000;
const IMAGE_PATH = "/tmp/tab-overflow-mockups.png";
const IMAGE_DATA =
	"iVBORw0KGgoAAAANSUhEUgAAAKAAAABaBAMAAADN6EBhAAAALVBMVEURExgcJx1KfzF52UaN/0952kZKfzEcJx09Zyw9ZyxrvUAuSiUuSiVqvUBGeC8W2BlUAAAA4UlEQVRYw2NgGAWjYLAARmUXioFrOpKBLS7UABPg5nFSxTwXD7iBJdQx0EUAZmAKlQxUgBkYQiUDDWAGgjirKUsnPFeAZjggGehHacrjQzPwAsVpeQmqgQcoNnALqoGU5zaWUQOHhoHkZjmHUQNHDRzMBo4WDqMGDrECdtTAUQOHjoGjhcOogUO0BTtq4KiBg9/A0cJhmBu4gWIDj6AauIBiA6/QeOzL5Q5l5nEvQTbQhErjhwEwA1WoZGACzEARKhlYADOQgzrmeSKCdApVDGxAGMieSrlxzoqjMxajgFwAAJtSvgebw8WoAAAAAElFTkSuQmCC";

const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);
const IMAGE_REF_URL = /\/images\/[A-Za-z0-9._-]+\/[0-9a-f]{64}$/;

async function expectDecoded(image: Locator): Promise<void> {
	await expect
		.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
}

function appendToolImageResult(path: string, sessionId: string): void {
	const toolCallId = `${sessionId}-read-image`;
	const entries = [
		{
			type: "message",
			id: `${sessionId}-m1`,
			parentId: `${sessionId}-m0`,
			timestamp: new Date(BASE_TS + 1_000).toISOString(),
			message: {
				role: "assistant",
				content: [
					{ type: "toolCall", id: toolCallId, name: "read", arguments: { path: IMAGE_PATH } },
				],
				timestamp: BASE_TS + 1_000,
			},
		},
		{
			type: "message",
			id: `${sessionId}-m2`,
			parentId: `${sessionId}-m1`,
			timestamp: new Date(BASE_TS + 2_000).toISOString(),
			message: {
				role: "toolResult",
				toolCallId,
				toolName: "read",
				content: [
					{ type: "text", text: `${IMAGE_PATH}\nRead image file [image/png]` },
					{ type: "image", data: IMAGE_DATA, mimeType: "image/png" },
				],
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		},
	];
	appendFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	utimesSync(path, new Date(BASE_TS), new Date(BASE_TS));
}

function appendUserImage(path: string, sessionId: string): void {
	const entry = {
		type: "message",
		id: `${sessionId}-u1`,
		parentId: `${sessionId}-m0`,
		timestamp: new Date(BASE_TS + 1_000).toISOString(),
		message: {
			role: "user",
			content: [
				{ type: "text", text: "what does this mockup show?" },
				{ type: "image", data: IMAGE_DATA, mimeType: "image/png" },
			],
			timestamp: BASE_TS + 1_000,
		},
	};
	appendFileSync(path, `${JSON.stringify(entry)}\n`);
	utimesSync(path, new Date(BASE_TS), new Date(BASE_TS));
}

test("a reopened chat's attachment loads its image by URL", async ({ page }) => {
	await openFixtureProject(page);
	const chat = seedWorkspaceSession(repoCwd(), {
		name: "image attachment",
		messages: [{ role: "user", text: "look at this", timestamp: BASE_TS }],
	});
	appendUserImage(chat.path, chat.id);

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	const chip = page.getByTestId("chat-attachment-chip");
	await expect(chip).toHaveCount(1);
	await chip.click();
	const dialog = page.getByTestId("chat-attachment-dialog");
	await expect(dialog).toBeVisible();
	const image = dialog.getByRole("img");
	await expect(image).toHaveAttribute("src", IMAGE_REF_URL);
	await expectDecoded(image);
});

test("an image tool result previews inline and opens full screen", async ({ page }) => {
	await openFixtureProject(page);
	const chat = seedWorkspaceSession(repoCwd(), {
		name: "image result",
		messages: [{ role: "user", text: "read the mockup image", timestamp: BASE_TS }],
	});
	appendToolImageResult(chat.path, chat.id);

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const step = await expandActivityStep(page, "read");
	const thumbnail = step.getByTestId("tool-result-image-thumbnail");
	await expect(thumbnail).toBeVisible();
	await expect(thumbnail).toHaveAttribute("src", IMAGE_REF_URL);
	await expect(thumbnail).toHaveAttribute("width", "160");
	await expect(thumbnail).toHaveAttribute("height", "90");
	await expectDecoded(thumbnail);

	const fullScreen = step.getByTestId("tool-result-image-fullscreen");
	await expect(fullScreen).toHaveAccessibleName(`View ${IMAGE_PATH} full screen`);
	await fullScreen.click();

	const dialog = page.getByTestId("tool-result-image-dialog");
	await expect(dialog).toBeVisible();
	const fullImage = dialog.getByRole("img", { name: IMAGE_PATH });
	await expect(fullImage).toHaveAttribute("src", IMAGE_REF_URL);
	await expectDecoded(fullImage);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(fullScreen).toBeFocused();
});
