import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";
import { E2eWire } from "./fixtures/wire";

test.use({
	launchOptions: { args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] },
});

let wire: E2eWire;

test.beforeEach(async () => {
	wire = await E2eWire.connect();
	await wire.request("remote.setEnabled", { enabled: true });
});

test.afterEach(async () => {
	await wire.request("remote.setEnabled", { enabled: false });
	wire.close();
});

test("a server added by its pairing link sits under the projects with its own, survives a reload, and is forgotten", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	const { link } = await wire.request("remote.issueLink", {});

	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-add-server").click();
	const dialog = page.getByTestId("add-server-dialog");
	await dialog.getByTestId("add-server-link").fill("not a link");
	await dialog.getByTestId("add-server-submit").click();
	await expect(dialog.getByTestId("add-server-error")).toContainText(
		"isn't a ThinkRail pairing link",
	);

	await dialog.getByTestId("add-server-link").fill(link);
	await dialog.getByTestId("add-server-submit").click();
	await expect(dialog).toBeHidden({ timeout: 30_000 });

	const server = page.getByTestId("server-group");
	await expect(server).toHaveAttribute("data-status", "connected", { timeout: 30_000 });
	await expect(server.getByTestId("server-status")).toHaveAccessibleName("Connected");
	await expect(server.getByTestId("server-project")).toContainText(["sample-project"]);
	const paired = (await wire.request("remote.status", {})).devices.length;

	await server.getByTestId("server-toggle").click();
	await expect(server.getByTestId("server-project")).toHaveCount(0);
	await server.getByTestId("server-toggle").click();

	await page.reload();
	await expect(page.getByTestId("server-group")).toHaveAttribute("data-status", "connected", {
		timeout: 30_000,
	});
	await expect(page.getByTestId("server-project")).toContainText(["sample-project"]);
	expect((await wire.request("remote.status", {})).devices).toHaveLength(paired);

	await page.getByTestId("server-actions").click();
	await page.getByTestId("server-menu-forget").click();
	await page.getByTestId("confirm-forget-server").click();
	await expect(page.getByTestId("server-list")).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId("project-tree")).toBeVisible();
	await expect(page.getByTestId("server-list")).toHaveCount(0);
});
