import { appendFileSync, realpathSync, utimesSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openChatFromHistory,
	openFixtureProject,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_300_000_000;

const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

test("a compacted transcript marks where the summarized messages were", async ({ page }) => {
	await openFixtureProject(page);

	const chat = seedWorkspaceSession(repoCwd(), {
		name: "the long chat",
		messages: [
			{ role: "user", text: "summarized question", timestamp: BASE_TS },
			{ role: "assistant", text: "summarized answer", timestamp: BASE_TS + 1_000 },
			{ role: "user", text: "kept question", timestamp: BASE_TS + 2_000 },
			{ role: "assistant", text: "kept answer", timestamp: BASE_TS + 3_000 },
		],
	});
	appendFileSync(
		chat.path,
		`${JSON.stringify({
			type: "compaction",
			id: `${chat.id}-c0`,
			parentId: `${chat.id}-m3`,
			firstKeptEntryId: `${chat.id}-m2`,
			summary: "## Earlier work\nRenamed the widget factory.",
			tokensBefore: 148_000,
			timestamp: new Date(BASE_TS + 4_000).toISOString(),
		})}\n`,
	);
	utimesSync(chat.path, new Date(BASE_TS), new Date(BASE_TS));

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await openChatFromHistory(page, "the long chat");

	await expect(page.getByText("kept question")).toBeVisible();
	await expect(page.getByText("summarized question")).toHaveCount(0);

	const marker = page.getByTestId("chat-compaction");
	await expect(marker).toContainText("Context compacted");
	await expect(marker).toContainText("148k tokens");
	await expect(page.getByText("Renamed the widget factory.")).toHaveCount(0);
	await marker.getByRole("button").click();
	await expect(page.getByText("Renamed the widget factory.")).toBeVisible();
});
