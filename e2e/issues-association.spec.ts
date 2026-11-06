import { expect, test } from "@playwright/test";
import {
	ISSUES_AUTH_PROTOCOL_VERSION,
	type ServerWelcome,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import {
	defaultWorkspaceRow,
	openFixtureProject,
	resetApp,
	skipIssueAssociation,
} from "./fixtures/app";

test("skipping post-open GitLab association keeps the project and allows entering Default", async ({
	page,
}) => {
	await resetApp(page);
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item").first()).toBeVisible();
	const dialog = page.getByTestId("issues-associate-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('input[type="password"]')).toHaveCount(1);
	await skipIssueAssociation(page);
	await expect(page.getByTestId("project-item").first()).toBeVisible();
	await page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }).click();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("center-tabs")).toBeVisible();
});

test("a pre-auth host opens the fixture without expecting an association prompt", async ({
	page,
}) => {
	let unsupportedReads = 0;
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as { method?: string };
			if (frame.method === "issues.repositoryAddress") unsupportedReads++;
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as { channel?: string; data?: ServerWelcome };
			if (frame.channel === WS_CHANNELS.serverWelcome && frame.data)
				frame.data.protocolVersion = ISSUES_AUTH_PROTOCOL_VERSION - 1;
			browser.send(JSON.stringify(frame));
		});
	});
	await openFixtureProject(page, { issueAssociationSupported: false });
	await expect(page.getByTestId("issues-associate-dialog")).toHaveCount(0);
	expect(unsupportedReads).toBe(0);
	await page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }).click();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
});
