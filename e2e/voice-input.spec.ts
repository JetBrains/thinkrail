import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openWorkspaceChat, revealWorkbenchTool } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_SPEECH_PORT } from "./fixtures/paths";
import {
	FAKE_SPEECH_TEXT,
	REAL_SPEECH_E2E_ENV,
	SLOW_MODEL_PATH,
	slowModelBytes,
} from "./fixtures/speech";
import { E2eWire } from "./fixtures/wire";

test.skip(process.platform === "win32", "the fake speech runtime is a POSIX shell wrapper");
test.skip(
	process.env[REAL_SPEECH_E2E_ENV] === "1",
	"the real-engine run keeps the fixture manifest off the host",
);
test.describe.configure({ mode: "serial" });
test.use({
	launchOptions: {
		args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
	},
});

const SPEECH_DIR = join(E2E_DATA_DIR, "speech");

async function hostWire(baseURL: string | undefined): Promise<E2eWire> {
	if (!baseURL) throw new Error("voice input fixtures need the isolated host URL");
	return E2eWire.connect(Number(new URL(baseURL).port));
}

async function removeVoiceInput(baseURL: string | undefined): Promise<void> {
	const wire = await hostWire(baseURL);
	try {
		await wire.request("speech.remove", {});
	} finally {
		wire.close();
	}
}

async function serveSlowModel(): Promise<() => Promise<void>> {
	const body = slowModelBytes();
	const server = createServer((request, response) => {
		if (request.url !== SLOW_MODEL_PATH) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "Content-Length": body.byteLength });
		let offset = 0;
		const timer = setInterval(() => {
			if (offset >= body.byteLength) {
				clearInterval(timer);
				response.end();
				return;
			}
			response.write(body.subarray(offset, offset + 16));
			offset += 16;
		}, 200);
		response.on("close", () => clearInterval(timer));
	});
	await new Promise<void>((resolve) => server.listen(E2E_SPEECH_PORT, "127.0.0.1", resolve));
	return () =>
		new Promise<void>((resolve) => {
			server.closeAllConnections();
			server.close(() => resolve());
		});
}

const mic = (page: Page) => page.getByTestId("speech-mic");

async function openChat(page: Page): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").focus();
}

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
	await openChat(page);
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
	await openChat(page);
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

test("the keyboard chord toggles dictation, keeping the text, and Esc is not a dictation key", async ({
	page,
}) => {
	await openChat(page);
	const input = page.getByTestId("chat-input");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
	await input.fill("");
	await page.getByTestId("chat-scroll").click();
	await page.keyboard.press("ControlOrMeta+Shift+Space");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "listening");
	await expect(input).toBeFocused();
	await expect(input).toHaveValue(/Hello/, { timeout: 15_000 });
	await page.keyboard.press("ControlOrMeta+Shift+Space");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
	await page.keyboard.press("ControlOrMeta+Shift+Space");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "listening");
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "listening");
	await page.keyboard.press("ControlOrMeta+Shift+Space");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
	await expect(input).toHaveValue(/^Hello/);

	// Switching apps blurs the field but leaves it as document.activeElement.
	await page.keyboard.press("ControlOrMeta+Shift+Space");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "listening");
	await input.evaluate((field) => {
		document.hasFocus = () => false;
		field.dispatchEvent(new FocusEvent("blur"));
	});
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
	await input.evaluate(() => {
		Reflect.deleteProperty(document, "hasFocus");
	});
});

test("clicking the mic while a model downloads cancels the download", async ({ page, baseURL }) => {
	await openChat(page);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
	const stopServer = await serveSlowModel();
	const wire = await hostWire(baseURL);
	try {
		await wire.request("speech.install", { model: "english" });
		await expect(mic(page)).toHaveAttribute("data-mic-state", "installing");
		await expect(mic(page)).toBeEnabled();
		await expect(mic(page)).toHaveAttribute("aria-busy", "true");
		await mic(page).click();
		await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
		expect(existsSync(join(SPEECH_DIR, "models", "english.gguf"))).toBe(false);
		expect(existsSync(join(SPEECH_DIR, "models", "english.gguf.partial"))).toBe(false);
	} finally {
		wire.close();
		await stopServer();
	}
});

