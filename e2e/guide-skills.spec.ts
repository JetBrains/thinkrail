import { expect, type Page, test } from "@playwright/test";
import { openAppFresh, openFixtureProject, pressPlatformShortcut } from "./fixtures/app";

interface ClientFrame {
	method?: string;
	params?: { text?: string };
}

async function observeClientFrames(page: Page, frames: ClientFrame[]): Promise<void> {
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		const server = socket.connectToServer();
		socket.onMessage((message) => {
			try {
				frames.push(JSON.parse(String(message)) as ClientFrame);
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => socket.send(message));
	});
}

function promptTexts(frames: readonly ClientFrame[]): string[] {
	return frames
		.filter((frame) => frame.method === "session.prompt" && typeof frame.params?.text === "string")
		.map((frame) => frame.params?.text ?? "");
}

test("no-project Welcome help links start projectless chats for setup and about skills", async ({
	page,
}) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openAppFresh(page);

	await expect(page.getByTestId("welcome-guide-links")).toBeVisible();
	await page.getByTestId("welcome-setup-thinkrail").click();

	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	await expect.poll(() => promptTexts(frames)).toContain("/skill:configuring-thinkrail");

	await openAppFresh(page);
	await expect(page.getByTestId("welcome-guide-links")).toBeVisible();
	await page.getByTestId("welcome-about-thinkrail").click();

	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	await expect.poll(() => promptTexts(frames)).toContain("/skill:about-thinkrail");
});

test("command palette runs ThinkRail setup and about skills from a project", async ({ page }) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openFixtureProject(page);

	await expect(page.getByTestId("welcome-guide-links")).toHaveCount(0);

	await pressPlatformShortcut(page, "k");
	await expect(page.getByTestId("search-palette")).toBeVisible();
	await page.getByTestId("search-input").fill("Set up ThinkRail with the agent");
	await page
		.getByTestId("search-palette")
		.locator('[data-item-id="command:help.setupThinkrail"]')
		.click();

	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	await expect.poll(() => promptTexts(frames)).toContain("/skill:configuring-thinkrail");

	await pressPlatformShortcut(page, "k");
	await expect(page.getByTestId("search-palette")).toBeVisible();
	await page.getByTestId("search-input").fill("Ask about ThinkRail");
	await page
		.getByTestId("search-palette")
		.locator('[data-item-id="command:help.aboutThinkrail"]')
		.click();

	await expect.poll(() => promptTexts(frames)).toContain("/skill:about-thinkrail");
});
