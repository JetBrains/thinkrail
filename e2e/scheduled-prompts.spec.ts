import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { SCHEDULED_PROMPTS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { expandModelGroup, openWorkspaceChat } from "./fixtures/app";
import { connectCentral, openProviders, waitForCentralState } from "./fixtures/jbcentral";
import { E2eWire } from "./fixtures/wire";

const evidenceDir = join(tmpdir(), "thinkrail-scheduled-prompt-review");
test.use({ timezoneId: "Europe/Stockholm" });

test("older hosts keep scheduling controls unavailable", async ({ page }) => {
	let scheduleRequests = 0;
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(String(message)) as { method?: string };
			if (frame.method?.startsWith("scheduledPrompts.")) scheduleRequests++;
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(String(message)) as {
				channel?: string;
				data?: { protocolVersion?: number };
			};
			if (frame.channel === "server.welcome" && frame.data) {
				frame.data.protocolVersion = SCHEDULED_PROMPTS_PROTOCOL_VERSION - 1;
			}
			browser.send(JSON.stringify(frame));
		});
	});

	await openWorkspaceChat(page);
	await expect(page.getByTestId("schedule-open")).toHaveCount(0);
	expect(scheduleRequests).toBe(0);
});

async function openScheduledChat(page: Page) {
	const workspace = await openWorkspaceChat(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");
	await page.keyboard.press("Escape");
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const previousChatCount = await chatTabs.count();
	await page.getByTestId("new-chat").first().click();
	await expect(chatTabs).toHaveCount(previousChatCount + 1);
	await page.getByTestId("model-selector").last().click();
	await expandModelGroup(page, "e2e-central");
	await page
		.locator('[data-testid="model-option"][data-model-id="e2e-central-model"]')
		.first()
		.click();
	return workspace;
}

async function setAppTime(page: Page, time: string) {
	await page.clock.setFixedTime(new Date(time));
	await page.waitForTimeout(1_100);
}

test("scheduling finalizes template slots and preserves a draft edited during the save", async ({
	page,
}) => {
	mkdirSync(evidenceDir, { recursive: true });
	let releaseCreate!: () => void;
	const createGate = new Promise<void>((resolve) => (releaseCreate = resolve));
	let resolveCreateSeen!: () => void;
	const createSeen = new Promise<void>((resolve) => (resolveCreateSeen = resolve));
	let createParams: { id?: string; requestId?: string; text?: string } | undefined;
	let firstRequestId = "";
	let droppedResponse = false;
	const createIds: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(String(message)) as {
				id?: string;
				method?: string;
				params?: { id?: string; requestId?: string; text?: string };
			};
			if (frame.method === "scheduledPrompts.create") {
				createParams = frame.params;
				createIds.push(frame.params?.id ?? "");
				if (createIds.length === 1) {
					firstRequestId = frame.id ?? "";
					resolveCreateSeen();
					void createGate.then(() => server.send(message));
				} else server.send(message);
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(String(message)) as { id?: string };
			if (frame.id === firstRequestId && !droppedResponse) {
				droppedResponse = true;
				browser.send(JSON.stringify({ id: frame.id, ok: false, error: "simulated response loss" }));
				return;
			}
			browser.send(message);
		});
	});

	try {
		const workspace = await openScheduledChat(page);
		const bottomPanel = page.getByTestId("bottom-panel");
		await bottomPanel.getByRole("button", { name: "Bottom panel alignment" }).click();
		await page.getByRole("menuitem", { name: "Hide bottom panel" }).click();
		await expect(bottomPanel).toHaveCount(0);

		const input = page.getByTestId("chat-input");
		await input.fill("/review");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);

		await page.getByTestId("schedule-open").click();
		await expect(page.getByTestId("schedule-confirm")).toBeEnabled();
		await page.screenshot({
			path: join(evidenceDir, "schedule-before-save.png"),
			fullPage: true,
		});
		await page.getByTestId("schedule-confirm").click();
		await createSeen;
		expect(createParams?.text).toBe("Review for issues, focusing on src/.");

		await input.fill("a newer draft typed while the schedule request is pending");
		releaseCreate();
		await expect(page.getByRole("alert")).toContainText("simulated response loss");
		await page.getByTestId("schedule-confirm").click();
		await expect.poll(() => createIds.length).toBe(2);
		expect(createIds[1]).toBe(createIds[0]);
		expect(createParams?.requestId).toBe(createIds[0]);
		await expect(input).toHaveValue("a newer draft typed while the schedule request is pending");
		await expect(
			page.getByText("Review for issues, focusing on src/.", { exact: true }),
		).toBeVisible();
		await page.screenshot({
			path: join(evidenceDir, "schedule-after-save.png"),
			fullPage: true,
		});

		await page.clock.install();
		await setAppTime(page, "2026-10-25T00:45:00Z");
		await page.getByTestId("schedule-open").click();
		await page.getByLabel("Date").fill("2026-10-25");
		await page.getByLabel("Time").fill("02:30");
		await expect(page.getByTestId("schedule-confirm")).toBeEnabled();
		await expect(page.getByLabel("Hours")).toHaveValue("0");
		await expect(page.getByLabel("Minutes")).toHaveValue("45");
		await page.getByLabel("Minutes").fill("46");
		await expect(page.getByLabel("Time")).toHaveValue("02:31");
		await page.getByRole("button", { name: "Cancel" }).click();

		await setAppTime(page, "2026-03-29T00:00:00Z");
		await page.getByTestId("schedule-open").click();
		await page.getByLabel("Date").fill("2026-03-29");
		await page.getByLabel("Time").fill("02:30");
		await expect(page.getByTestId("schedule-confirm")).toBeDisabled();
		await page.getByRole("button", { name: "Cancel" }).click();

		await setAppTime(page, "2026-12-31T22:59:30Z");
		await page.getByTestId("schedule-open").click();
		await page.getByLabel("Date").fill("2026-12-31");
		await page.getByLabel("Time").fill("23:00");
		await expect(page.getByTestId("schedule-confirm")).toBeDisabled();
		await page.getByLabel("Date").fill("2027-01-01");
		await page.getByLabel("Time").fill("00:00");
		await expect(page.getByLabel("Date")).toHaveValue("2027-01-01");
		await expect(page.getByLabel("Hours")).toHaveValue("0");
		await expect(page.getByLabel("Minutes")).toHaveValue("1");
		await expect(page.getByTestId("schedule-confirm")).toBeEnabled();
		await page.getByLabel("Minutes").fill("2");
		await expect(page.getByLabel("Time")).toHaveValue("00:02");
		await page.getByRole("button", { name: "Cancel" }).click();

		const sessionId = await page
			.locator('[data-testid="editor-tab"][data-kind="chat"][data-active="true"]')
			.getAttribute("data-session-id");
		if (!sessionId) throw new Error("Scheduled prompt test chat is missing its session id");
		const wire = await E2eWire.connect(Number(new URL(page.url()).port));
		try {
			const records = await wire.request("scheduledPrompts.list", { workspaceId: workspace.id });
			expect(records).toHaveLength(1);
			expect(records[0]).toMatchObject({
				workspaceId: workspace.id,
				sessionId,
				text: "Review for issues, focusing on src/.",
			});
		} finally {
			wire.close();
		}
	} finally {
		releaseCreate();
	}
});

test("schedule waits until an image attachment finishes decoding", async ({ page }) => {
	await openWorkspaceChat(page);
	const input = page.getByTestId("chat-input");
	await page.evaluate(() => {
		Object.defineProperty(window, "createImageBitmap", {
			configurable: true,
			value: () =>
				new Promise((resolve) => {
					window.addEventListener(
						"e2e-release-image-decode",
						() => resolve({ width: 1, height: 1, close: () => {} }),
						{ once: true },
					);
				}),
		});
	});
	await input.evaluate((element) => {
		const transfer = new DataTransfer();
		transfer.items.add(new File(["fixture"], "fixture.png", { type: "image/png" }));
		element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
	});

	await expect(page.getByTestId("composer-image-pending")).toBeVisible();
	await expect(page.getByTestId("schedule-open")).toBeDisabled();
	await page.evaluate(() => window.dispatchEvent(new Event("e2e-release-image-decode")));
	await expect(page.getByTestId("composer-image-pending")).toHaveCount(0);
	await expect(page.getByTestId("composer-image")).toBeVisible();
	await expect(page.getByTestId("schedule-open")).toBeEnabled();
});
