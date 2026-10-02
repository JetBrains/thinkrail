import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
	CHAT_RESOURCES_PROTOCOL_VERSION,
	type SessionResources,
	type WsClientMessage,
	type WsParams,
	type WsResult,
} from "@thinkrail/contracts";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

async function openResourceChat(page: Page) {
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Resource UI",
		messages: [{ role: "user", text: "Inspect this chat's resources.", timestamp: Date.now() }],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "Resource UI");
	await expect(page.getByTestId("chat-toolbar")).toBeVisible();
}

async function observeResourceWire(
	page: Page,
	options: { protocolVersion?: number; completedChildId?: string } = {},
) {
	let protocolVersion = options.protocolVersion;
	let reads = 0;
	let welcomes = 0;
	let resourceScope: WsParams<"session.resources"> | undefined;
	const transcriptRequests: WsParams<"subagent.getTranscript">[] = [];
	let disconnect = () => {};
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		disconnect = () => browser.close({ code: 1012, reason: "Reconnect probe" });
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as WsClientMessage;
			if ("method" in frame && frame.method === "session.resources") {
				reads++;
				resourceScope = frame.params as WsParams<"session.resources">;
				if (options.completedChildId) {
					const result: SessionResources = {
						...resourceScope,
						commands: [],
						subagents: [
							{
								childSessionId: options.completedChildId,
								parentSessionId: resourceScope.sessionId,
								task: "Focus fixture",
								status: "completed",
								createdAt: "2026-01-01T00:00:00.000Z",
							},
						],
					};
					browser.send(JSON.stringify({ id: frame.id, ok: true, result }));
					return;
				}
			}
			if (
				"method" in frame &&
				frame.method === "subagent.getTranscript" &&
				options.completedChildId
			) {
				transcriptRequests.push(frame.params as WsParams<"subagent.getTranscript">);
				const result: WsResult<"subagent.getTranscript"> = {
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: "FOCUS_CHILD" }],
							timestamp: 1_700_000_000_000,
						},
					],
					status: "completed",
				};
				browser.send(JSON.stringify({ id: frame.id, ok: true, result }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as {
				channel?: string;
				data?: Record<string, unknown>;
			};
			if (frame.channel === "server.welcome") welcomes++;
			if (protocolVersion !== undefined && frame.channel === "server.welcome") {
				browser.send(JSON.stringify({ ...frame, data: { ...frame.data, protocolVersion } }));
			} else {
				browser.send(message);
			}
		});
	});
	return {
		get reads() {
			return reads;
		},
		get welcomes() {
			return welcomes;
		},
		get resourceScope() {
			return resourceScope;
		},
		transcriptRequests,
		setProtocolVersion: (version: number) => {
			protocolVersion = version;
		},
		disconnect: () => disconnect(),
	};
}

test("empty Resources popover preserves keyboard focus and stays usable at phone width", async ({
	page,
}) => {
	await openResourceChat(page);
	const trigger = page.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttribute("data-active-count", "0");
	await expect(trigger).toHaveAccessibleName("Resources, 0 active");
	await shot(page.getByTestId("chat-toolbar"), "chat-resources", "after-header");
	await trigger.focus();
	await page.keyboard.press("Enter");
	const popover = page.getByTestId("resources-popover");
	await expect(popover).toBeVisible();
	await expect(popover.getByTestId("resources-commands")).toBeVisible();
	await expect(popover.getByTestId("resources-subagents")).toBeVisible();
	await expect(popover.getByText("No active commands.", { exact: true })).toBeVisible();
	await expect(popover.getByText("No active subagents.", { exact: true })).toBeVisible();
	const finished = popover.getByTestId("resources-finished-toggle");
	await expect(finished).toHaveText("Finished · 0");
	await expect(finished).toHaveAttribute("aria-expanded", "false");
	await expect(popover.getByTestId("resource-stop")).toHaveCount(0);
	await expect(popover.getByTestId("resources-stop-all")).toHaveCount(0);
	await shot(popover, "chat-resources", "empty-popover");
	await page.keyboard.press("Escape");
	await expect(popover).not.toBeVisible();
	await expect(trigger).toBeFocused();

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(trigger).toBeInViewport({ ratio: 1 });
	await trigger.click();
	await expect(popover).toBeInViewport({ ratio: 1 });
	await shot(page, "chat-resources", "mobile-popover");
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();
});

test("Resources rehydrates on welcome after a real socket reconnect and browser reload", async ({
	page,
}) => {
	const wire = await observeResourceWire(page);
	await openResourceChat(page);
	const trigger = page.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttribute("data-active-count", "0");
	await expect.poll(() => wire.reads).toBeGreaterThan(0);
	const initial = wire.reads;
	wire.disconnect();
	await expect.poll(() => wire.reads).toBeGreaterThan(initial);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(trigger).toHaveAttribute("data-active-count", "0");
	const reconnected = wire.reads;
	await page.reload();
	await expect.poll(() => wire.reads).toBeGreaterThan(reconnected);
	await expect(trigger).toHaveAttribute("data-active-count", "0");
});

test("an older host hides Resources without issuing unsupported resource reads", async ({
	page,
}) => {
	const wire = await observeResourceWire(page, {
		protocolVersion: CHAT_RESOURCES_PROTOCOL_VERSION - 1,
	});
	await openResourceChat(page);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("resources-trigger")).toHaveCount(0);
	expect(wire.reads).toBe(0);
});

test("an older welcome retires a Resources transcript and returns focus to the composer", async ({
	page,
}) => {
	const childSessionId = "resource-focus-child";
	const wire = await observeResourceWire(page, { completedChildId: childSessionId });
	await openResourceChat(page);
	const trigger = page.getByTestId("resources-trigger");
	await trigger.click();
	const popover = page.getByTestId("resources-popover");
	await popover.getByTestId("resources-finished-toggle").click();
	const transcriptLink = popover.getByTestId("resource-transcript");
	await transcriptLink.focus();
	await page.keyboard.press("Enter");
	await expect(popover).not.toBeVisible();
	const dialog = page.getByTestId("subagent-transcript-dialog");
	await expect(dialog).toContainText("FOCUS_CHILD");
	expect(wire.transcriptRequests).toEqual([
		{
			workspaceId: wire.resourceScope?.workspaceId,
			parentSessionId: wire.resourceScope?.sessionId,
			childSessionId,
		},
	]);
	const close = dialog.getByRole("button", { name: "Close", exact: true });
	await close.focus();
	await expect(close).toBeFocused();

	const initialWelcomes = wire.welcomes;
	wire.setProtocolVersion(CHAT_RESOURCES_PROTOCOL_VERSION - 1);
	wire.disconnect();
	await expect.poll(() => wire.welcomes).toBeGreaterThan(initialWelcomes);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(trigger).toHaveCount(0);
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("chat-input")).toBeFocused();
});
