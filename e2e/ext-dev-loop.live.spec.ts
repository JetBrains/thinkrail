import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat, waitForAgentSettled } from "./fixtures/app";
import { E2E_EXTENSIONS_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const NAME = "hello-runs";
const SHOT_DIR = "/tmp/thinkrail-ext-shots";

const PROMPT = [
	`Build me a hello panel extension that counts settled runs. Name it "${NAME}" and put it in the user extensions directory.`,
	'It needs one surface with id "main" in the "panel" slot, titled "Hello runs".',
	'The panel shows the text "settled runs: N" in an element with data-testid="hello-count", where N counts agent_settled events across all sessions.',
	"Validate it and reload it with the extension tools until it is active.",
].join(" ");

const extensionInfo = async () => {
	const wire = await E2eWire.connect();
	try {
		const list = await wire.request("ext.list", {});
		return list.find((info) => info.name === NAME);
	} finally {
		wire.close();
	}
};

test.afterEach(() => rmSync(join(E2E_EXTENSIONS_DIR, NAME), { recursive: true, force: true }));

test("the agent builds a hello panel extension that counts settled runs", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(600_000);
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(PROMPT);
	await page.getByTestId("chat-send").click();
	await waitForAgentSettled(page, 540_000);

	await expect
		.poll(async () => (await extensionInfo())?.status, { timeout: 30_000 })
		.toBe("active");

	await page.getByTestId("ext-menu").first().click();
	await page.getByTestId(`ext-open-${NAME}-main`).click();
	const count = page.getByTestId("hello-count");
	await expect(count).toBeVisible();
	await expect(count).toHaveText(/settled runs: [1-9]\d*/);
	const before = Number((await count.textContent())?.match(/\d+/)?.[0]);

	await page.getByTestId("chat-input").fill("Reply with the single word: ok");
	await page.getByTestId("chat-send").click();
	await expect(count).toHaveText(`settled runs: ${before + 1}`, { timeout: 120_000 });

	mkdirSync(SHOT_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOT_DIR, "05-agent-built.png") });
});
