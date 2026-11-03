import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { DICTATION_WAV, REAL_SPEECH_E2E_ENV } from "./fixtures/speech";
import { E2eWire } from "./fixtures/wire";

test.skip(
	process.env[REAL_SPEECH_E2E_ENV] !== "1",
	`downloads NVIDIA's real runtime and Nemotron model (~750 MB); set ${REAL_SPEECH_E2E_ENV}=1`,
);
test.use({
	launchOptions: {
		args: [
			"--use-fake-ui-for-media-stream",
			"--use-fake-device-for-media-stream",
			`--use-file-for-fake-audio-capture=${DICTATION_WAV}`,
		],
	},
});

test("the real engine installs from NVIDIA's pinned sources and transcribes a recording", async ({
	page,
	baseURL,
}) => {
	test.setTimeout(20 * 60_000);
	if (!baseURL) throw new Error("the real-engine run needs the isolated host URL");
	const wire = await E2eWire.connect(Number(new URL(baseURL).port));
	try {
		await wire.request("speech.remove", {});
	} finally {
		wire.close();
	}
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").focus();
	const mic = page.getByTestId("speech-mic");
	const input = page.getByTestId("chat-input");
	await expect(mic).toHaveAttribute("data-mic-state", "offer");
	await mic.click();
	await expect(page.getByTestId("speech-offer")).toContainText("MB");
	await page.getByTestId("speech-offer-download").click();
	await expect(mic).toHaveAttribute("data-mic-state", "ready", { timeout: 18 * 60_000 });
	await input.fill("");
	await mic.click();
	await expect(mic).toHaveAttribute("data-mic-state", "listening", { timeout: 120_000 });
	await expect(input).toHaveValue(/selector/i, { timeout: 120_000 });
	await mic.click();
	await expect(mic).toHaveAttribute("data-mic-state", "ready", { timeout: 30_000 });
	await expect(input).toHaveValue(/composer/i);
});
