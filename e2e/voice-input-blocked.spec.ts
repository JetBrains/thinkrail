import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { REAL_SPEECH_E2E_ENV } from "./fixtures/speech";
import { E2eWire } from "./fixtures/wire";

test.skip(process.platform === "win32", "the fake speech runtime is a POSIX shell wrapper");
test.skip(
	process.env[REAL_SPEECH_E2E_ENV] === "1",
	"the real-engine run keeps the fixture manifest off the host",
);
test.use({
	launchOptions: {
		args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
	},
});

test("a blocked microphone says how to allow it and retries on the next click", async ({
	page,
	baseURL,
}) => {
	if (!baseURL) throw new Error("voice input fixtures need the isolated host URL");
	const wire = await E2eWire.connect(Number(new URL(baseURL).port));
	try {
		await wire.request("speech.install", { model: "multilingual" });
	} finally {
		wire.close();
	}
	await page.addInitScript(() => {
		const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		Object.assign(window, { __micBlocked: true });
		navigator.mediaDevices.getUserMedia = (constraints) =>
			Reflect.get(window, "__micBlocked") === true
				? Promise.reject(new DOMException("Permission denied", "NotAllowedError"))
				: original(constraints);
	});
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").focus();
	const mic = page.getByTestId("speech-mic");
	await expect(mic).toHaveAttribute("data-mic-state", "ready", { timeout: 20_000 });
	await mic.click();
	await expect(mic).toHaveAttribute("data-mic-state", "blocked");
	await expect(mic).toBeEnabled();
	await expect(mic).toHaveAccessibleName(/Privacy & Security/);
	await page.evaluate(() => Object.assign(window, { __micBlocked: false }));
	await mic.click();
	await expect(mic).toHaveAttribute("data-mic-state", "listening");
	await mic.click();
	await expect(mic).toHaveAttribute("data-mic-state", "ready", { timeout: 15_000 });
});
