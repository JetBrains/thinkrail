import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { CHAT_RESOURCES_PROTOCOL_VERSION } from "@thinkrail/contracts";
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

async function observeResourceWire(page: Page, protocolVersion?: number) {
	let reads = 0;
	let disconnect = () => {};
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		disconnect = () => browser.close({ code: 1012, reason: "Reconnect probe" });
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as { method?: string };
			if (frame.method === "session.resources") reads++;
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as {
				channel?: string;
				data?: Record<string, unknown>;
			};
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
		disconnect: () => disconnect(),
	};
}

test("empty Resources popover preserves keyboard focus and stays usable at phone width", async ({
	page,
}) => {
	await openResourceChat(page);
	const trigger = page.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttribute("data-active-count", "0");
	await expect(trigger).toHaveAccessibleName(/Resources/i);
	await shot(page.getByTestId("chat-toolbar"), "chat-resources", "after-header");
	await trigger.focus();
	await page.keyboard.press("Enter");
	const popover = page.getByTestId("resources-popover");
	await expect(popover).toBeVisible();
	await expect(popover.getByTestId("resources-commands")).toBeVisible();
	await expect(popover.getByTestId("resources-subagents")).toBeVisible();
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
	const wire = await observeResourceWire(page, CHAT_RESOURCES_PROTOCOL_VERSION - 1);
	await openResourceChat(page);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("resources-trigger")).toHaveCount(0);
	expect(wire.reads).toBe(0);
});
