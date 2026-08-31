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

const BASE_TS = 1_700_500_000_000;
const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

function appendMessage(path: string, id: string, parentId: string, message: object): string {
	appendFileSync(
		path,
		`${JSON.stringify({ type: "message", id, parentId, timestamp: new Date(BASE_TS).toISOString(), message })}\n`,
	);
	return id;
}
const usage = {
	input: 10,
	output: 10,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 20,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("one round resolves to opening prose, one compact activity block, then the final answer", async ({
	page,
}) => {
	await openFixtureProject(page);
	const chat = seedWorkspaceSession(repoCwd(), {
		name: "turn hierarchy",
		messages: [{ role: "user", text: "Fix the rename flow.", timestamp: BASE_TS }],
	});

	// A round whose prose and tools interleave: opening → tool → intermediate → tool → final.
	// The projection must not scatter this into four prose rows around two activity blocks.
	const a1 = appendMessage(chat.path, `${chat.id}-a1`, `${chat.id}-m0`, {
		role: "assistant",
		content: [
			{ type: "text", text: "I'll inspect the rename flow and fix the display-name behavior." },
			{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "rename.ts" } },
		],
		usage,
		stopReason: "toolUse",
		timestamp: BASE_TS + 1_000,
	});
	const r1 = appendMessage(chat.path, `${chat.id}-read-1`, a1, {
		role: "toolResult",
		toolCallId: "read-1",
		toolName: "read",
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: BASE_TS + 1_100,
	});
	const a2 = appendMessage(chat.path, `${chat.id}-a2`, r1, {
		role: "assistant",
		content: [
			{ type: "text", text: "Found it: the branch was renamed alongside the label." },
			{ type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "rename.ts" } },
		],
		usage,
		stopReason: "toolUse",
		timestamp: BASE_TS + 2_000,
	});
	const r2 = appendMessage(chat.path, `${chat.id}-edit-1`, a2, {
		role: "toolResult",
		toolCallId: "edit-1",
		toolName: "edit",
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: BASE_TS + 2_100,
	});
	appendMessage(chat.path, `${chat.id}-a3`, r2, {
		role: "assistant",
		content: [
			{
				type: "text",
				text: "Fixed. Renaming now changes only the display name; the Git branch is untouched.",
			},
		],
		usage,
		stopReason: "stop",
		timestamp: BASE_TS + 3_000,
	});
	utimesSync(chat.path, new Date(BASE_TS), new Date(BASE_TS));

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await openChatFromHistory(page, "turn hierarchy");

	// Exactly one compact activity block for the whole round (two tools coalesced, not two blocks).
	const activity = page.getByTestId("activity-group");
	await expect(activity).toHaveCount(1);

	// Only two prose regions survive settlement: opening and final. Intermediate narration is
	// NOT a region-3 prose row any more — it moved into Activity.
	const prose = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	await expect(prose).toHaveCount(2);
	await expect(prose.nth(0)).toHaveAttribute("data-prose-role", "opening");
	await expect(prose.nth(0)).toContainText("I'll inspect the rename flow");
	await expect(prose.nth(1)).toHaveAttribute("data-prose-role", "final");
	await expect(prose.nth(1)).toContainText("only the display name");
	await expect(page.getByText("Found it", { exact: false })).toHaveCount(0);

	// The opening leads the turn; the single activity block sits between opening and final.
	const openingBox = await prose.nth(0).boundingBox();
	const activityBox = await activity.boundingBox();
	const finalBox = await prose.nth(1).boundingBox();
	if (!openingBox || !activityBox || !finalBox) throw new Error("missing layout boxes");
	expect(openingBox.y).toBeLessThan(activityBox.y);
	expect(activityBox.y).toBeLessThan(finalBox.y);

	// Mechanics stay compact-by-default but remain inspectable via disclosure. Expanding reveals the
	// intermediate narration as a contextual section that groups the step that followed it.
	await expect(activity).toHaveAttribute("data-expanded", "false");
	await activity.getByTestId("activity-group-toggle").click();
	await expect(activity).toHaveAttribute("data-expanded", "true");
	await expect(activity.locator('[data-testid="activity-step"][data-tool="read"]')).toBeVisible();
	const narration = activity.getByTestId("narration-group");
	await expect(narration).toHaveCount(1);
	await expect(narration).toContainText("Found it");
	await narration.getByTestId("narration-group-toggle").click();
	await expect(narration.locator('[data-testid="activity-step"][data-tool="edit"]')).toBeVisible();
});
