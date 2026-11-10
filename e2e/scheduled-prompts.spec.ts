import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { SCHEDULED_PROMPTS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { expandModelGroup, hideAuxiliaryWorkbench, openWorkspaceChat } from "./fixtures/app";
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

test("editing a queued model-pinned prompt keeps its model when reasoning changes", async ({
	page,
}) => {
	let sendToPage: ((frame: unknown) => void) | undefined;
	let pinnedSelection:
		| { model: { provider: string; id: string }; thinkingLevel: string }
		| undefined;
	let pinnedModelName = "";
	let changedLevel = "";
	let submitted: { method: string; params: Record<string, unknown> } | undefined;
	const sessionLevelRequests: string[] = [];
	const sessionModelRequests: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		sendToPage = (frame) => browser.send(JSON.stringify(frame));
		browser.onMessage((message) => {
			const frame = JSON.parse(String(message)) as {
				id?: string;
				method?: string;
				params?: Record<string, unknown>;
			};
			if (!frame.id) {
				server.send(message);
				return;
			}
			if (frame.method === "session.removeQueued") {
				browser.send(
					JSON.stringify({
						id: frame.id,
						ok: true,
						result: {
							removed: {
								text: "pinned queued prompt",
								modelSelection: pinnedSelection,
							},
							queue: { steering: [], followUp: [] },
						},
					}),
				);
				return;
			}
			if (frame.method === "session.setThinkingLevel") sessionLevelRequests.push(frame.method);
			if (frame.method === "session.setModel") sessionModelRequests.push(frame.method);
			if (["session.followUp", "session.steer"].includes(frame.method ?? "")) {
				submitted = { method: frame.method ?? "", params: frame.params ?? {} };
				browser.send(JSON.stringify({ id: frame.id, ok: true, result: { ok: true } }));
				return;
			}
			if (frame.method === "session.setThinkingLevel" || frame.method === "session.setModel") {
				browser.send(JSON.stringify({ id: frame.id, ok: true, result: { ok: true } }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => browser.send(message));
	});

	const workspace = await openScheduledChat(page);
	await page.keyboard.press("Escape");
	await hideAuxiliaryWorkbench(page);
	const sessionId = await page
		.locator('[data-testid="editor-tab"][data-kind="chat"][data-active="true"]')
		.getAttribute("data-session-id");
	if (!sessionId) throw new Error("Pinned queue test chat is missing its session id");
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		const [models, sessions] = await Promise.all([
			wire.request("model.list", {}),
			wire.request("session.list", { workspaceId: workspace.id }),
		]);
		const session = sessions.find((candidate) => candidate.sessionId === sessionId);
		const pinnedModel =
			models.find(
				(model) =>
					model.thinkingLevels.length > 1 &&
					!(model.provider === session?.model?.provider && model.id === session.model.id),
			) ?? models.find((model) => model.thinkingLevels.length > 1);
		if (!pinnedModel) throw new Error("Pinned queue test needs a model with reasoning choices");
		const initialLevel = pinnedModel.thinkingLevels.at(-1);
		const nextLevel = pinnedModel.thinkingLevels.find((level) => level !== initialLevel);
		if (!initialLevel || !nextLevel)
			throw new Error("Pinned queue model has no alternate reasoning level");
		pinnedSelection = {
			model: { provider: pinnedModel.provider, id: pinnedModel.id },
			thinkingLevel: initialLevel,
		};
		pinnedModelName = pinnedModel.name;
		changedLevel = nextLevel;
	} finally {
		wire.close();
	}
	sessionLevelRequests.length = 0;
	sessionModelRequests.length = 0;
	if (!sendToPage) throw new Error("Pinned queue test WebSocket is not connected");
	sendToPage({ channel: "pi.event", data: { sessionId, event: { type: "agent_start" } } });
	sendToPage({
		channel: "pi.event",
		data: {
			sessionId,
			event: { type: "queue_update", steering: [], followUp: ["pinned queued prompt"] },
		},
	});
	await expect(page.getByTestId("queue-item")).toContainText("pinned queued prompt");
	await page.getByTestId("queue-item-edit").click();
	await expect(page.getByTestId("chat-input")).toHaveValue("pinned queued prompt");
	await page.getByTestId("thinking-selector").last().click();
	await page.locator(`[data-testid="thinking-option"][data-level="${changedLevel}"]`).click();
	await expect(page.getByTestId("thinking-selector").last()).toContainText(changedLevel);
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const activeChatTab = chatTabs.last();
	await chatTabs.first().click();
	await expect(chatTabs.first()).toHaveAttribute("data-active", "true");
	await activeChatTab.click();
	await expect(activeChatTab).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("chat-input")).toHaveValue("pinned queued prompt");
	await expect(page.getByTestId("model-selector").last()).toContainText(pinnedModelName);
	await expect(page.getByTestId("thinking-selector").last()).toContainText(changedLevel);
	await page.keyboard.press("Escape");
	mkdirSync(evidenceDir, { recursive: true });
	await page.screenshot({ path: join(evidenceDir, "queue-model-edit.png"), fullPage: true });
	await page.getByTestId("chat-send").click();
	await expect.poll(() => submitted).toBeDefined();
	expect(sessionLevelRequests).toEqual([]);
	expect(sessionModelRequests).toEqual([]);
	expect(submitted).toEqual({
		method: "session.followUp",
		params: {
			sessionId,
			text: "pinned queued prompt",
			modelSelection: { ...pinnedSelection, thinkingLevel: changedLevel },
		},
	});
});

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
			await wire.request("scheduledPrompts.create", {
				requestId: "image-only-row",
				id: "image-only-row",
				workspaceId: workspace.id,
				sessionId,
				text: "",
				images: [{ type: "image", data: "AA==", mimeType: "image/png" }],
				dueAt: Date.UTC(2027, 0, 1, 12),
				createdAt: Date.now(),
				status: "scheduled",
			});
			await expect(page.getByText("Image attachment", { exact: true })).toBeVisible();
			await page.screenshot({
				path: join(evidenceDir, "schedule-image-only-row.png"),
				fullPage: true,
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
