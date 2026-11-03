import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openFixtureProject, openWorkspaceChat } from "./fixtures/app";

interface ClientFrame {
	id?: string;
	method?: string;
	params?: { tag?: string };
}

async function acceptPromptsWithoutAgent(page: Page): Promise<string[]> {
	const toastTags: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const frame = JSON.parse(String(message)) as ClientFrame;
			if (frame.method === "client.githubStarToast" && frame.params?.tag) {
				toastTags.push(frame.params.tag);
			}
			if (frame.id && frame.method === "session.prompt") {
				ws.send(JSON.stringify({ id: frame.id, ok: true, result: { ok: true } }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
	return toastTags;
}

async function raiseAskOnNextPrompt(page: Page) {
	await page.route("https://api.github.com/**", (route) => route.abort());
	await openWorkspaceChat(page);
	await page.evaluate(() => localStorage.setItem("thinkrail-github-star-prompt-count", "9"));
	await sendPrompt(page, "prompt 10");
	const ask = page
		.getByTestId("toast")
		.filter({ hasText: "Find ThinkRail useful or have feedback?" });
	await expect(ask).toBeVisible();
	return ask;
}

async function sendPrompt(page: Page, text: string): Promise<void> {
	const input = page.getByTestId("chat-input");
	await input.fill(text);
	await input.press("Enter");
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]').last()).toContainText(
		text,
	);
}

test("the tenth prompt asks for a GitHub star once and the action opens the repo", async ({
	page,
	context,
}) => {
	const toastTags = await acceptPromptsWithoutAgent(page);
	await context.route("https://github.com/**", (route) =>
		route.fulfill({ status: 200, contentType: "text/html", body: "" }),
	);
	await context.route("https://api.github.com/**", (route) =>
		route.fulfill({
			json: { stargazers_count: 1234 },
			headers: { "access-control-allow-origin": "*" },
		}),
	);
	await openWorkspaceChat(page);

	const ask = page
		.getByTestId("toast")
		.filter({ hasText: "Find ThinkRail useful or have feedback?" });
	for (let n = 1; n < 10; n += 1) {
		await sendPrompt(page, `prompt ${n}`);
		await expect(ask).toHaveCount(0);
	}

	await sendPrompt(page, "prompt 10");
	await expect(ask).toBeVisible();
	await expect(ask.getByTestId("toast-action")).toHaveText("View on GitHub | ☆ 1.2k");

	const [popup] = await Promise.all([
		context.waitForEvent("page"),
		ask.getByTestId("toast-action").click(),
	]);
	expect(popup.url()).toBe("https://github.com/JetBrains/thinkrail");
	await popup.close();
	await expect(ask).toHaveCount(0);

	await sendPrompt(page, "prompt 11");
	await expect(ask).toHaveCount(0);
	expect(toastTags).toEqual(["shown", "github_click"]);
});

test("closing the ask reports dismissed", async ({ page }) => {
	const toastTags = await acceptPromptsWithoutAgent(page);
	const ask = await raiseAskOnNextPrompt(page);
	await ask.getByRole("button", { name: /close|dismiss/i }).click();
	await expect(ask).toHaveCount(0);
	await expect.poll(() => toastTags).toEqual(["shown", "dismissed"]);
});

test("the ask stays for 60 seconds, then reports ignored", async ({ page }) => {
	await page.clock.install();
	const toastTags = await acceptPromptsWithoutAgent(page);
	const ask = await raiseAskOnNextPrompt(page);
	await page.mouse.move(0, 0);
	await page.clock.fastForward(55_000);
	await expect(ask).toBeVisible();
	expect(toastTags).toEqual(["shown"]);
	await page.clock.fastForward(6_000);
	await expect(ask).toHaveCount(0);
	await expect.poll(() => toastTags).toEqual(["shown", "ignored"]);
});

test("a New Workspace first prompt counts, and the button works without a star count", async ({
	page,
}) => {
	await acceptPromptsWithoutAgent(page);
	await page.route("https://api.github.com/**", (route) => route.abort());
	await openFixtureProject(page);
	await page.evaluate(() => localStorage.setItem("thinkrail-github-star-prompt-count", "9"));

	const dialog = page.getByTestId("new-workspace-dialog");
	await page.getByTestId("add-workspace").first().click();
	await expect(dialog).toBeVisible();
	await page.getByTestId("ws-prompt").fill("first prompt");
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();

	const ask = page
		.getByTestId("toast")
		.filter({ hasText: "Find ThinkRail useful or have feedback?" });
	await expect(ask.getByTestId("toast-action")).toHaveText("View on GitHub");
});
