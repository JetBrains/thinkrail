import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { FAKE_SPEECH_TEXT } from "./fixtures/speech";
import { E2eWire } from "./fixtures/wire";

test.skip(process.platform === "win32", "the fake speech runtime is a POSIX shell wrapper");
test.describe.configure({ mode: "serial" });
test.use({
	launchOptions: {
		args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
	},
});

const SPEECH_DIR = join(E2E_DATA_DIR, "speech");

async function removeVoiceInput(baseURL: string | undefined): Promise<void> {
	if (!baseURL) throw new Error("voice input fixtures need the isolated host URL");
	const wire = await E2eWire.connect(Number(new URL(baseURL).port));
	try {
		await wire.request("speech.remove", {});
	} finally {
		wire.close();
	}
}

const mic = (page: Page) => page.getByTestId("chat-composer").getByTestId("speech-mic");

async function installVoice(page: Page): Promise<void> {
	await expect(mic(page)).toHaveAttribute("data-mic-state", "offer");
	await mic(page).click();
	const offer = page.getByTestId("speech-offer");
	await expect(offer).toContainText("MB");
	await offer.getByTestId("speech-offer-download").click();
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready", { timeout: 20_000 });
}

test.beforeAll(async ({ baseURL }) => {
	await removeVoiceInput(baseURL);
});

test("the first mic click offers the one-time download, and Not now leaves it uninstalled", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "offer");
	await mic(page).click();
	await expect(page.getByTestId("speech-offer")).toBeVisible();
	await page.getByTestId("speech-offer-later").click();
	await expect(page.getByTestId("speech-offer")).toHaveCount(0);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "offer");
	expect(existsSync(join(SPEECH_DIR, "installed.json"))).toBe(false);
});

test("dictation streams into the draft, locks it while listening, and never sends", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	const input = page.getByTestId("chat-input");
	await installVoice(page);
	await input.fill("Please");
	await mic(page).click();
	await expect(mic(page)).toHaveAttribute("data-mic-state", "listening");
	await expect(input).toHaveAttribute("readonly", "");
	await expect(page.getByTestId("chat-send")).toBeDisabled();
	await expect(input).toHaveValue(`Please ${FAKE_SPEECH_TEXT}`, { timeout: 15_000 });
	await mic(page).click();
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
	await expect(input).not.toHaveAttribute("readonly", "");
	await expect(input).toHaveValue(`Please ${FAKE_SPEECH_TEXT}`);
	await expect(page.getByTestId("chat-send-pill")).toHaveAttribute("data-armed", "true");
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveCount(0);
});

test("the keyboard chord toggles dictation and Esc stops it, keeping the text", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	const input = page.getByTestId("chat-input");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
	await input.fill("");
	await page.getByTestId("chat-scroll").click();
	await page.keyboard.press("ControlOrMeta+Shift+Space");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "listening");
	await expect(input).toBeFocused();
	await expect(input).toHaveValue(/Hello/, { timeout: 15_000 });
	await page.keyboard.press("Escape");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
	await expect(input).toHaveValue(/^Hello/);
});

test("removing voice input deletes its files and brings the offer back", async ({
	page,
	baseURL,
}) => {
	await openWorkspaceChat(page);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
	await removeVoiceInput(baseURL);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "offer");
	expect(existsSync(SPEECH_DIR)).toBe(false);
});
