import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, waitForAgentSettled } from "./fixtures/app";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

test("manual compaction preserves context through continuation and reload", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(180_000);
	await openFixtureProject(page);
	const settingsPath = join(E2E_PI_AGENT_DIR, "settings.json");
	const original = readFileSync(settingsPath, "utf8");
	const settings = JSON.parse(original);
	writeFileSync(
		settingsPath,
		JSON.stringify({
			...settings,
			compaction: { ...settings.compaction, enabled: false, keepRecentTokens: 1 },
		}),
	);
	try {
		const workspace = await createWorkspaceViaDialog(page);
		const tab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
		const sessionId = await tab.getAttribute("data-session-id");
		if (!sessionId) throw new Error("Compaction test chat is missing its session id");
		const input = page.getByTestId("chat-input");
		await input.fill(
			"Remember the checkpoint word riverstone. Do not use tools. Reply only READY.",
		);
		await page.getByTestId("chat-send").click();
		await waitForAgentSettled(page);

		await input.fill("/compact Preserve the checkpoint word exactly. Keep the summary brief.");
		await page.getByTestId("chat-send").click();
		const marker = page.getByTestId("chat-compaction");
		await expect(marker).toBeVisible({ timeout: 90_000 });
		await marker.getByRole("button").click();
		await expect(marker).toContainText("riverstone");
		await input.fill("What was the checkpoint word? Reply with that word only, without tools.");
		await page.getByTestId("chat-send").click();
		const reply = page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
		await expect(reply).toContainText("riverstone", { timeout: 90_000 });
		await waitForAgentSettled(page);

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(tab).toHaveAttribute("data-session-id", sessionId);
		await expect(marker).toBeVisible();
		await expect(reply).toContainText("riverstone");
		const wire = await E2eWire.connect();
		const transcript = await wire
			.request("session.getMessages", { sessionId, workspaceId: workspace.id })
			.finally(() => wire.close());
		const summary = transcript.messages.find((message) => message.role === "compactionSummary");
		if (summary?.role !== "compactionSummary")
			throw new Error("Compaction summary did not survive reload");
		expect(summary.summary).toContain("riverstone");
	} finally {
		writeFileSync(settingsPath, original);
	}
});
