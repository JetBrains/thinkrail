import { expect, test } from "@playwright/test";
import { E2E_LAUNCH_TOKEN_STORAGE_KEY, withE2eLaunchToken } from "./fixtures/launchAuth";
import { E2E_LAUNCH_TOKEN } from "./fixtures/paths";

const NO_TOKEN = { storageState: { cookies: [], origins: [] } };

test("the host refuses a foreign Origin and a missing token", async ({ request, baseURL }) => {
	const auth = `${baseURL}/auth`;
	expect((await request.get(auth)).status()).toBe(401);
	expect((await request.get(`${auth}?token=wrong`)).status()).toBe(401);
	expect((await request.get(withE2eLaunchToken(auth))).status()).toBe(204);
	expect(
		(
			await request.get(withE2eLaunchToken(auth), {
				headers: { Origin: "https://evil.example" },
			})
		).status(),
	).toBe(403);
	expect(
		(
			await request.get(withE2eLaunchToken(`${baseURL}/ws`), {
				headers: { Origin: "https://evil.example" },
			})
		).status(),
	).toBe(403);
	expect((await request.get(`${baseURL}/ws`)).status()).toBe(401);
	expect((await request.get(`${baseURL}/files/missing/readme.md`)).status()).toBe(401);
	expect((await request.get(`${baseURL}/health`)).status()).toBe(200);
});

test("a page without the launch token asks for it and connects once pasted", async ({
	browser,
}) => {
	const context = await browser.newContext(NO_TOKEN);
	try {
		const page = await context.newPage();
		await page.goto("/");
		await expect(page.getByTestId("launch-token-screen")).toBeVisible();
		await expect(page.getByTestId("launch-token-screen")).toContainText("Re-open ThinkRail");

		await page.getByTestId("launch-token-input").fill("wrong-token");
		await page.getByTestId("launch-token-submit").click();
		await expect(page.getByTestId("launch-token-rejected")).toBeVisible();

		await page.getByTestId("launch-token-input").fill(E2E_LAUNCH_TOKEN);
		await page.getByTestId("launch-token-submit").click();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	} finally {
		await context.close();
	}
});

test("the opened URL's token is stored and removed from the address bar", async ({
	browser,
	baseURL,
}) => {
	const context = await browser.newContext(NO_TOKEN);
	try {
		const page = await context.newPage();
		await page.goto(withE2eLaunchToken(`${baseURL}/`));
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		expect(new URL(page.url()).searchParams.has("token")).toBe(false);
		expect(
			await page.evaluate((key) => localStorage.getItem(key), E2E_LAUNCH_TOKEN_STORAGE_KEY),
		).toBe(E2E_LAUNCH_TOKEN);

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	} finally {
		await context.close();
	}
});