test("switching voice input off mid-download keeps the download's progress and Cancel in Settings", async ({
	page,
	baseURL,
}) => {
	await openChat(page);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
	const stopServer = await serveSlowModel();
	const wire = await hostWire(baseURL);
	try {
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-voice").click();
		const voice = page.getByTestId("settings-voice");
		await voice.getByTestId("settings-voice-language-english").click();
		await expect(voice.getByTestId("settings-voice-status")).toContainText("Downloading");
		await voice.getByTestId("settings-voice-toggle").click();
		await expect(voice.getByTestId("settings-voice-toggle")).toHaveAttribute(
			"data-active",
			"false",
		);
		await expect(voice.getByTestId("settings-voice-language")).toHaveCount(0);
		await voice.getByTestId("settings-voice-cancel").click();
		await expect(voice.getByTestId("settings-voice-status")).toHaveCount(0);
		expect(existsSync(join(SPEECH_DIR, "models", "english.gguf.partial"))).toBe(false);
	} finally {
		await wire.request("settings.update", { config: { voiceInputEnabled: true } });
		wire.close();
		await stopServer();
	}
	await page.keyboard.press("Escape");
});

test("a dialog's field gets the mic inside the dialog and Enter cannot create mid-dictation", async ({
	page,
}) => {
	await openChat(page);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
	const dialog = page.getByTestId("new-workspace-dialog");
	await page.getByTestId("add-workspace").first().click();
	await expect(dialog).toBeVisible();
	const prompt = dialog.getByTestId("ws-prompt");
	await prompt.fill("");
	const dialogMic = dialog.getByTestId("speech-mic");
	await expect(dialogMic).toHaveAttribute("tabindex", "-1");
	await dialogMic.click();
	await expect(dialogMic).toHaveAttribute("data-mic-state", "listening");
	await prompt.press("Enter");
	await expect(dialog).toBeVisible();
	await expect(prompt).toHaveValue(FAKE_SPEECH_TEXT, { timeout: 15_000 });
	await dialogMic.click();
	await expect(dialogMic).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
	await expect(prompt).toHaveValue(FAKE_SPEECH_TEXT);

	await dialogMic.click();
	await expect(dialogMic).toHaveAttribute("data-mic-state", "listening");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await page.getByTestId("chat-input").focus();
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
});

test("a review comment takes dictation and ⌘↩ cannot send it mid-dictation", async ({ page }) => {
	await openChat(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "voice-review.ts"), "export const spoken = true;\n");
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "voice-review.ts" }).click();
	const section = page.locator('[data-testid="changes-section"][data-path="voice-review.ts"]');
	await section.getByTestId("hunk-ask-agent").click();
	const composer = section.getByTestId("review-composer");
	const input = composer.getByTestId("review-composer-input");
	await expect(input).toBeFocused();
	const seeded = await input.inputValue();
	const reviewMic = mic(page);
	await reviewMic.click();
	await expect(reviewMic).toHaveAttribute("data-mic-state", "listening");
	await expect(input).toHaveValue(`${seeded}${FAKE_SPEECH_TEXT}`, { timeout: 15_000 });
	await input.press("ControlOrMeta+Enter");
	await expect(composer).toBeVisible();
	await reviewMic.click();
	await expect(reviewMic).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
	await expect(input).toHaveValue(`${seeded}${FAKE_SPEECH_TEXT}`);
	await expect(composer.getByTestId("review-composer-send")).toBeEnabled();
});

test("a field removed mid-dictation ends it even without a blur, and a field that widens gets the mic", async ({
	page,
}) => {
	await openChat(page);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
	await page.evaluate(() => {
		const host = document.createElement("div");
		host.id = "vanish-host";
		host.setAttribute("style", "position:fixed;top:120px;left:120px;z-index:40;padding:8px");
		host.innerHTML =
			'<input id="ext-narrow" type="text" style="width:80px"><input id="ext-vanish" type="text" style="width:240px">';
		document.body.append(host);
	});
	const narrow = page.locator("#ext-narrow");
	await narrow.focus();
	await expect(mic(page)).toBeHidden();
	await narrow.evaluate((field) => {
		field.style.width = "240px";
	});
	await expect(mic(page)).toBeVisible();

	await page.locator("#ext-vanish").focus();
	await mic(page).click();
	await expect(mic(page)).toHaveAttribute("data-mic-state", "listening");
	await page.evaluate(() => {
		// WebKit and Firefox fire no blur or focusout when a focused element is removed.
		const swallow = (event: Event) => event.stopImmediatePropagation();
		window.addEventListener("blur", swallow, true);
		window.addEventListener("focusout", swallow, true);
		document.getElementById("ext-vanish")?.remove();
		setTimeout(() => {
			window.removeEventListener("blur", swallow, true);
			window.removeEventListener("focusout", swallow, true);
		}, 500);
	});
	await expect(mic(page)).toBeHidden();
	await page.waitForTimeout(600);
	await page.getByTestId("chat-input").focus();
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
	await page.evaluate(() => document.getElementById("vanish-host")?.remove());
});

