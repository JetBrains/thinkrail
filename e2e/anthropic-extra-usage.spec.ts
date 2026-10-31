import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	openAppFresh,
	openFixtureProject,
	openPersistedChat,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO, E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const SETTINGS = join(E2E_PI_AGENT_DIR, "settings.json");
const ANTHROPIC_SIGNIN = '[data-testid="provider-signin"][data-provider="anthropic"]';

let savedSettings: string | null = null;

test.beforeAll(() => {
	savedSettings = existsSync(SETTINGS) ? readFileSync(SETTINGS, "utf8") : null;
});

test.afterAll(() => {
	if (savedSettings === null) rmSync(SETTINGS, { force: true });
	else writeFileSync(SETTINGS, savedSettings);
});

async function openAnthropicSignIn(page: Page) {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();
	await page.locator(ANTHROPIC_SIGNIN).click();
	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toHaveAttribute("data-provider", "anthropic");
	await expect(page.getByTestId("login-option").first()).toBeVisible();
	return dialog;
}

interface NoticeWire {
	notice(sessionId: string): void;
	disableRequests: () => number;
}

async function routeNoticeWire(page: Page): Promise<NoticeWire> {
	let send: ((frame: string) => void) | null = null;
	let disables = 0;
	await page.routeWebSocket(/\/ws(\?|$)/, (route) => {
		send = (frame) => route.send(frame);
		const server = route.connectToServer();
		route.onMessage((message) => {
			if (message.toString().includes('"provider.disableWarning"')) disables += 1;
			server.send(message);
		});
		server.onMessage((message) => route.send(message));
	});
	return {
		notice(sessionId) {
			if (!send) throw new Error("the app has not connected yet");
			send(
				JSON.stringify({
					channel: "pi.extensionUi",
					data: { id: "e2e-notice", sessionId, kind: "notice", notice: "anthropicExtraUsage" },
				}),
			);
		},
		disableRequests: () => disables,
	};
}

test.describe.configure({ mode: "serial" });

test("an Anthropic subscription sign-in warns about extra usage before the user authorises", async ({
	page,
}) => {
	const dialog = await openAnthropicSignIn(page);
	const notice = dialog.getByTestId("extra-usage-notice");
	await expect(notice).toHaveAttribute("data-context", "signIn");
	await expect(notice).toContainText(
		"Current Claude Pro/Max setup is billed as extra usage per token.",
	);
	await expect(notice.getByRole("link", { name: "Manage extra usage" })).toHaveAttribute(
		"href",
		"https://claude.ai/settings/usage",
	);
	await expect(notice.getByRole("link")).toHaveCount(1);
	await shot(dialog, "anthropic-extra-usage", "signin-notice");
	await page.getByTestId("login-cancel").click();
	await expect(dialog).toHaveCount(0);
});

test("the chat banner dismisses per chat, and Don't warn again turns pi's warning off everywhere", async ({
	page,
}) => {
	const wire = await routeNoticeWire(page);
	await openFixtureProject(page);
	const name = "Extra usage notice";
	const { id } = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [{ role: "user", text: "Refactor the login handler.", timestamp: 1_700_960_000_000 }],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, name);
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="chat"][data-active="true"]'),
	).toHaveAttribute("data-session-id", id);

	wire.notice(id);
	const banner = page.getByTestId("extra-usage-notice");
	await expect(banner).toHaveAttribute("data-context", "chat");
	await expect(banner).toContainText(
		"Anthropic bills this chat as extra usage per token ignoring your normal plan limits, because in the current setup Pi is connected directly via API.",
	);
	await shot(page.getByTestId("chat-view"), "anthropic-extra-usage", "chat-banner");

	await banner.getByTestId("extra-usage-dismiss").click();
	await expect(banner).toHaveCount(0);
	expect(wire.disableRequests()).toBe(0);

	wire.notice(id);
	await expect(banner).toBeVisible();
	await banner.getByTestId("extra-usage-disable").click();
	await expect(banner).toHaveCount(0);
	expect(wire.disableRequests()).toBe(1);
	await expect
		.poll(() => JSON.parse(readFileSync(SETTINGS, "utf8")).warnings)
		.toEqual({ anthropicExtraUsage: false });

	const dialog = await openAnthropicSignIn(page);
	await expect(dialog.getByTestId("extra-usage-notice")).toHaveCount(0);
	await page.getByTestId("login-cancel").click();
});