test("any field a page adds gets voice, with no code in it; passwords never do", async ({
	page,
}) => {
	await openChat(page);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
	await page.evaluate(() => {
		const host = document.createElement("div");
		host.id = "extension-host";
		host.setAttribute("style", "position:fixed;top:120px;left:120px;z-index:40;padding:8px");
		host.innerHTML =
			'<input id="ext-input" type="text" style="width:240px"><div id="ext-rich" contenteditable="true" style="width:240px;min-height:40px">Note:</div><input id="ext-secret" type="password" style="width:240px">';
		document.body.append(host);
	});
	const input = page.locator("#ext-input");
	await input.focus();
	await mic(page).click();
	await expect(mic(page)).toHaveAttribute("data-mic-state", "listening");
	await expect(input).toHaveValue(FAKE_SPEECH_TEXT, { timeout: 15_000 });
	await mic(page).click();
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
	const rich = page.locator("#ext-rich");
	await rich.click();
	await page.keyboard.press("End");
	await page.keyboard.press("ControlOrMeta+Shift+Space");
	await expect(rich).toHaveText(`Note: ${FAKE_SPEECH_TEXT}`, { timeout: 15_000 });
	await page.keyboard.press("ControlOrMeta+Shift+Space");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
	await page.locator("#ext-secret").focus();
	await expect(mic(page)).toBeHidden();
	await page.evaluate(() => document.getElementById("extension-host")?.remove());
});

test("the chord never reaches the composer behind an open dialog", async ({ page }) => {
	await openChat(page);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await page.keyboard.press("ControlOrMeta+Shift+Space");
	await page.waitForTimeout(300);
	await expect(mic(page)).toBeHidden();
	await expect(page.getByTestId("chat-input")).not.toHaveAttribute("readonly", "");
	await page.keyboard.press("Escape");
});

async function setVoiceInput(
	baseURL: string | undefined,
	voiceInputEnabled: boolean,
): Promise<void> {
	const wire = await hostWire(baseURL);
	try {
		await wire.request("settings.update", { config: { voiceInputEnabled } });
	} finally {
		wire.close();
	}
}

test("turning voice input off stops a dictation, hides every mic and frees the chord", async ({
	page,
	baseURL,
}) => {
	await openChat(page);
	const input = page.getByTestId("chat-input");
	await input.fill("");
	await page.keyboard.press("ControlOrMeta+Shift+Space");
	await expect(mic(page)).toHaveAttribute("data-mic-state", "listening");
	try {
		await setVoiceInput(baseURL, false);
		await expect(mic(page)).toHaveCount(0);
		await expect(input).not.toHaveAttribute("readonly", "");
		await input.focus();
		await page.keyboard.press("ControlOrMeta+Shift+Space");
		await page.waitForTimeout(300);
		await expect(mic(page)).toHaveCount(0);
		await expect(input).not.toHaveAttribute("readonly", "");
	} finally {
		await setVoiceInput(baseURL, true);
	}
	await input.blur();
	await input.focus();
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
});

test("Settings turns voice input off and back on, and Delete frees its files and brings the offer back", async ({
	page,
}) => {
	await openChat(page);
	await expect(mic(page)).toHaveAttribute("data-mic-state", "ready");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-voice").click();
	const voice = page.getByTestId("settings-voice");
	await expect(voice.getByTestId("settings-voice-status")).toContainText("Ready");
	await expect(voice).not.toContainText("nemo-speech");
	await expect(voice.getByTestId("settings-voice-language-all")).toHaveAttribute(
		"data-active",
		"true",
	);

	const toggle = voice.getByTestId("settings-voice-toggle");
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(voice.getByTestId("settings-voice-status")).toHaveCount(0);
	await expect(voice.getByTestId("settings-voice-files")).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByTestId("chat-input").focus();
	await expect(mic(page)).toHaveCount(0);

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-voice").click();
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");
	await voice.getByTestId("settings-voice-delete").click();
	await expect(voice.getByTestId("settings-voice-install")).toBeVisible();
	await expect(voice.getByTestId("settings-voice-status")).toContainText("Not set up");
	await expect(voice.getByTestId("settings-voice-files")).toHaveCount(0);
	expect(existsSync(SPEECH_DIR)).toBe(false);
	await page.keyboard.press("Escape");
	await page.getByTestId("chat-input").focus();
	await expect(mic(page)).toHaveAttribute("data-mic-state", "offer");
});
